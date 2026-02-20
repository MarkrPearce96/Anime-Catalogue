'use strict';

const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const landingTemplate = require('stremio-addon-sdk/src/landingTemplate');
const manifest = require('./manifest');
const { initOfflineDb, isLoaded: offlineDbLoaded } = require('./mapping/offlineDb');
const { initFribbDb, isLoaded: fribbDbLoaded }     = require('./mapping/fribbDb');
const { defineCatalogHandler } = require('./addon/catalogHandler');
const { defineMetaHandler } = require('./addon/metaHandler');
const { startScheduler, stopScheduler } = require('./cache/scheduler');
const memCache = require('./cache/memCache');
const logger = require('./utils/logger');

const PORT = parseInt(process.env.PORT, 10) || 7070;

async function main() {
  logger.info('Anime Catalogue addon starting...');

  // 1. Load ID mapping databases
  try {
    await initOfflineDb();
  } catch (err) {
    logger.error('Failed to initialise offline DB:', err.message);
    logger.warn('Continuing without offline DB — ID mapping will fall back to Kitsu API');
  }

  try {
    await initFribbDb();
  } catch (err) {
    logger.error('Failed to initialise Fribb DB:', err.message);
    logger.warn('Continuing without Fribb DB — meta will fall back to AniList + Kitsu');
  }

  if (process.env.TMDB_API_KEY) {
    logger.info('TMDB API key found — meta will use TMDB for episodes and thumbnails');
  } else {
    logger.warn('TMDB_API_KEY not set — meta will fall back to AniList + Kitsu episodes');
  }

  // 2. Build addon
  const builder = new addonBuilder(manifest);

  // 3. Register handlers
  defineCatalogHandler(builder);
  defineMetaHandler(builder);

  // 4. Start background scheduler (pre-warm caches, periodic refresh)
  startScheduler();

  // 5. Build Express app with addon router and custom routes
  const app = express();

  // Health check endpoint (before addon router so it's not blocked)
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      cache: memCache.size(),
      offlineDb: offlineDbLoaded(),
      fribbDb: fribbDbLoaded(),
      tmdb: !!process.env.TMDB_API_KEY
    });
  });

  // Landing page
  const landingHTML = landingTemplate(manifest);
  app.get('/', (_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(landingHTML);
  });

  // Addon routes (catalog, meta, manifest, etc.)
  app.use(getRouter(builder.getInterface()));

  app.listen(PORT, () => {
    logger.info(`Addon listening at http://localhost:${PORT}`);
    logger.info(`Install URL: http://localhost:${PORT}/manifest.json`);
  });

  // 6. Graceful shutdown
  function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    stopScheduler();
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(err => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});
