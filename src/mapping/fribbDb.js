'use strict';

const fs   = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const logger = require('../utils/logger');

const FRIBB_URL  = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const FRIBB_PATH = path.join(__dirname, '../../data/anime-list-full.json');

// Map<anilistId (number), tmdbId (number)>
const anilistToTmdb = new Map();
// Map<tmdbId (number), anilistId (number)>
const tmdbToAnilist = new Map();

function parseDatabase(json) {
  anilistToTmdb.clear();
  tmdbToAnilist.clear();
  const entries = Array.isArray(json) ? json : [];

  for (const entry of entries) {
    if (entry.anilist_id && entry.themoviedb_id) {
      const anilistId = Number(entry.anilist_id);
      const tmdbId = Number(entry.themoviedb_id);
      anilistToTmdb.set(anilistId, tmdbId);
      tmdbToAnilist.set(tmdbId, anilistId);
    }
  }

  logger.info(`fribbDb: indexed ${anilistToTmdb.size.toLocaleString()} AniList↔TMDB mappings`);
}

async function downloadDatabase() {
  logger.info('fribbDb: downloading anime-list-full.json...');
  const res = await fetch(FRIBB_URL);
  if (!res.ok) throw new Error(`Failed to download Fribb DB: HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(FRIBB_PATH), { recursive: true });
  fs.writeFileSync(FRIBB_PATH, text, 'utf8');
  logger.info('fribbDb: download complete');
  return JSON.parse(text);
}

async function initFribbDb() {
  let json = null;

  if (fs.existsSync(FRIBB_PATH)) {
    const stat = fs.statSync(FRIBB_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 7 * 24 * 60 * 60 * 1000) {
      logger.info('fribbDb: loading from disk cache');
      try {
        json = JSON.parse(fs.readFileSync(FRIBB_PATH, 'utf8'));
      } catch (err) {
        logger.warn('fribbDb: disk cache corrupt, re-downloading');
        json = null;
      }
    }
  }

  if (!json) json = await downloadDatabase();
  parseDatabase(json);
}

async function refreshFribbDb() {
  try {
    const json = await downloadDatabase();
    parseDatabase(json);
  } catch (err) {
    logger.error('fribbDb: refresh failed:', err.message);
  }
}

function getTmdbId(anilistId) {
  return anilistToTmdb.get(Number(anilistId)) || null;
}

function getAnilistIdFromTmdb(tmdbId) {
  return tmdbToAnilist.get(Number(tmdbId)) || null;
}

module.exports = { initFribbDb, refreshFribbDb, getTmdbId, getAnilistIdFromTmdb };
