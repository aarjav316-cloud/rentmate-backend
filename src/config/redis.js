import { createClient } from 'redis';

/**
 * Redis Client — Reusable singleton.
 *
 * Reads REDIS_URL from environment.
 * Falls back to redis://localhost:6379 for local development.
 */
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redisClient = createClient({ url: redisUrl });

// ── Event Listeners ──────────────────────────────────────────────────
redisClient.on('connect', () => {
  console.log('Redis connected');
});

redisClient.on('error', (err) => {
  // Never log the URL/credentials — only the error message
  console.error('Redis connection error:', err.message);
});

redisClient.on('reconnecting', () => {
  console.log('Redis reconnecting...');
});

// ── Connection Function ──────────────────────────────────────────────
/**
 * Connect to Redis.
 * Should be called during application startup alongside connectDB().
 */
const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    console.error('Failed to connect to Redis:', error.message);
    process.exit(1);
  }
};

export { redisClient, connectRedis };
