'use strict';

const { getKitsuId } = require('./offlineDb');
const { searchKitsuId } = require('../kitsu/client');
const { getTitle } = require('../utils/anilistToMeta');
const logger = require('../utils/logger');

// Per-process cache: anilistId → stremioId (never expires — stable mapping)
const resolved = new Map();

/**
 * Resolve an AniList media object to a Stremio ID string.
 *
 * Resolution chain:
 *   1. In-process cache
 *   2. offlineDb numeric Kitsu ID  → "kitsu:{numeric}"
 *   3. Kitsu API search by title   → "kitsu:{numeric}" or "kitsu:{slug}"
 *   4. Fallback                    → "anilist:{id}"
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

  // 2. Offline DB lookup
  const kitsuNumeric = getKitsuId(anilistId);
  if (kitsuNumeric) {
    const stremioId = `kitsu:${kitsuNumeric}`;
    resolved.set(anilistId, stremioId);
    logger.debug(`idMapper: ${anilistId} → ${stremioId} (offline DB)`);
    return stremioId;
  }

  // 3. Kitsu API search
  const title = getTitle(media.title);
  const kitsuApiId = await searchKitsuId(title);
  if (kitsuApiId) {
    const stremioId = `kitsu:${kitsuApiId}`;
    resolved.set(anilistId, stremioId);
    logger.debug(`idMapper: ${anilistId} → ${stremioId} (Kitsu API)`);
    return stremioId;
  }

  // 4. Fallback — our own meta handler will serve this
  const stremioId = `anilist:${anilistId}`;
  resolved.set(anilistId, stremioId);
  logger.debug(`idMapper: ${anilistId} → ${stremioId} (fallback)`);
  return stremioId;
}

module.exports = { resolveStremioId };
