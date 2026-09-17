import { redisClient } from '../config/redis.js';

/**
 * Redis Service — clean abstraction over the raw Redis client.
 *
 * Controllers and services should use these functions instead of
 * accessing redisClient directly.
 */

/**
 * Set a key with an optional TTL (seconds).
 * @param {string} key
 * @param {string} value
 * @param {number} [ttlSeconds] - Time-to-live in seconds. Omit for no expiry.
 */
export const set = async (key, value, ttlSeconds) => {
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
  return redisClient.get(key);
};

/**
 * Delete one or more keys.
 * @param {...string} keys
 * @returns {Promise<number>} Number of keys removed.
 */
export const del = async (...keys) => {
  return redisClient.del(keys);
};

/**
 * Check whether a key exists.
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export const exists = async (key) => {
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
  return redisClient.incr(key);
};

/**
 * Get the remaining TTL (seconds) of a key.
 * @param {string} key
 * @returns {Promise<number>} TTL in seconds, -1 if no expiry, -2 if key does not exist.
 */
export const ttl = async (key) => {
  return redisClient.ttl(key);
};
