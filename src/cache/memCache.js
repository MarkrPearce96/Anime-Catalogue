'use strict';

// Singleton in-memory TTL cache
const store = new Map();

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

  /** Current number of live entries */
  size() {
    return store.size;
  }
};

module.exports = memCache;
