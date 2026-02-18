'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const KITSU_API = 'https://kitsu.app/api/edge';
const HEADERS = { 'Accept': 'application/vnd.api+json' };

/**
 * Search Kitsu by title and return the numeric ID of the best match.
 * Returns null if nothing found.
 *
 * @param {string} title
 * @returns {Promise<string|null>} numeric ID string or null
 */
async function searchKitsuId(title) {
  if (!title) return null;

  const url = `${KITSU_API}/anime?filter[text]=${encodeURIComponent(title)}&page[limit]=1`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      logger.warn(`Kitsu search failed for "${title}": HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const data = json.data;
    if (!data || data.length === 0) return null;
    return data[0].id;
  } catch (err) {
    logger.warn(`Kitsu search error for "${title}": ${err.message}`);
    return null;
  }
}

/**
 * Fetch all episodes for a Kitsu numeric series ID.
 * Paginates automatically. Capped at 500 episodes to avoid runaway fetches.
 *
 * @param {string|number} kitsuNumericId
 * @returns {Promise<Array>} array of Kitsu episode attribute objects
 */
async function fetchKitsuEpisodes(kitsuNumericId) {
  const episodes = [];
  const PAGE_SIZE = 20;
  const MAX_EPISODES = 500;
  let offset = 0;

  while (episodes.length < MAX_EPISODES) {
    const url = `${KITSU_API}/episodes?filter[mediaId]=${kitsuNumericId}&sort=number&page[limit]=${PAGE_SIZE}&page[offset]=${offset}`;

    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) {
        logger.warn(`Kitsu episodes failed for ${kitsuNumericId}: HTTP ${res.status}`);
        break;
      }
      const json = await res.json();
      const data = json.data || [];

      for (const ep of data) {
        episodes.push({ id: ep.id, ...ep.attributes });
      }

      // Stop if no next page
      if (!json.links || !json.links.next || data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    } catch (err) {
      logger.warn(`Kitsu episodes fetch error for ${kitsuNumericId}: ${err.message}`);
      break;
    }
  }

  return episodes;
}

module.exports = { searchKitsuId, fetchKitsuEpisodes };
