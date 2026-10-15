import crypto from 'crypto';
import { redisClient } from '../config/redis.js';

const DISCOVERY_CACHE_PREFIX = 'rentmate:v1:properties:list';
const DISCOVERY_CACHE_TTL = 300; // 5 minutes

const RECOMMENDATION_CACHE_PREFIX = 'rentmate:v1:recommendations:properties';
const RECOMMENDATION_CACHE_TTL = 300; // 5 minutes

/**
 * Generates a deterministic cache key based on the query object.
 * Sorts keys so ?city=A&rent=B produces the same key as ?rent=B&city=A.
 */
export const generateDiscoveryCacheKey = (query) => {
  // 1. Remove undefined/null/empty keys or irrelevant keys
  const cleanQuery = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      cleanQuery[key] = value;
    }
  }

  // 2. Sort keys to ensure deterministic ordering
  const sortedKeys = Object.keys(cleanQuery).sort();
  const sortedQuery = {};
  for (const key of sortedKeys) {
    sortedQuery[key] = cleanQuery[key];
  }

  // 3. Hash to avoid bloated cache keys with extremely long URLs
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(sortedQuery))
    .digest('hex');

  return `${DISCOVERY_CACHE_PREFIX}:${hash}`;
};

/**
 * Safe helper to fetch and parse a cached JSON payload.
 * Fails gracefully if Redis is down.
 */
export const getCachedData = async (key) => {
  if (!redisClient.isReady) return null;
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`[Redis] get error for key ${key}:`, error.message);
    return null; // Return null so the app falls back to MongoDB
  }
};

/**
 * Safe helper to store a JSON payload with a TTL.
 * Fails gracefully if Redis is down.
 */
export const setCachedData = async (key, data, ttlSeconds = DISCOVERY_CACHE_TTL) => {
  if (!redisClient.isReady) return;
  try {
    await redisClient.set(key, JSON.stringify(data), { EX: ttlSeconds });
  } catch (error) {
    console.error(`[Redis] set error for key ${key}:`, error.message);
  }
};

/**
 * Invalidates all property discovery cache entries using SCAN.
 * NEVER uses KEYS which can block the main Redis thread on large DBs.
 * Fails gracefully.
 */
export const invalidatePropertyDiscoveryCaches = async () => {
  if (!redisClient.isReady) return;
  
  try {
    let cursor = 0;
    const match = `${DISCOVERY_CACHE_PREFIX}:*`;
    const keysToDelete = [];

    // Paginate through keys matching the pattern using SCAN
    do {
      // redis-node v4 uses `scan` which returns { cursor, keys }
      const scanResult = await redisClient.scan(cursor, {
        MATCH: match,
        COUNT: 100, // Small batch size to avoid blocking
      });
      
      cursor = scanResult.cursor;
      keysToDelete.push(...scanResult.keys);
    } while (cursor !== 0);

    // Delete keys if any exist
    if (keysToDelete.length > 0) {
      await redisClient.del(keysToDelete);
    }
  } catch (error) {
    console.error(`[Redis] cache invalidation error for pattern ${DISCOVERY_CACHE_PREFIX}:*:`, error.message);
  }
};

// ══════════════════════════════════════════════════════════════════════
// RECOMMENDATION CACHE HELPERS
// ══════════════════════════════════════════════════════════════════════

/**
 * Generates a deterministic cache key for a user's recommendation request.
 *
 * Key structure:
 *   rentmate:v1:recommendations:properties:{userId}:{prefsHash}:{page}:{limit}
 *
 * The prefsHash is derived from sorted, cleaned preference values so that
 * equivalent preferences always produce the same hash regardless of
 * object key ordering.
 */
export const generateRecommendationCacheKey = (userId, preferences, page, limit) => {
  // Extract only preference values that affect scoring/filtering
  const prefsForHash = {
    preferredLocations: preferences.preferredLocations || [],
    minRent: preferences.minRent ?? null,
    maxRent: preferences.maxRent ?? null,
    propertyTypes: preferences.propertyTypes || [],
    minBedrooms: preferences.minBedrooms ?? null,
    maxBedrooms: preferences.maxBedrooms ?? null,
    requiredAmenities: preferences.requiredAmenities || [],
    preferredAvailableFrom: preferences.preferredAvailableFrom
      ? new Date(preferences.preferredAvailableFrom).toISOString()
      : null,
  };

  // Sort keys for deterministic serialization
  const sortedKeys = Object.keys(prefsForHash).sort();
  const sorted = {};
  for (const key of sortedKeys) {
    const val = prefsForHash[key];
    // Sort arrays for determinism
    sorted[key] = Array.isArray(val) ? [...val].sort() : val;
  }

  const prefsHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(sorted))
    .digest('hex')
    .substring(0, 16); // 16 hex chars = 64 bits — sufficient for cache keys

  return `${RECOMMENDATION_CACHE_PREFIX}:${userId}:${prefsHash}:${page}:${limit}`;
};

/**
 * Invalidates ALL recommendation caches for a specific user.
 * Called when a user creates or updates their preferences.
 * Uses SCAN — never KEYS.
 */
export const invalidateUserRecommendationCaches = async (userId) => {
  if (!redisClient.isReady) return;

  try {
    let cursor = 0;
    const match = `${RECOMMENDATION_CACHE_PREFIX}:${userId}:*`;
    const keysToDelete = [];

    do {
      const scanResult = await redisClient.scan(cursor, {
        MATCH: match,
        COUNT: 100,
      });
      cursor = scanResult.cursor;
      keysToDelete.push(...scanResult.keys);
    } while (cursor !== 0);

    if (keysToDelete.length > 0) {
      await redisClient.del(keysToDelete);
    }
  } catch (error) {
    console.error(`[Redis] recommendation cache invalidation error for user ${userId}:`, error.message);
  }
};

/**
 * Invalidates ALL recommendation caches across ALL users.
 * Called when any property is created, updated, or deleted —
 * because property changes can affect recommendations for multiple users.
 * Uses SCAN — never KEYS.
 */
export const invalidateAllRecommendationCaches = async () => {
  if (!redisClient.isReady) return;

  try {
    let cursor = 0;
    const match = `${RECOMMENDATION_CACHE_PREFIX}:*`;
    const keysToDelete = [];

    do {
      const scanResult = await redisClient.scan(cursor, {
        MATCH: match,
        COUNT: 100,
      });
      cursor = scanResult.cursor;
      keysToDelete.push(...scanResult.keys);
    } while (cursor !== 0);

    if (keysToDelete.length > 0) {
      await redisClient.del(keysToDelete);
    }
  } catch (error) {
    console.error(`[Redis] global recommendation cache invalidation error:`, error.message);
  }
};
