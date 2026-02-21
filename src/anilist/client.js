'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');
const sleep = require('../utils/sleep');

const ANILIST_API = 'https://graphql.anilist.co';
const PER_PAGE = 100;

// Serial queue to avoid overwhelming AniList's rate limit (~90 req/min)
const queue = [];
let processing = false;

function enqueue(query, variables) {
  return new Promise((resolve, reject) => {
    queue.push({ query, variables, resolve, reject });
    if (!processing) processQueue();
  });
}

async function processQueue() {
  processing = true;
  while (queue.length > 0) {
    const { query, variables, resolve, reject } = queue.shift();
    try {
      const result = await executeQuery(query, variables);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }
  processing = false;
}

/**
 * Execute a GraphQL query against AniList with automatic rate-limit handling.
 * Reads X-RateLimit-Remaining / X-RateLimit-Reset headers to proactively
 * sleep before hitting 429.
 */
async function executeQuery(query, variables) {
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
      const retryAfter = Math.max(60, parseInt(res.headers.get('retry-after') || '60', 10));
      logger.warn(`AniList rate limited. Waiting ${retryAfter}s (attempt ${attempt}/3)`);
      await sleep(retryAfter * 1000);
      continue;
    }

    // Retry transient server errors with backoff
    if (res.status >= 500) {
      const wait = attempt * 10;
      logger.warn(`AniList server error ${res.status}. Waiting ${wait}s (attempt ${attempt}/3)`);
      await sleep(wait * 1000);
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

    // Proactively sleep if we're close to the rate limit
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining'), 10);
    const resetAt = parseInt(res.headers.get('x-ratelimit-reset'), 10);
    if (!isNaN(remaining) && remaining < 10 && !isNaN(resetAt)) {
      const waitMs = Math.max(0, resetAt * 1000 - Date.now()) + 500;
      logger.debug(`AniList rate limit low (${remaining} left). Sleeping ${Math.round(waitMs / 1000)}s until reset`);
      await sleep(waitMs);
    }

    return json.data;
  }

  throw new Error('AniList API: max retries exceeded');
}

/**
 * Execute a GraphQL query against AniList via the serial queue.
 * AniList allows ~90 requests/min. The queue drains one at a time and
 * proactively sleeps when the rate-limit window is nearly exhausted.
 *
 * @param {string} query   - GraphQL query string
 * @param {object} variables
 * @returns {Promise<object>} - parsed data object
 */
async function anilistQuery(query, variables = {}) {
  return enqueue(query, variables);
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

/**
 * Query an airing schedule endpoint and return the airingSchedules array.
 */
async function queryAiringSchedule(query, variables = {}) {
  const vars = Object.assign({ perPage: PER_PAGE }, variables);
  const data = await anilistQuery(query, vars);
  return (data.Page && data.Page.airingSchedules) || [];
}

module.exports = { anilistQuery, queryPage, queryMedia, queryAiringSchedule };
