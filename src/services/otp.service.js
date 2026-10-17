import { hashOtp, compareOtp } from '../utils/otp.utils.js';
import { isRedisReady } from '../config/redis.js';
import * as redis from './redis.service.js';

/**
 * OTP Service — Redis-backed with in-memory fallback.
 *
 * When Redis is available, uses the redis.service abstraction.
 * When Redis is unavailable, falls back to a simple in-memory Map
 * so that registration / email-verification still works during local
 * development without Redis installed.
 *
 * ── Key schema (Redis) ──────────────────────────────────────────────
 *   rentmate:otp:verify:{email}    → SHA-256 hash of the OTP     (TTL 300s)
 *   rentmate:otp:attempts:{email}  → integer attempt counter      (TTL 300s)
 *   rentmate:otp:resend:{email}    → "1" cooldown flag            (TTL  60s)
 */

const OTP_TTL = parseInt(process.env.OTP_EXPIRES_IN, 10) || 300;            // 5 min
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5;
const OTP_RESEND_COOLDOWN = parseInt(process.env.OTP_RESEND_COOLDOWN, 10) || 60; // 60s

// ── Key Helpers ──────────────────────────────────────────────────────
const otpKey      = (email) => `rentmate:otp:verify:${email.toLowerCase()}`;
const attemptsKey = (email) => `rentmate:otp:attempts:${email.toLowerCase()}`;
const resendKey   = (email) => `rentmate:otp:resend:${email.toLowerCase()}`;

// ── In-Memory Fallback Store ─────────────────────────────────────────
const memStore = new Map();
const memTimers = new Map();

const memSet = (key, value, ttlSeconds) => {
  memStore.set(key, value);
  // Clear any existing timer
  if (memTimers.has(key)) clearTimeout(memTimers.get(key));
  if (ttlSeconds) {
    memTimers.set(key, setTimeout(() => {
      memStore.delete(key);
      memTimers.delete(key);
    }, ttlSeconds * 1000));
  }
};

const memGet = (key) => memStore.get(key) ?? null;

const memDel = (...keys) => {
  for (const k of keys) {
    memStore.delete(k);
    if (memTimers.has(k)) {
      clearTimeout(memTimers.get(k));
      memTimers.delete(k);
    }
  }
};

const memIncr = (key) => {
  const val = parseInt(memStore.get(key) || '0', 10) + 1;
  memStore.set(key, String(val));
  return val;
};

const memExists = (key) => memStore.has(key);

const memTtl = () => -1; // approximate — we don't track exact TTL in memory

// ── Helpers that pick Redis or Memory ────────────────────────────────
const store = {
  set:    (...a) => isRedisReady() ? redis.set(...a)    : memSet(...a),
  get:    (...a) => isRedisReady() ? redis.get(...a)    : memGet(...a),
  del:    (...a) => isRedisReady() ? redis.del(...a)    : memDel(...a),
  incr:   (...a) => isRedisReady() ? redis.incr(...a)   : memIncr(...a),
  expire: (...a) => isRedisReady() ? redis.expire(...a) : undefined,
  exists: (...a) => isRedisReady() ? redis.exists(...a) : memExists(...a),
  ttl:    (...a) => isRedisReady() ? redis.ttl(...a)    : memTtl(...a),
};

/**
 * Store a hashed OTP for a given email.
 * Overwrites any previously stored OTP for the same email.
 * Also sets the resend cooldown and resets the attempt counter.
 * @param {string} email
 * @param {string} rawOtp - The plaintext OTP (will be hashed before storage)
 */
export const storeOtp = async (email, rawOtp) => {
  const hash = hashOtp(rawOtp);

  // Store OTP hash with TTL (auto-expires — no manual expiration check needed)
  await store.set(otpKey(email), hash, OTP_TTL);

  // Reset attempt counter (fresh OTP = fresh attempts)
  await store.del(attemptsKey(email));

  // Set resend cooldown
  await store.set(resendKey(email), '1', OTP_RESEND_COOLDOWN);
};

/**
 * Verify an OTP for a given email.
 * Returns an object { valid, code } where code is the error reason if invalid.
 * Automatically deletes the record on success.
 * @param {string} email
 * @param {string} rawOtp
 * @returns {Promise<{ valid: boolean, code?: string }>}
 */
export const verifyOtp = async (email, rawOtp) => {
  // 1. Check attempt counter FIRST — prevent brute-force even if OTP still exists
  const currentAttempts = await store.get(attemptsKey(email));
  if (currentAttempts !== null && parseInt(currentAttempts, 10) >= OTP_MAX_ATTEMPTS) {
    // Clean up — OTP is burned
    await store.del(otpKey(email), attemptsKey(email));
    return { valid: false, code: 'TOO_MANY_ATTEMPTS' };
  }

  // 2. Retrieve OTP hash
  const storedHash = await store.get(otpKey(email));

  if (!storedHash) {
    // Key expired or was never set
    return { valid: false, code: 'OTP_EXPIRED' };
  }

  // 3. Compare hashes
  if (!compareOtp(rawOtp, storedHash)) {
    // Increment attempt counter; give it the same TTL as the OTP
    const newCount = await store.incr(attemptsKey(email));
    // On the first increment Redis creates the key, so set its TTL
    if (newCount === 1) {
      await store.expire(attemptsKey(email), OTP_TTL);
    }
    return { valid: false, code: 'OTP_INVALID' };
  }

  // 4. Valid — consume everything
  await store.del(otpKey(email), attemptsKey(email), resendKey(email));
  return { valid: true };
};

/**
 * Check whether a resend is allowed (enforces cooldown).
 * @param {string} email
 * @returns {Promise<{ allowed: boolean, retryAfterMs?: number }>}
 */
export const canResendOtp = async (email) => {
  const cooldownExists = await store.exists(resendKey(email));

  if (!cooldownExists) {
    return { allowed: true };
  }

  // Get remaining TTL to tell the user how long to wait
  const remaining = await store.ttl(resendKey(email));
  return {
    allowed: false,
    retryAfterMs: (remaining > 0 ? remaining : 1) * 1000,
  };
};

/**
 * Invalidate/delete any stored OTP for a given email.
 * @param {string} email
 */
export const invalidateOtp = async (email) => {
  await store.del(otpKey(email), attemptsKey(email), resendKey(email));
};

