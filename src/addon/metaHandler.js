'use strict';

const { queryMedia }    = require('../anilist/client');
const { MEDIA_BY_ID_QUERY } = require('../anilist/queries');
const { buildFullMeta, buildVideosFromKitsuEpisodes } = require('../utils/anilistToMeta');
const { fetchKitsuEpisodes } = require('../kitsu/client');
const { fetchTmdbSeries, fetchTmdbAllEpisodes, fetchTmdbExternalIds, fetchTmdbAggregateCredits, buildMetaFromTmdb } = require('../tmdb/client');
const { getAnilistId, getKitsuId } = require('../mapping/offlineDb');
const { getTmdbId, getAnilistIdFromTmdb } = require('../mapping/fribbDb');
const memCache = require('../cache/memCache');
const logger = require('../utils/logger');

const META_TTL = 24 * 60 * 60; // 24 hours

/**
 * Build the richest possible meta for a stremioId:
 *   1. Resolve anilistId → tmdbId via Fribb DB → TMDB API (best: episodes + thumbnails)
 *   2. Fall back to AniList + Kitsu episodes
 *   3. Fall back to AniList only
 */
async function fetchMeta(id, requestedType) {
  const cacheKey = `meta:${requestedType || 'series'}:${id}`;

  // --- Resolve anilistId and kitsuNumericId from the incoming ID ---
  let anilistId      = null;
  let kitsuNumericId = null;
  let tmdbId = null;

  if (id.startsWith('tmdb:')) {
    const m = id.match(/^tmdb:(\d+)$/);
    if (!m) return null;
    tmdbId         = parseInt(m[1], 10);
    anilistId      = getAnilistIdFromTmdb(tmdbId);
    kitsuNumericId = anilistId ? getKitsuId(anilistId) : null;
  } else if (id.startsWith('kitsu:')) {
    kitsuNumericId = id.slice('kitsu:'.length);
    anilistId      = getAnilistId(kitsuNumericId);
    tmdbId         = anilistId ? getTmdbId(anilistId) : null;
  } else if (id.startsWith('anilist:')) {
    const m = id.match(/^anilist:(\d+)$/);
    if (!m) return null;
    anilistId      = parseInt(m[1], 10);
    kitsuNumericId = getKitsuId(anilistId);
    tmdbId         = getTmdbId(anilistId);
  } else {
    return null;
  }

  return memCache.getOrFetch(cacheKey, META_TTL, async () => {
    logger.info(`meta cache miss: ${cacheKey}`);

    if (tmdbId && process.env.TMDB_API_KEY) {
      try {
        const [series, externalIds, aggregateCredits] = await Promise.all([
          fetchTmdbSeries(tmdbId),
          fetchTmdbExternalIds(tmdbId),
          fetchTmdbAggregateCredits(tmdbId),
        ]);
        if (series) {
          const imdbId  = (externalIds && externalIds.imdb_id) || null;
          const episodes = await fetchTmdbAllEpisodes(tmdbId, series.number_of_seasons || 1);
          const meta = buildMetaFromTmdb(series, episodes, id, imdbId, aggregateCredits, requestedType);
          logger.info(`  meta sourced from TMDB (tmdbId: ${tmdbId}${imdbId ? ', imdbId: ' + imdbId : ''})`);
          return { meta, cacheMaxAge: META_TTL, staleRevalidate: META_TTL * 2, staleError: 86400 };
        }
      } catch (err) {
        logger.warn(`  TMDB meta failed for ${id}: ${err.message} — falling back`);
      }
    }

    if (!anilistId) {
      logger.warn(`metaHandler: could not resolve anilistId for ${id}`);
      return null;
    }

    let media = null;
    try {
      media = await queryMedia(MEDIA_BY_ID_QUERY, { id: anilistId });
    } catch (err) {
      logger.error(`metaHandler: AniList query failed for ${id}:`, err.message);
      return null;
    }
    if (!media) return null;

    const meta = buildFullMeta(media, id, requestedType);

    if (kitsuNumericId && meta.type === 'series') {
      try {
        const episodes = await fetchKitsuEpisodes(kitsuNumericId);
        if (episodes.length > 0) {
          meta.videos = buildVideosFromKitsuEpisodes(episodes, id);
        }
      } catch (err) {
        logger.warn(`metaHandler: Kitsu episodes failed for ${id}:`, err.message);
      }
    }

    return { meta, cacheMaxAge: META_TTL, staleRevalidate: META_TTL * 2, staleError: 86400 };
  });
}

function defineMetaHandler(builder) {
  builder.defineMetaHandler(async ({ type, id }) => {
    if (!id.startsWith('tmdb:') && !id.startsWith('kitsu:') && !id.startsWith('anilist:')) return null;
    try {
      const result = await fetchMeta(id, type);
      return result || { meta: null };
    } catch (err) {
      logger.error(`metaHandler error [${id}]:`, err.message);
      return { meta: null };
    }
  });
}

module.exports = { defineMetaHandler, fetchMeta };
