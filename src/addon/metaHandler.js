'use strict';

const { queryMedia } = require('../anilist/client');
const { MEDIA_BY_ID_QUERY } = require('../anilist/queries');
const { buildFullMeta } = require('../utils/anilistToMeta');
const memCache = require('../cache/memCache');
const logger = require('../utils/logger');

const META_TTL = 24 * 60 * 60; // 24 hours

/**
 * Handle meta requests for anilist:-prefixed IDs.
 * kitsu: IDs are routed to Stremio's built-in Kitsu provider, not here.
 *
 * @param {string} id  - full Stremio ID, e.g. "anilist:12345"
 * @returns {Promise<{ meta }|null>}
 */
async function fetchMeta(id) {
  const cacheKey = `meta:${id}`;

  const cached = memCache.get(cacheKey);
  if (cached) {
    logger.info(`meta cache hit: ${cacheKey}`);
    return cached;
  }

  logger.info(`meta cache miss: ${cacheKey} — querying AniList`);

  // Extract numeric AniList ID
  const match = id.match(/^anilist:(\d+)$/);
  if (!match) {
    logger.warn(`metaHandler: unrecognised ID format: ${id}`);
    return null;
  }

  const anilistId = parseInt(match[1], 10);

  let media;
  try {
    media = await queryMedia(MEDIA_BY_ID_QUERY, { id: anilistId });
  } catch (err) {
    logger.error(`metaHandler: AniList query failed for ${id}:`, err.message);
    return null;
  }

  if (!media) return null;

  const meta = buildFullMeta(media, id);
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
    // Only handle anilist: prefixed IDs
    if (!id.startsWith('anilist:')) {
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
