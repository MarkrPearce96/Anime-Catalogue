'use strict';

const { queryMedia } = require('../anilist/client');
const { MEDIA_BY_ID_QUERY } = require('../anilist/queries');
const { buildFullMeta, buildVideosFromKitsuEpisodes } = require('../utils/anilistToMeta');
const { fetchKitsuEpisodes } = require('../kitsu/client');
const memCache = require('../cache/memCache');
const logger = require('../utils/logger');

const META_TTL     = 24 * 60 * 60; // 24 hours
const EPISODES_TTL = 24 * 60 * 60; // 24 hours

/**
 * Fetch episodes from Kitsu and cache them separately so meta + episodes
 * can be cached independently.
 *
 * @param {string} kitsuNumericId
 * @returns {Promise<Array>}
 */
async function getCachedEpisodes(kitsuNumericId) {
  const cacheKey = `episodes:kitsu:${kitsuNumericId}`;
  const cached = memCache.get(cacheKey);
  if (cached) return cached;

  logger.info(`episodes cache miss: ${cacheKey} — fetching from Kitsu`);
  const episodes = await fetchKitsuEpisodes(kitsuNumericId);
  memCache.set(cacheKey, episodes, EPISODES_TTL);
  logger.info(`  fetched ${episodes.length} episodes for kitsu:${kitsuNumericId}`);
  return episodes;
}

/**
 * Handle a meta request for a kitsu: or anilist: prefixed ID.
 *
 * For kitsu: IDs — we know the AniList ID from the catalog build but not
 * here at request time, so we use a reverse-lookup by querying AniList's
 * Kitsu-ID search.  In practice, AniList doesn't expose a Kitsu search, so
 * we serve the AniList meta we have and fetch Kitsu episodes separately.
 *
 * @param {string} id  - e.g. "kitsu:47759" or "anilist:16498"
 * @returns {Promise<object|null>}
 */
async function fetchMeta(id) {
  const cacheKey = `meta:${id}`;
  const cached = memCache.get(cacheKey);
  if (cached) {
    logger.info(`meta cache hit: ${cacheKey}`);
    return cached;
  }

  logger.info(`meta cache miss: ${cacheKey}`);

  let anilistId = null;
  let kitsuNumericId = null;

  if (id.startsWith('kitsu:')) {
    kitsuNumericId = id.slice('kitsu:'.length);
    // Resolve kitsu numeric ID → AniList ID via the offline DB (reverse lookup)
    const { getAnilistId } = require('../mapping/offlineDb');
    anilistId = getAnilistId(kitsuNumericId);
  } else if (id.startsWith('anilist:')) {
    const match = id.match(/^anilist:(\d+)$/);
    if (!match) return null;
    anilistId = parseInt(match[1], 10);
    // Look up whether this AniList ID maps to a Kitsu ID
    const { getKitsuId } = require('../mapping/offlineDb');
    kitsuNumericId = getKitsuId(anilistId);
  }

  // Fetch AniList metadata
  let media = null;
  if (anilistId) {
    try {
      media = await queryMedia(MEDIA_BY_ID_QUERY, { id: anilistId });
    } catch (err) {
      logger.error(`metaHandler: AniList query failed for ${id}:`, err.message);
    }
  }

  if (!media) {
    logger.warn(`metaHandler: no AniList data for ${id}`);
    return null;
  }

  const meta = buildFullMeta(media, id);

  // Fetch episodes from Kitsu (only for series, not movies)
  if (kitsuNumericId && meta.type === 'series') {
    try {
      const episodes = await getCachedEpisodes(kitsuNumericId);
      if (episodes.length > 0) {
        meta.videos = buildVideosFromKitsuEpisodes(episodes, id);
      }
    } catch (err) {
      logger.warn(`metaHandler: episode fetch failed for ${id}:`, err.message);
    }
  }

  const result = {
    meta,
    cacheMaxAge: META_TTL,
    staleRevalidate: META_TTL * 2,
    staleError: 86400
  };

  memCache.set(cacheKey, result, META_TTL);
  return result;
}

/**
 * Register the meta handler on a stremio-addon-sdk builder.
 * @param {object} builder
 */
function defineMetaHandler(builder) {
  builder.defineMetaHandler(async ({ type, id }) => {
    if (!id.startsWith('kitsu:') && !id.startsWith('anilist:')) {
      return null;
    }

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
