'use strict';

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const manifest = require('./manifest');
const { initOfflineDb } = require('./mapping/offlineDb');
const { defineCatalogHandler } = require('./addon/catalogHandler');
const { defineMetaHandler } = require('./addon/metaHandler');
const { startScheduler } = require('./cache/scheduler');
const logger = require('./utils/logger');

const PORT = parseInt(process.env.PORT, 10) || 7070;

async function main() {
  logger.info('Anime Catalogue addon starting...');

  // 1. Load offline ID mapping database
  try {
    await initOfflineDb();
  } catch (err) {
    logger.error('Failed to initialise offline DB:', err.message);
    logger.warn('Continuing without offline DB — ID mapping will fall back to Kitsu API');
  }

  // 2. Build addon
  const builder = new addonBuilder(manifest);

  // 3. Register handlers
  defineCatalogHandler(builder);
  defineMetaHandler(builder);

  // 4. Start background scheduler (pre-warm caches, periodic refresh)
  startScheduler();

  // 5. Start HTTP server
  serveHTTP(builder.getInterface(), { port: PORT });
  logger.info(`Addon listening at http://localhost:${PORT}`);
  logger.info(`Install URL: http://localhost:${PORT}/manifest.json`);
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
