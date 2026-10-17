import { redisClient, isRedisReady } from '../config/redis.js';

/**
 * Redis Service — clean abstraction over the raw Redis client.
 *
 * Controllers and services should use these functions instead of
 * accessing redisClient directly.
 *
 * When Redis is unavailable every function returns a safe default
 * (null / 0 / false) so callers never crash.
 */

/**
 * Set a key with an optional TTL (seconds).
 * @param {string} key
 * @param {string} value
 * @param {number} [ttlSeconds] - Time-to-live in seconds. Omit for no expiry.
 */
export const set = async (key, value, ttlSeconds) => {
  if (!isRedisReady()) return;
  if (ttlSeconds) {
    await redisClient.set(key, value, { EX: ttlSeconds });
  } else {
    await redisClient.set(key, value);
  }
};

/**
 * Get the value of a key.
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export const get = async (key) => {
  if (!isRedisReady()) return null;
  return redisClient.get(key);
};

/**
 * Delete one or more keys.
 * @param {...string} keys
 * @returns {Promise<number>} Number of keys removed.
 */
export const del = async (...keys) => {
  if (!isRedisReady()) return 0;
  return redisClient.del(keys);
};

/**
 * Check whether a key exists.
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export const exists = async (key) => {
  if (!isRedisReady()) return false;
  const result = await redisClient.exists(key);
  return result === 1;
};

/**
 * Set an expiry (seconds) on an existing key.
 * @param {string} key
 * @param {number} ttlSeconds
 * @returns {Promise<boolean>}
 */
export const expire = async (key, ttlSeconds) => {
  if (!isRedisReady()) return false;
  const result = await redisClient.expire(key, ttlSeconds);
  return result;
};

/**
 * Increment the integer value of a key by 1.
 * Creates the key with value 1 if it does not exist.
 * @param {string} key
 * @returns {Promise<number>} The value after incrementing.
 */
export const incr = async (key) => {
  if (!isRedisReady()) return 0;
  return redisClient.incr(key);
};

/**
 * Get the remaining TTL (seconds) of a key.
 * @param {string} key
 * @returns {Promise<number>} TTL in seconds, -1 if no expiry, -2 if key does not exist.
 */
export const ttl = async (key) => {
  if (!isRedisReady()) return -2;
  return redisClient.ttl(key);
};

