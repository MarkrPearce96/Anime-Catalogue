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
  TRENDING_QUERY, SEASON_QUERY, POPULAR_QUERY, TOP_QUERY, ANIME_DISCOVER_QUERY
} = require('../src/anilist/queries');
const { buildMetaPreview, buildFullMeta, getCurrentSeason } = require('../src/utils/anilistToMeta');
const { fetchTmdbSeries, fetchTmdbAllEpisodes, fetchTmdbExternalIds, fetchTmdbAggregateCredits, buildMetaFromTmdb } = require('../src/tmdb/client');
const manifest = require('../src/manifest');
const logger   = require('../src/utils/logger');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

// ─── Config ──────────────────────────────────────────────────────────────────

const DIST   = path.join(__dirname, '../dist');
const PAGES  = 3;   // default pages per catalog (100 items/page → 300 items)

// Anime discover filter values
const ANIME_GENRES  = ['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mahou Shoujo','Mecha','Music','Mystery','Psychological','Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller'];
const ANIME_FORMATS = [{ display: 'TV', anilist: 'TV' }, { display: 'Movie', anilist: 'MOVIE' }, { display: 'OVA', anilist: 'OVA' }, { display: 'ONA', anilist: 'ONA' }, { display: 'Special', anilist: 'SPECIAL' }];
const ANIME_STATUSES = [{ display: 'Airing', anilist: 'RELEASING' }, { display: 'Finished', anilist: 'FINISHED' }, { display: 'Upcoming', anilist: 'NOT_YET_RELEASED' }];
const currentYear   = new Date().getFullYear();
const ANIME_YEARS   = Array.from({ length: currentYear - 1994 }, (_, i) => currentYear - i);

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

  const overrideType = type === 'anime' ? 'anime' : undefined;
  const metas = await Promise.all(
    mediaList.map(async media => {
      const stremioId = await resolveStremioId(media);
      return { meta: buildMetaPreview(media, stremioId, overrideType), media, stremioId };
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
  const {
    catalogId, type = 'series', query, baseVars = {},
    filterKey, filterValue, extraFilters = {}, pages = PAGES,
    skipIfExists = false
  } = config;

  // Compute the page-1 file path to check existence
  let page1ExtraKey;
  if (filterKey && filterValue) {
    const params = { [filterKey]: filterValue, ...extraFilters };
    page1ExtraKey = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  } else {
    page1ExtraKey = undefined;
  }

  if (skipIfExists && fs.existsSync(catalogFilePath(type, catalogId, page1ExtraKey))) {
    logger.info(`  skipped (cached): catalog/${type}/${catalogId}${page1ExtraKey ? '/' + page1ExtraKey : ''}`);
    return;
  }

  for (let page = 1; page <= pages; page++) {
    const vars = { ...baseVars, page, perPage: 100 };

    // Build the extra key that matches Stremio's URL path segment.
    // Keys are sorted alphabetically to match Stremio's encoding for multi-filter URLs.
    //   no filter, page 1         → undefined                      → anilist-trending.json
    //   no filter, page 2         → "skip=100"                     → anilist-trending/skip=100.json
    //   filter, page 1            → "genre=Action"                 → anilist-anime/genre=Action.json
    //   filter, page 2            → "genre=Action&skip=100"
    //   multi-filter, page 1      → "format=TV&genre=Action"       → anilist-anime/format=TV&genre=Action.json
    let extraKey;
    if (filterKey && filterValue) {
      const params = { [filterKey]: filterValue, ...extraFilters };
      if (page > 1) params.skip = String((page - 1) * 100);
      extraKey = Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
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
 * Write a meta file under every applicable type directory.
 * Anime shows appear in both 'series' and 'anime' catalogs, so Stremio may
 * request their meta under either type — we write both to avoid 404s.
 * Movies only need 'movie'.
 */
function writeMetaAllTypes(meta, stremioId) {
  const types = meta.type === 'movie' ? ['movie'] : ['series', 'anime'];
  for (const t of types) {
    writeJson(metaFilePath(t, stremioId), { meta });
  }
}

/**
 * Pre-generate meta JSON for every catalog item.
 * Uses TMDB (episodes + thumbnails) when available, falls back to AniList.
 */
async function buildAllMetas(allMediaMap) {
  let tmdbCount = 0;
  let fallbackCount = 0;
  let skippedCount = 0;

  for (const [stremioId, { media, type }] of allMediaMap) {
    // Skip if already built
    const checkType = media.format === 'MOVIE' ? 'movie' : 'series';
    if (fs.existsSync(metaFilePath(checkType, stremioId))) {
      skippedCount++;
      continue;
    }

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
          writeMetaAllTypes(meta, stremioId);
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
    writeMetaAllTypes(meta, stremioId);
    fallbackCount++;
  }

  logger.info(`  meta files: ${tmdbCount} from TMDB, ${fallbackCount} from AniList fallback, ${skippedCount} skipped (cached)`);
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

  // 2. Selective dist cleanup — preserve static catalog and meta files.
  fs.mkdirSync(DIST, { recursive: true });

  const DYNAMIC_PATHS = [
    path.join(DIST, 'manifest.json'),
    path.join(DIST, 'catalog', 'series', 'anilist-trending.json'),
    path.join(DIST, 'catalog', 'series', 'anilist-trending'),
    path.join(DIST, 'catalog', 'series', 'anilist-season.json'),
    path.join(DIST, 'catalog', 'series', 'anilist-season'),
    path.join(DIST, 'catalog', 'series', 'anilist-popular.json'),
    path.join(DIST, 'catalog', 'series', 'anilist-popular'),
    path.join(DIST, 'catalog', 'series', 'anilist-top.json'),
    path.join(DIST, 'catalog', 'anime', 'anilist-anime.json'),
  ];
  for (const p of DYNAMIC_PATHS) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true });
  }

  // 3. Write manifest
  writeJson(path.join(DIST, 'manifest.json'), manifest);
  logger.info('  wrote manifest.json');

  const { season, year } = getCurrentSeason();

  // 4. Define all catalogs to build
  const catalogConfigs = [
    // ── Home tab catalogs (type: series) ──────────────────────────────────────
    { catalogId: 'anilist-trending', query: TRENDING_QUERY },
    { catalogId: 'anilist-season',   query: SEASON_QUERY, baseVars: { season, seasonYear: year } },
    { catalogId: 'anilist-popular',  query: POPULAR_QUERY },
    { catalogId: 'anilist-top',      query: TOP_QUERY, pages: 1 },

    // ── Anime discover catalog (type: anime) — one page per filter ─────────────
    // Default (no filter)
    { catalogId: 'anilist-anime', type: 'anime', query: ANIME_DISCOVER_QUERY, pages: 1 },
    // Genre
    ...ANIME_GENRES.map(g => ({
      catalogId: 'anilist-anime', type: 'anime', query: ANIME_DISCOVER_QUERY,
      baseVars: { genre: g }, filterKey: 'genre', filterValue: g, pages: 1,
      skipIfExists: true
    })),
    // Format
    ...ANIME_FORMATS.map(({ display, anilist }) => ({
      catalogId: 'anilist-anime', type: 'anime', query: ANIME_DISCOVER_QUERY,
      baseVars: { format: anilist }, filterKey: 'format', filterValue: display, pages: 1,
      skipIfExists: true
    })),
    // Status
    ...ANIME_STATUSES.map(({ display, anilist }) => ({
      catalogId: 'anilist-anime', type: 'anime', query: ANIME_DISCOVER_QUERY,
      baseVars: { status: anilist }, filterKey: 'status', filterValue: display, pages: 1,
      skipIfExists: true
    })),
    // Year (last 10 years)
    ...ANIME_YEARS.map(y => ({
      catalogId: 'anilist-anime', type: 'anime', query: ANIME_DISCOVER_QUERY,
      baseVars: { year: y }, filterKey: 'year', filterValue: String(y), pages: 1,
      skipIfExists: true
    })),

    // ── Multi-filter combos (genre + one other filter) ─────────────────────────
    // Genre + Format (17 × 5 = 85 combos) — e.g. format=TV&genre=Action.json
    ...ANIME_GENRES.flatMap(g =>
      ANIME_FORMATS.map(({ display, anilist }) => ({
        catalogId: 'anilist-anime', type: 'anime', query: ANIME_DISCOVER_QUERY,
        baseVars: { genre: g, format: anilist },
        filterKey: 'genre', filterValue: g,
        extraFilters: { format: display },
        pages: 1, skipIfExists: true
      }))
    ),
    // Genre + Status (17 × 3 = 51 combos) — e.g. genre=Action&status=Airing.json
    ...ANIME_GENRES.flatMap(g =>
      ANIME_STATUSES.map(({ display, anilist }) => ({
        catalogId: 'anilist-anime', type: 'anime', query: ANIME_DISCOVER_QUERY,
        baseVars: { genre: g, status: anilist },
        filterKey: 'genre', filterValue: g,
        extraFilters: { status: display },
        pages: 1, skipIfExists: true
      }))
    ),
    // Genre + Year (17 × N combos) — e.g. genre=Action&year=2024.json
    ...ANIME_GENRES.flatMap(g =>
      ANIME_YEARS.map(y => ({
        catalogId: 'anilist-anime', type: 'anime', query: ANIME_DISCOVER_QUERY,
        baseVars: { genre: g, year: y },
        filterKey: 'genre', filterValue: g,
        extraFilters: { year: String(y) },
        pages: 1, skipIfExists: true
      }))
    ),
  ];

  // 5. Build each catalog
  const allMediaMap = new Map(); // stremioId → { media, type } (kept for future use)
  let failures = 0;

  for (const config of catalogConfigs) {
    const label = config.filterKey
      ? `${config.catalogId} (${config.filterKey}=${config.filterValue})`
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
