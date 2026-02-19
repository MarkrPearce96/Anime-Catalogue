'use strict';

/**
 * Static site builder — generates all Stremio addon JSON files into dist/
 * so they can be served from GitHub Pages with no live server.
 *
 * Output structure mirrors the Stremio addon URL schema:
 *   dist/manifest.json
 *   dist/catalog/series/anilist-trending.json          (page 1)
 *   dist/catalog/series/anilist-trending/skip=100.json (page 2)
 *   dist/catalog/series/anilist-discover/genre=Action.json
 *   dist/meta/series/anilist:16498.json
 */

const fs   = require('fs');
const path = require('path');

const { initOfflineDb }    = require('../src/mapping/offlineDb');
const { initFribbDb, getTmdbId } = require('../src/mapping/fribbDb');
const { resolveStremioId } = require('../src/mapping/idMapper');
const { queryPage }        = require('../src/anilist/client');
const {
  TRENDING_QUERY, SEASON_QUERY, POPULAR_QUERY, TOP_QUERY
} = require('../src/anilist/queries');
const { buildMetaPreview, buildFullMeta, getCurrentSeason } = require('../src/utils/anilistToMeta');
const { fetchTmdbSeries, fetchTmdbAllEpisodes, fetchTmdbExternalIds, fetchTmdbAggregateCredits, buildMetaFromTmdb } = require('../src/tmdb/client');
const manifest = require('../src/manifest');
const logger   = require('../src/utils/logger');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

// ─── Config ──────────────────────────────────────────────────────────────────

const DIST   = path.join(__dirname, '../dist');
const PAGES  = 3;   // default pages per catalog (100 items/page → 300 items)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
}

function catalogFilePath(type, id, extra) {
  // extra = undefined → anilist-trending.json
  // extra = 'skip=100' → anilist-trending/skip=100.json
  // extra = 'genre=Action' → anilist-discover/genre=Action.json
  if (!extra) return path.join(DIST, 'catalog', type, `${id}.json`);
  return path.join(DIST, 'catalog', type, id, `${extra}.json`);
}

function metaFilePath(type, id) {
  return path.join(DIST, 'meta', type, `${id}.json`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Core build functions ─────────────────────────────────────────────────────

/**
 * Fetch one page of a catalog, resolve IDs, write the JSON file.
 * Returns the list of media objects so callers can collect meta IDs.
 */
async function buildCatalogPage(query, vars, type, catalogId, extraKey) {
  const pageData  = await queryPage(query, vars);
  const mediaList = (pageData && pageData.media) || [];

  const metas = await Promise.all(
    mediaList.map(async media => {
      const stremioId = await resolveStremioId(media);
      return { meta: buildMetaPreview(media, stremioId), media, stremioId };
    })
  );

  writeJson(
    catalogFilePath(type, catalogId, extraKey),
    { metas: metas.map(m => m.meta) }
  );

  logger.info(`  wrote catalog/${type}/${catalogId}${extraKey ? '/' + extraKey : ''} (${metas.length} items)`);
  return metas;
}

/**
 * Build all pages for a single catalog config.
 */
async function buildCatalog(config, allMediaMap) {
  const { catalogId, type = 'series', query, baseVars = {}, genreLabel, pages = PAGES } = config;

  for (let page = 1; page <= pages; page++) {
    const vars = { ...baseVars, page, perPage: 100 };

    // Build the extra key that matches Stremio's URL path segment:
    //   no genre, page 1  → undefined          → anilist-discover.json
    //   no genre, page 2  → "skip=100"         → anilist-discover/skip=100.json
    //   genre, page 1     → "genre=Action"     → anilist-discover/genre=Action.json
    //   genre, page 2     → "genre=Action&skip=100" → anilist-discover/genre=Action&skip=100.json
    let extraKey;
    if (genreLabel) {
      extraKey = page === 1
        ? `genre=${genreLabel}`
        : `genre=${genreLabel}&skip=${(page - 1) * 100}`;
    } else {
      extraKey = page === 1 ? undefined : `skip=${(page - 1) * 100}`;
    }

    const metas = await buildCatalogPage(query, vars, type, catalogId, extraKey);

    // collect all IDs for meta pre-generation (kitsu: and anilist:)
    for (const { media, stremioId } of metas) {
      allMediaMap.set(stremioId, { media, type });
    }

    await sleep(800); // ~75 req/min — comfortably within AniList limit
  }
}

/**
 * Pre-generate meta JSON for every catalog item.
 * Uses TMDB (episodes + thumbnails) when available, falls back to AniList.
 */
async function buildAllMetas(allMediaMap) {
  let tmdbCount = 0;
  let fallbackCount = 0;

  for (const [stremioId, { media, type }] of allMediaMap) {
    const anilistId = media.id;
    const tmdbId    = TMDB_API_KEY ? getTmdbId(anilistId) : null;

    if (tmdbId) {
      try {
        // Fetch series details, external IDs, and aggregate cast in parallel
        const [series, externalIds, aggregateCredits] = await Promise.all([
          fetchTmdbSeries(tmdbId),
          fetchTmdbExternalIds(tmdbId),
          fetchTmdbAggregateCredits(tmdbId),
        ]);
        if (series) {
          const imdbId  = (externalIds && externalIds.imdb_id) || null;
          const episodes = await fetchTmdbAllEpisodes(tmdbId, series.number_of_seasons || 1);
          const meta = buildMetaFromTmdb(series, episodes, stremioId, imdbId, aggregateCredits);
          writeJson(metaFilePath(type, stremioId), { meta });
          tmdbCount++;
          await sleep(150); // respect TMDB rate limit
          continue;
        }
      } catch (err) {
        logger.warn(`  TMDB fetch failed for ${stremioId} (tmdbId: ${tmdbId}): ${err.message}`);
      }
    }

    // Fallback: AniList data (no episode list)
    const meta = buildFullMeta(media, stremioId);
    writeJson(metaFilePath(type, stremioId), { meta });
    fallbackCount++;
  }

  logger.info(`  meta files: ${tmdbCount} from TMDB, ${fallbackCount} from AniList fallback`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('Build started');

  // 1. Load ID mapping databases
  await initOfflineDb();
  await initFribbDb();

  if (TMDB_API_KEY) {
    logger.info('TMDB API key found — meta will use TMDB episodes + thumbnails');
  } else {
    logger.warn('TMDB_API_KEY not set — meta will fall back to AniList only (no episodes)');
  }

  // 2. Clean dist
  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 3. Write manifest
  writeJson(path.join(DIST, 'manifest.json'), manifest);
  logger.info('  wrote manifest.json');

  const { season, year } = getCurrentSeason();

  // 4. Define all catalogs to build
  const catalogConfigs = [
    { catalogId: 'anilist-trending', query: TRENDING_QUERY },
    { catalogId: 'anilist-season',   query: SEASON_QUERY,  baseVars: { season, seasonYear: year } },
    { catalogId: 'anilist-popular',  query: POPULAR_QUERY },
    { catalogId: 'anilist-top',      query: TOP_QUERY, pages: 1 },  // exactly 100 items
  ];

  // 5. Build each catalog
  const allMediaMap = new Map(); // stremioId → { media, type } (kept for future use)
  let failures = 0;

  for (const config of catalogConfigs) {
    const label = config.genreLabel
      ? `anilist-discover (${config.genreLabel})`
      : config.catalogId;
    logger.info(`Building catalog: ${label}`);
    try {
      await buildCatalog(config, allMediaMap);
    } catch (err) {
      logger.warn(`  skipped ${label}: ${err.message}`);
      failures++;
    }
  }

  // 6. Build meta files
  logger.info('Building meta files...');
  await buildAllMetas(allMediaMap);

  // 7. Summary
  const fileCount = countFiles(DIST);
  logger.info(`Build complete — ${fileCount} files written to dist/${failures ? ` (${failures} catalogs skipped due to errors)` : ''}`);
}

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
    else count++;
  }
  return count;
}

main().catch(err => {
  logger.error('Build failed:', err);
  process.exit(1);
});
