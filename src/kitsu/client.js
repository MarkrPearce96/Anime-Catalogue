'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const KITSU_API = 'https://kitsu.app/api/edge';

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
    const res = await fetch(url, {
      headers: { 'Accept': 'application/vnd.api+json' }
    });

    if (!res.ok) {
      logger.warn(`Kitsu search failed for "${title}": HTTP ${res.status}`);
      return null;
    }

    const json = await res.json();
    const data = json.data;

    if (!data || data.length === 0) {
      logger.debug(`Kitsu: no results for "${title}"`);
      return null;
    }

    return data[0].id; // numeric string ID
  } catch (err) {
    logger.warn(`Kitsu search error for "${title}": ${err.message}`);
    return null;
  }
}

module.exports = { searchKitsuId };
