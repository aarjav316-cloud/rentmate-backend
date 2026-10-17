import { createClient } from 'redis';

/**
 * Redis Client — Reusable singleton.
 *
 * Reads REDIS_URL from environment.
 * Falls back to redis://localhost:6379 for local development.
 *
 * When Redis is unavailable the server continues to run — services
 * fall back to in-memory alternatives automatically.
 */
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redisClient = createClient({
  url: redisUrl,
  socket: {
    // Stop reconnecting after the first failure so we don't spam logs
    reconnectStrategy: false,
  },
});

/** Whether the Redis client is currently connected and usable. */
let redisReady = false;

// ── Event Listeners ──────────────────────────────────────────────────
redisClient.on('connect', () => {
  console.log('Redis connected');
});

redisClient.on('ready', () => {
  redisReady = true;
  console.log('Redis ready');
});

redisClient.on('error', (err) => {
  redisReady = false;
  // Log only once — reconnectStrategy: false prevents repeated errors
  console.error('Redis connection error:', err.message);
});

redisClient.on('end', () => {
  redisReady = false;
});

// ── Connection Function ──────────────────────────────────────────────
/**
 * Connect to Redis.
 * Should be called during application startup alongside connectDB().
 * If Redis is unavailable the server continues without it.
 */
const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    redisReady = false;
    console.warn(
      '⚠️  Redis is not available — the server will continue without it.',
      '\n   Features like rate-limiting and OTP storage will use in-memory fallbacks.',
      `\n   Error: ${error.message}`
    );
  }
};

/**
 * Check whether Redis is currently connected and usable.
 * @returns {boolean}
 */
const isRedisReady = () => redisReady;

export { redisClient, connectRedis, isRedisReady };
