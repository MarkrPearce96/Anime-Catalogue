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
  // videos is appended here; aggregate_credits must be a separate call (not supported via append_to_response)
  const url = `${TMDB_API}/tv/${tmdbId}?api_key=${apiKey()}&language=en-US&append_to_response=videos`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB /tv/${tmdbId} returned ${res.status}`);
  return res.json();
}

/**
 * Fetch aggregate cast credits for a TV series (all voice actors across all episodes).
 * This is a separate endpoint — it cannot be combined via append_to_response.
 * Returns null on error.
 */
async function fetchTmdbAggregateCredits(tmdbId) {
  const url = `${TMDB_API}/tv/${tmdbId}/aggregate_credits?api_key=${apiKey()}&language=en-US`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
  // Returns: { cast: [{ name, roles: [{ character, episode_count }], ... }], crew: [...] }
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
 * Regular seasons (1-N) come first; Season 0 (specials/OVAs) is appended
 * at the end so Stremio shows "Special" below the regular seasons in the dropdown.
 *
 * @param {number} tmdbId
 * @param {number} numSeasons  - from series.number_of_seasons
 * @returns {Promise<Array>}
 */
async function fetchTmdbAllEpisodes(tmdbId, numSeasons) {
  const allEpisodes = [];

  // Regular seasons first
  for (let s = 1; s <= numSeasons; s++) {
    const season = await fetchTmdbSeason(tmdbId, s);
    if (season && Array.isArray(season.episodes)) {
      for (const ep of season.episodes) {
        allEpisodes.push({ ...ep, season_number: s });
      }
    }
    await sleep(150); // stay well within TMDB rate limit
  }

  // Season 0 = specials/OVAs — append last so Stremio lists "Special" below Season N
  const specials = await fetchTmdbSeason(tmdbId, 0);
  if (specials && Array.isArray(specials.episodes) && specials.episodes.length > 0) {
    for (const ep of specials.episodes) {
      allEpisodes.push({ ...ep, season_number: 0 });
    }
    await sleep(150);
  }

  return allEpisodes;
}

/**
 * Fetch external IDs (IMDB, TVDB, etc.) for a TMDB TV series.
 * Returns null on error. imdb_id may be null if the show isn't on IMDB.
 */
async function fetchTmdbExternalIds(tmdbId) {
  const url = `${TMDB_API}/tv/${tmdbId}/external_ids?api_key=${apiKey()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Build a Stremio meta object from a TMDB series + episodes.
 *
 * @param {object}      series      - TMDB /tv/{id} response
 * @param {Array}       allEpisodes - flat array from fetchTmdbAllEpisodes()
 * @param {string}      stremioId   - e.g. "kitsu:47759"
 * @param {string|null} imdbId      - e.g. "tt0944947" — when provided, video IDs use IMDB format
 *                                    so Torrentio routes streams via its IMDB path (better coverage)
 * @returns {object}
 */
function buildMetaFromTmdb(series, allEpisodes, stremioId, imdbId, aggregateCredits) {
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

  // Include IMDB ID so Stremio and stream addons can cross-reference
  if (imdbId) meta.imdbId = imdbId;

  // Cast — top 10 voice actors from aggregate_credits (fetched as a separate API call)
  if (aggregateCredits && Array.isArray(aggregateCredits.cast) && aggregateCredits.cast.length > 0) {
    meta.cast = aggregateCredits.cast.slice(0, 10).map(c => c.name);
  }

  // Trailer — first YouTube trailer from TMDB videos
  if (series.videos && Array.isArray(series.videos.results)) {
    const trailer = series.videos.results.find(v => v.site === 'YouTube' && v.type === 'Trailer');
    if (trailer) {
      meta.trailers = [{ source: trailer.key, type: 'Trailer' }];
    }
  }

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

  // Build videos array.
  // Use IMDB ID as the video ID base when available — this routes stream requests
  // through Torrentio's IMDB path (far better coverage than its kitsu: path).
  // Format: "tt0944947:1:1"  vs fallback "kitsu:47759:1:1"
  const videoBase = imdbId || stremioId;

  meta.videos = allEpisodes
    .filter(ep => ep.episode_number != null)
    .map(ep => {
      const video = {
        id:      `${videoBase}:${ep.season_number}:${ep.episode_number}`,
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
  fetchTmdbExternalIds,
  fetchTmdbAggregateCredits,
  buildMetaFromTmdb,
};
