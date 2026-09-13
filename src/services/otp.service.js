import { hashOtp, compareOtp } from '../utils/otp.utils.js';

/**
 * In-memory OTP store — a clean abstraction that can be swapped to Redis later
 * without changing any consumer code.
 *
 * Each entry is keyed by email and stores:
 *   otpHash      – SHA-256 hash of the OTP (never the raw value)
 *   expiresAt    – timestamp when the OTP becomes invalid
 *   attempts     – number of failed verification attempts
 *   lastSentAt   – timestamp of last OTP dispatch (for resend cooldown)
 */
const otpStore = new Map();

const OTP_EXPIRES_IN_MS = (parseInt(process.env.OTP_EXPIRES_IN, 10) || 300) * 1000; // default 5 min
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5;
const OTP_RESEND_COOLDOWN_MS = (parseInt(process.env.OTP_RESEND_COOLDOWN, 10) || 60) * 1000; // default 60s

/**
 * Store a hashed OTP for a given email.
 * Overwrites any previously stored OTP for the same email.
 * @param {string} email
 * @param {string} rawOtp - The plaintext OTP (will be hashed before storage)
 */
export const storeOtp = (email, rawOtp) => {
  const key = email.toLowerCase();
  otpStore.set(key, {
    otpHash: hashOtp(rawOtp),
    expiresAt: Date.now() + OTP_EXPIRES_IN_MS,
    attempts: 0,
    lastSentAt: Date.now(),
  });
};

/**
 * Verify an OTP for a given email.
 * Returns an object { valid, code } where code is the error reason if invalid.
 * Automatically deletes the record on success.
 * @param {string} email
 * @param {string} rawOtp
 * @returns {{ valid: boolean, code?: string }}
 */
export const verifyOtp = (email, rawOtp) => {
  const key = email.toLowerCase();
  const record = otpStore.get(key);

  if (!record) {
    return { valid: false, code: 'OTP_EXPIRED' };
  }

  // Check expiration
  if (Date.now() > record.expiresAt) {
    otpStore.delete(key);
    return { valid: false, code: 'OTP_EXPIRED' };
  }

  // Check max attempts
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    otpStore.delete(key);
    return { valid: false, code: 'TOO_MANY_ATTEMPTS' };
  }

  // Compare hashes
  if (!compareOtp(rawOtp, record.otpHash)) {
    record.attempts += 1;
    return { valid: false, code: 'OTP_INVALID' };
  }

  // Success — consume it
  otpStore.delete(key);
  return { valid: true };
};

/**
 * Check whether a resend is allowed (enforces cooldown).
 * @param {string} email
 * @returns {{ allowed: boolean, retryAfterMs?: number }}
 */
export const canResendOtp = (email) => {
  const key = email.toLowerCase();
  const record = otpStore.get(key);

  if (!record) {
    return { allowed: true };
  }

  const elapsed = Date.now() - record.lastSentAt;
  if (elapsed < OTP_RESEND_COOLDOWN_MS) {
    return { allowed: false, retryAfterMs: OTP_RESEND_COOLDOWN_MS - elapsed };
  }

  return { allowed: true };
};

/**
 * Invalidate/delete any stored OTP for a given email.
 * @param {string} email
 */
export const invalidateOtp = (email) => {
  otpStore.delete(email.toLowerCase());
};
