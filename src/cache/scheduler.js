'use strict';

const { fetchCatalog } = require('../addon/catalogHandler');
const { refreshOfflineDb } = require('../mapping/offlineDb');
const memCache = require('./memCache');
const logger = require('../utils/logger');

const INTERVALS = [];

/**
 * Pre-warm a catalog page and swallow errors (best-effort).
 */
async function prewarm(catalogId, extra = {}) {
  try {
    logger.info(`scheduler: pre-warming ${catalogId}`);
    await fetchCatalog(catalogId, extra);
  } catch (err) {
    logger.warn(`scheduler: prewarm failed for ${catalogId}:`, err.message);
  }
}

/**
 * Start all scheduled tasks.
 */
function startScheduler() {
  // --- Initial pre-warm (async, non-blocking) ---
  prewarm('anilist-trending');
  prewarm('anilist-season');

  // --- Trending: refresh every 1 hour ---
  INTERVALS.push(
    setInterval(() => prewarm('anilist-trending'), 60 * 60 * 1000)
  );

  // --- Season: refresh every 6 hours ---
  INTERVALS.push(
    setInterval(() => prewarm('anilist-season'), 6 * 60 * 60 * 1000)
  );

  // --- Offline DB: re-download every 24 hours ---
  INTERVALS.push(
    setInterval(async () => {
      logger.info('scheduler: refreshing offline DB');
      await refreshOfflineDb();
    }, 24 * 60 * 60 * 1000)
  );

  // --- Evict expired cache entries every 30 minutes ---
  INTERVALS.push(
    setInterval(() => {
      const before = memCache.size();
      memCache.evictExpired();
      const after = memCache.size();
      if (before !== after) {
        logger.debug(`scheduler: evicted ${before - after} expired cache entries (${after} remaining)`);
      }
    }, 30 * 60 * 1000)
  );

  logger.info('scheduler: started (trending 1h, season 6h, offline DB 24h, eviction 30m)');
}

/**
 * Stop all intervals (useful for tests / clean shutdown).
 */
function stopScheduler() {
  INTERVALS.forEach(id => clearInterval(id));
  INTERVALS.length = 0;
}

module.exports = { startScheduler, stopScheduler };
