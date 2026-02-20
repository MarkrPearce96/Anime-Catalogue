'use strict';

// Singleton in-memory TTL cache
const store = new Map();
// In-flight request deduplication
const pending = new Map();

const memCache = {
  /**
   * @param {string} key
   * @param {*} value
   * @param {number} ttlSeconds
   */
  set(key, value, ttlSeconds) {
    store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  },

  /**
   * @param {string} key
   * @returns {*} value or undefined if missing/expired
   */
  get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  },

  /**
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== undefined;
  },

  /**
   * Delete a single key
   * @param {string} key
   */
  del(key) {
    store.delete(key);
  },

  /**
   * Evict all expired entries — call periodically
   */
  evictExpired() {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.expiresAt) {
        store.delete(key);
      }
    }
  },

  /**
   * Deduplicated fetch: returns cached value, joins an in-flight request,
   * or calls fetchFn() and shares the result with concurrent callers.
   * @param {string} key
   * @param {number} ttlSeconds
   * @param {() => Promise<*>} fetchFn
   * @returns {Promise<*>}
   */
  async getOrFetch(key, ttlSeconds, fetchFn) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    if (pending.has(key)) return pending.get(key);

    const promise = fetchFn().then(result => {
      this.set(key, result, ttlSeconds);
      pending.delete(key);
      return result;
    }).catch(err => {
      pending.delete(key);
      throw err;
    });

    pending.set(key, promise);
    return promise;
  },

  /** Current number of live entries */
  size() {
    return store.size;
  }
};

module.exports = memCache;
