'use strict';

const { queryPage } = require('../anilist/client');
const {
  TRENDING_QUERY,
  SEASON_QUERY,
  POPULAR_QUERY,
  TOP_QUERY,
  ANIME_DISCOVER_QUERY
} = require('../anilist/queries');

// Maps Stremio display values → AniList enum values for the anime discover catalog
const FORMAT_MAP = { 'TV': 'TV', 'Movie': 'MOVIE', 'OVA': 'OVA', 'ONA': 'ONA', 'Special': 'SPECIAL' };
const STATUS_MAP = { 'Airing': 'RELEASING', 'Finished': 'FINISHED', 'Upcoming': 'NOT_YET_RELEASED' };
const { resolveStremioId } = require('../mapping/idMapper');
const { buildMetaPreview, getCurrentSeason } = require('../utils/anilistToMeta');
const memCache = require('../cache/memCache');
const logger = require('../utils/logger');

// TTL constants (seconds)
const TTL = {
  'anilist-trending': 60 * 60,        // 1 hour
  'anilist-season':   6 * 60 * 60,    // 6 hours
  'anilist-popular':  12 * 60 * 60,   // 12 hours
  'anilist-top':      24 * 60 * 60,   // 24 hours
  'anilist-anime':    6 * 60 * 60,    // 6 hours
};

/**
 * Convert skip (Stremio offset) to AniList page number.
 * Stremio sends skip=0, 100, 200 … AniList uses page=1, 2, 3 …
 */
function skipToPage(skip) {
  const s = parseInt(skip, 10) || 0;
  return Math.floor(s / 100) + 1;
}

/**
 * Build the AniList query variables for a given catalog + extras.
 */
function buildVariables(catalogId, extra, page) {
  const vars = { page, perPage: 100 };

  if (catalogId === 'anilist-season') {
    const { season, year } = getCurrentSeason();
    vars.season = season;
    vars.seasonYear = year;
  }

  if (catalogId === 'anilist-anime' && extra) {
    const hasFilters = extra.genre || extra.format || extra.status || extra.year;
    if (!hasFilters) return { metas: [], cacheMaxAge: 0, staleRevalidate: 0, staleError: 0 };
    if (extra.genre) vars.genre  = extra.genre;
    if (extra.format) vars.format = FORMAT_MAP[extra.format] || extra.format;
    if (extra.status) vars.status = STATUS_MAP[extra.status] || extra.status;
    if (extra.year)   vars.year   = parseInt(extra.year, 10);
  }

  return vars;
}

/**
 * Choose the right AniList query for a catalog ID.
 */
function pickQuery(catalogId) {
  switch (catalogId) {
    case 'anilist-trending': return TRENDING_QUERY;
    case 'anilist-season':   return SEASON_QUERY;
    case 'anilist-popular':  return POPULAR_QUERY;
    case 'anilist-top':      return TOP_QUERY;
    case 'anilist-anime':    return ANIME_DISCOVER_QUERY;
    default: return null;
  }
}

/**
 * Fetch a catalog page — checks cache first, queries AniList on miss.
 *
 * @param {string} catalogId
 * @param {object} extra  - { skip?, genre? }
 * @returns {Promise<{ metas, cacheMaxAge, staleRevalidate, staleError }>}
 */
async function fetchCatalog(catalogId, extra = {}) {
  const page = skipToPage(extra.skip);
  const extraKey = Object.entries(extra)
    .filter(([k]) => k !== 'skip')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const cacheKey = `catalog:${catalogId}:${page}:${extraKey}`;
  const ttl = TTL[catalogId] || 3600;

  // Cache hit
  const cached = memCache.get(cacheKey);
  if (cached) {
    logger.info(`catalog cache hit: ${cacheKey}`);
    return cached;
  }

  logger.info(`catalog cache miss: ${cacheKey} — querying AniList`);

  const query = pickQuery(catalogId);
  if (!query) {
    logger.warn(`Unknown catalog ID: ${catalogId}`);
    return { metas: [] };
  }

  const vars = buildVariables(catalogId, extra, page);
  const pageData = await queryPage(query, vars);
  const mediaList = (pageData && pageData.media) || [];

  // Resolve all IDs concurrently
  // Items from the anime discover catalog get type 'anime' so they appear under
  // the Anime section of the Discovery tab, separate from Movies and Series.
  const overrideType = catalogId === 'anilist-anime' ? 'anime' : undefined;
  const metas = await Promise.all(
    mediaList.map(async media => {
      const stremioId = await resolveStremioId(media);
      return buildMetaPreview(media, stremioId, overrideType);
    })
  );

  const result = {
    metas,
    cacheMaxAge: ttl,
    staleRevalidate: ttl * 2,
    staleError: 86400
  };

  memCache.set(cacheKey, result, ttl);
  return result;
}

/**
 * Register the catalog handler on a stremio-addon-sdk builder.
 * @param {object} builder
 */
function defineCatalogHandler(builder) {
  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
      return await fetchCatalog(id, extra || {});
    } catch (err) {
      logger.error(`catalogHandler error [${id}]:`, err.message);
      return { metas: [] };
    }
  });
}

module.exports = { defineCatalogHandler, fetchCatalog };
