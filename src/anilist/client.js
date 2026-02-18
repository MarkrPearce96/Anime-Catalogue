'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const ANILIST_API = 'https://graphql.anilist.co';
const PER_PAGE = 100;

/**
 * Execute a GraphQL query against AniList with automatic rate-limit retry.
 * AniList allows ~90 requests/min. On 429 we back off and retry once.
 *
 * @param {string} query   - GraphQL query string
 * @param {object} variables
 * @returns {Promise<object>} - parsed data object
 */
async function anilistQuery(query, variables = {}) {
  const body = JSON.stringify({ query, variables });

  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(ANILIST_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body
      });
    } catch (err) {
      logger.error('AniList fetch error:', err.message);
      throw err;
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '60', 10);
      logger.warn(`AniList rate limited. Waiting ${retryAfter}s (attempt ${attempt}/3)`);
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AniList API error ${res.status}: ${text}`);
    }

    const json = await res.json();

    if (json.errors && json.errors.length > 0) {
      const msg = json.errors.map(e => e.message).join('; ');
      throw new Error(`AniList GraphQL errors: ${msg}`);
    }

    return json.data;
  }

  throw new Error('AniList API: max retries exceeded');
}

/**
 * Query a paginated AniList endpoint and return the Page result.
 */
async function queryPage(query, variables = {}) {
  const vars = Object.assign({ perPage: PER_PAGE }, variables);
  const data = await anilistQuery(query, vars);
  return data.Page;
}

/**
 * Query a single media item by ID.
 */
async function queryMedia(query, variables = {}) {
  const data = await anilistQuery(query, variables);
  return data.Media;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { anilistQuery, queryPage, queryMedia };
