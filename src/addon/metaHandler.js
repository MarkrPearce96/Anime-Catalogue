'use strict';

const { queryMedia }    = require('../anilist/client');
const { MEDIA_BY_ID_QUERY } = require('../anilist/queries');
const { buildFullMeta, buildVideosFromKitsuEpisodes } = require('../utils/anilistToMeta');
const { fetchKitsuEpisodes } = require('../kitsu/client');
const { fetchTmdbSeries, fetchTmdbAllEpisodes, fetchTmdbExternalIds, buildMetaFromTmdb } = require('../tmdb/client');
const { getAnilistId, getKitsuId } = require('../mapping/offlineDb');
const { getTmdbId }     = require('../mapping/fribbDb');
const memCache          = require('../cache/memCache');
const logger            = require('../utils/logger');

const META_TTL = 24 * 60 * 60; // 24 hours

/**
 * Build the richest possible meta for a stremioId:
 *   1. Resolve anilistId → tmdbId via Fribb DB → TMDB API (best: episodes + thumbnails)
 *   2. Fall back to AniList + Kitsu episodes
 *   3. Fall back to AniList only
 */
async function fetchMeta(id) {
  const cacheKey = `meta:${id}`;
  const cached = memCache.get(cacheKey);
  if (cached) {
    logger.info(`meta cache hit: ${cacheKey}`);
    return cached;
  }

  logger.info(`meta cache miss: ${cacheKey}`);

  // --- Resolve anilistId and kitsuNumericId from the incoming ID ---
  let anilistId      = null;
  let kitsuNumericId = null;

  if (id.startsWith('kitsu:')) {
    kitsuNumericId = id.slice('kitsu:'.length);
    anilistId      = getAnilistId(kitsuNumericId);
  } else if (id.startsWith('anilist:')) {
    const m = id.match(/^anilist:(\d+)$/);
    if (!m) return null;
    anilistId      = parseInt(m[1], 10);
    kitsuNumericId = getKitsuId(anilistId);
  } else {
    return null;
  }

  // --- Try TMDB first (best episode data + thumbnails) ---
  const tmdbId = anilistId ? getTmdbId(anilistId) : null;

  if (tmdbId && process.env.TMDB_API_KEY) {
    try {
      // Fetch series details and external IDs (for IMDB ID) in parallel
      const [series, externalIds] = await Promise.all([
        fetchTmdbSeries(tmdbId),
        fetchTmdbExternalIds(tmdbId),
      ]);
      if (series) {
        const imdbId  = (externalIds && externalIds.imdb_id) || null;
        const episodes = await fetchTmdbAllEpisodes(tmdbId, series.number_of_seasons || 1);
        const meta = buildMetaFromTmdb(series, episodes, id, imdbId);
        const result = { meta, cacheMaxAge: META_TTL, staleRevalidate: META_TTL * 2, staleError: 86400 };
        memCache.set(cacheKey, result, META_TTL);
        logger.info(`  meta sourced from TMDB (tmdbId: ${tmdbId}${imdbId ? ', imdbId: ' + imdbId : ''})`);
        return result;
      }
    } catch (err) {
      logger.warn(`  TMDB meta failed for ${id}: ${err.message} — falling back`);
    }
  }

  // --- Fall back: AniList meta + Kitsu episodes ---
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

  const meta = buildFullMeta(media, id);

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

  const result = { meta, cacheMaxAge: META_TTL, staleRevalidate: META_TTL * 2, staleError: 86400 };
  memCache.set(cacheKey, result, META_TTL);
  return result;
}

function defineMetaHandler(builder) {
  builder.defineMetaHandler(async ({ type, id }) => {
    if (!id.startsWith('kitsu:') && !id.startsWith('anilist:')) return null;
    try {
      const result = await fetchMeta(id);
      return result || { meta: null };
    } catch (err) {
      logger.error(`metaHandler error [${id}]:`, err.message);
      return { meta: null };
    }
  });
}

module.exports = { defineMetaHandler, fetchMeta };
