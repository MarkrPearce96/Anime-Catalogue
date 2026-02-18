'use strict';

const fetch  = require('node-fetch');
const logger = require('../utils/logger');

const TMDB_API   = 'https://api.themoviedb.org/3';
const TMDB_IMG   = 'https://image.tmdb.org/t/p';

function apiKey() {
  const k = process.env.TMDB_API_KEY;
  if (!k) throw new Error('TMDB_API_KEY environment variable not set');
  return k;
}

function poster(p)     { return p ? `${TMDB_IMG}/w500${p}`    : undefined; }
function backdrop(p)   { return p ? `${TMDB_IMG}/original${p}`: undefined; }
function still(p)      { return p ? `${TMDB_IMG}/w300${p}`    : undefined; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Fetch TV series details from TMDB.
 * Returns null on 404 (not found), throws on other errors.
 */
async function fetchTmdbSeries(tmdbId) {
  const url = `${TMDB_API}/tv/${tmdbId}?api_key=${apiKey()}&language=en-US`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB /tv/${tmdbId} returned ${res.status}`);
  return res.json();
}

/**
 * Fetch one season's episode list from TMDB.
 * Returns null on 404.
 */
async function fetchTmdbSeason(tmdbId, seasonNum) {
  const url = `${TMDB_API}/tv/${tmdbId}/season/${seasonNum}?api_key=${apiKey()}&language=en-US`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB season ${seasonNum} for ${tmdbId} returned ${res.status}`);
  return res.json();
}

/**
 * Fetch all seasons for a series and return a flat episode array.
 * Skips Season 0 (specials) to keep the list clean.
 *
 * @param {number} tmdbId
 * @param {number} numSeasons  - from series.number_of_seasons
 * @returns {Promise<Array>}
 */
async function fetchTmdbAllEpisodes(tmdbId, numSeasons) {
  const allEpisodes = [];

  for (let s = 1; s <= numSeasons; s++) {
    const season = await fetchTmdbSeason(tmdbId, s);
    if (season && Array.isArray(season.episodes)) {
      for (const ep of season.episodes) {
        allEpisodes.push({ ...ep, season_number: s });
      }
    }
    await sleep(150); // stay well within TMDB rate limit
  }

  return allEpisodes;
}

/**
 * Build a Stremio meta object from a TMDB series + episodes.
 *
 * @param {object} series      - TMDB /tv/{id} response
 * @param {Array}  allEpisodes - flat array from fetchTmdbAllEpisodes()
 * @param {string} stremioId   - e.g. "kitsu:47759"
 * @returns {object}
 */
function buildMetaFromTmdb(series, allEpisodes, stremioId) {
  const statusMap = {
    'Returning Series': 'Continuing',
    'Ended':            'Ended',
    'Canceled':         'Cancelled',
    'In Production':    'Upcoming',
    'Planned':          'Upcoming',
  };

  const meta = {
    id:          stremioId,
    type:        'series',
    name:        series.name,
    poster:      poster(series.poster_path),
    background:  backdrop(series.backdrop_path),
    description: series.overview || '',
    genres:      (series.genres || []).map(g => g.name),
    status:      statusMap[series.status] || series.status || undefined,
  };

  if (series.vote_average) {
    meta.imdbRating = series.vote_average.toFixed(1);
  }

  if (series.first_air_date) {
    meta.releaseInfo = series.first_air_date.slice(0, 4);
    if (series.last_air_date && series.status === 'Ended') {
      meta.releaseInfo += `-${series.last_air_date.slice(0, 4)}`;
    }
  }

  const runtime = series.episode_run_time && series.episode_run_time[0];
  if (runtime) meta.runtime = `${runtime} min`;

  // Build videos array
  meta.videos = allEpisodes
    .filter(ep => ep.episode_number != null)
    .map(ep => {
      const video = {
        id:      `${stremioId}:${ep.season_number}:${ep.episode_number}`,
        title:   ep.name || `Episode ${ep.episode_number}`,
        season:  ep.season_number,
        episode: ep.episode_number,
      };
      if (ep.still_path)  video.thumbnail = still(ep.still_path);
      if (ep.overview)    video.overview   = ep.overview;
      if (ep.air_date)    video.released   = new Date(ep.air_date).toISOString();
      return video;
    });

  return meta;
}

module.exports = {
  fetchTmdbSeries,
  fetchTmdbSeason,
  fetchTmdbAllEpisodes,
  buildMetaFromTmdb,
};
