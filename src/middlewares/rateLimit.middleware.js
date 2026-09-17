import * as redis from '../services/redis.service.js';

/**
 * Redis-backed Rate Limit Middleware Factory.
 *
 * Uses the existing Redis connection and redis.service abstraction.
 * Does NOT create a separate Redis client.
 *
 * ── Key schema ───────────────────────────────────────────────────────
 *   rentmate:ratelimit:<keyPrefix>:<ip>   → request count (integer)
 *   TTL = windowSeconds (set once on first INCR)
 *
 * ── Fail-open behaviour ──────────────────────────────────────────────
 *   If Redis is temporarily unreachable, the request is allowed through
 *   and a warning is logged. A Redis outage must NOT take down the API.
 *
 * @param {Object} options
 * @param {number} options.windowSeconds  - Sliding window duration in seconds.
 * @param {number} options.maxRequests    - Maximum allowed requests per window.
 * @param {string} options.keyPrefix      - Group name used in the Redis key (e.g. "login").
 * @returns {Function} Express middleware
 */
const rateLimit = ({ windowSeconds, maxRequests, keyPrefix }) => {
  return async (req, res, next) => {
    try {
      // ── Identify requester by IP ────────────────────────────────
      // req.ip respects Express trust-proxy settings.
      // Fallback chain handles edge cases (proxies, direct connections).
      const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';

      const key = `rentmate:ratelimit:${keyPrefix}:${ip}`;

      // ── Increment counter ───────────────────────────────────────
      const currentCount = await redis.incr(key);

      // First request in this window → set the TTL
      if (currentCount === 1) {
        await redis.expire(key, windowSeconds);
      }

      // ── Fetch remaining TTL for headers ─────────────────────────
      const remainingTtl = await redis.ttl(key);
      const remaining = Math.max(0, maxRequests - currentCount);

      // ── Set rate-limit headers on every response ────────────────
      res.set({
        'X-RateLimit-Limit': String(maxRequests),
        'X-RateLimit-Remaining': String(remaining),
      });

      // ── Reject if over limit ────────────────────────────────────
      if (currentCount > maxRequests) {
        res.set('Retry-After', String(remainingTtl > 0 ? remainingTtl : windowSeconds));

        return res.status(429).json({
          success: false,
          message: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: remainingTtl > 0 ? remainingTtl : windowSeconds,
        });
      }

      next();
    } catch (err) {
      // ── Fail-open: Redis is down → allow the request through ───
      console.error('Rate limiter Redis error (failing open):', err.message);
      next();
    }
  };
};

export default rateLimit;
