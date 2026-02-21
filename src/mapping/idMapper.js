'use strict';

const { getKitsuId } = require('./offlineDb');
const { getTmdbId } = require('./fribbDb');
const { searchKitsuId } = require('../kitsu/client');
const { getTitle } = require('../utils/anilistToMeta');
const logger = require('../utils/logger');

// Per-process cache: anilistId → stremioId (never expires — stable mapping)
const resolved = new Map();

// Track AniList IDs where Kitsu API returned no result, so we don't re-query
const negativeCache = new Set();

/**
 * Resolve an AniList media object to a Stremio ID string.
 *
 * Resolution chain:
 *   1. In-process cache
 *   2. fribbDb TMDB ID             → "tmdb:{numeric}"
 *   3. offlineDb numeric Kitsu ID  → "kitsu:{numeric}"
 *   4. Kitsu API search by title   → "kitsu:{numeric}" or "kitsu:{slug}"
 *   5. Fallback                    → "anilist:{id}"
 *
 * @param {object} media  - AniList media object (must have .id and .title)
 * @returns {Promise<string>}
 */
async function resolveStremioId(media) {
  const anilistId = media.id;

  // 1. In-process cache
  if (resolved.has(anilistId)) {
    return resolved.get(anilistId);
  }

  // 2. Fribb DB: AniList → TMDB
  const tmdbId = getTmdbId(anilistId);
  if (tmdbId) {
    const stremioId = `tmdb:${tmdbId}`;
    resolved.set(anilistId, stremioId);
    logger.debug(`idMapper: ${anilistId} → ${stremioId} (Fribb DB)`);
    return stremioId;
  }

  // 3. Offline DB lookup
  const kitsuNumeric = getKitsuId(anilistId);
  if (kitsuNumeric) {
    const stremioId = `kitsu:${kitsuNumeric}`;
    resolved.set(anilistId, stremioId);
    logger.debug(`idMapper: ${anilistId} → ${stremioId} (offline DB)`);
    return stremioId;
  }

  // 4. Kitsu API search (skip if previously returned no result)
  if (!negativeCache.has(anilistId)) {
    const title = getTitle(media.title);
    const kitsuApiId = await searchKitsuId(title);
    if (kitsuApiId) {
      const stremioId = `kitsu:${kitsuApiId}`;
      resolved.set(anilistId, stremioId);
      logger.debug(`idMapper: ${anilistId} → ${stremioId} (Kitsu API)`);
      return stremioId;
    }
    negativeCache.add(anilistId);
  }

  // 5. Fallback — our own meta handler will serve this
  const stremioId = `anilist:${anilistId}`;
  resolved.set(anilistId, stremioId);
  logger.debug(`idMapper: ${anilistId} → ${stremioId} (fallback)`);
  return stremioId;
}

module.exports = { resolveStremioId };
