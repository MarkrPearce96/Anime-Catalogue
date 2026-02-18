'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const logger = require('../utils/logger');

const DB_URL = 'https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json';
const DB_PATH = path.join(__dirname, '../../data/anime-offline-database.json');

// Map<anilistId (number), kitsuId (string numeric)>
const anilistToKitsu = new Map();
// Map<kitsuId (string numeric), anilistId (number)>
const kitsuToAnilist = new Map();

/**
 * Extract a numeric ID from a source URL.
 * e.g. "https://anilist.co/anime/1234" → 1234
 *      "https://kitsu.io/anime/5678"   → "5678"
 */
function extractId(url, domain) {
  const match = url.match(new RegExp(`${domain}/anime/(\\d+)`));
  return match ? match[1] : null;
}

/**
 * Parse the downloaded JSON and populate the anilistToKitsu map.
 */
function parseDatabase(json) {
  anilistToKitsu.clear();
  kitsuToAnilist.clear();

  const entries = json.data || json;
  if (!Array.isArray(entries)) {
    logger.warn('offlineDb: unexpected format — data is not an array');
    return;
  }

  for (const entry of entries) {
    const sources = entry.sources || [];
    let anilistId = null;
    let kitsuId = null;

    for (const src of sources) {
      if (src.includes('anilist.co/anime/')) {
        anilistId = extractId(src, 'anilist.co');
      } else if (src.includes('kitsu.app/anime/')) {
        kitsuId = extractId(src, 'kitsu.app');
      } else if (src.includes('kitsu.io/anime/')) {
        kitsuId = extractId(src, 'kitsu.io');
      }
    }

    if (anilistId && kitsuId) {
      anilistToKitsu.set(Number(anilistId), kitsuId);
      kitsuToAnilist.set(kitsuId, Number(anilistId));
    }
  }

  logger.info(`offlineDb: indexed ${anilistToKitsu.size.toLocaleString()} AniList→Kitsu mappings`);
}

/**
 * Download the database from GitHub and save to disk.
 */
async function downloadDatabase() {
  logger.info('offlineDb: downloading anime-offline-database...');
  const res = await fetch(DB_URL);
  if (!res.ok) throw new Error(`Failed to download offline DB: HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, text, 'utf8');
  logger.info('offlineDb: download complete');
  return JSON.parse(text);
}

/**
 * Initialise — load from disk if fresh enough, else download.
 * "Fresh enough" = file modified within 24h.
 */
async function initOfflineDb() {
  let json = null;

  if (fs.existsSync(DB_PATH)) {
    const stat = fs.statSync(DB_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 7 * 24 * 60 * 60 * 1000) {
      logger.info('offlineDb: loading from disk cache');
      try {
        json = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      } catch (err) {
        logger.warn('offlineDb: disk cache corrupt, re-downloading:', err.message);
        json = null;
      }
    }
  }

  if (!json) {
    json = await downloadDatabase();
  }

  parseDatabase(json);
}

/**
 * Refresh — re-download and re-parse. Called by scheduler every 24h.
 */
async function refreshOfflineDb() {
  try {
    const json = await downloadDatabase();
    parseDatabase(json);
  } catch (err) {
    logger.error('offlineDb: refresh failed:', err.message);
  }
}

/**
 * Look up a Kitsu numeric ID for a given AniList integer ID.
 * @param {number} anilistId
 * @returns {string|null}
 */
function getKitsuId(anilistId) {
  return anilistToKitsu.get(Number(anilistId)) || null;
}

/**
 * Reverse lookup — Kitsu numeric ID → AniList integer ID.
 * @param {string} kitsuId  numeric string
 * @returns {number|null}
 */
function getAnilistId(kitsuId) {
  return kitsuToAnilist.get(String(kitsuId)) || null;
}

module.exports = { initOfflineDb, refreshOfflineDb, getKitsuId, getAnilistId };
