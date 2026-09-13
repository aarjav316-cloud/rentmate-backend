import crypto from 'crypto';

/**
 * Generate a cryptographically secure 6-digit OTP.
 * Uses crypto.randomInt to ensure uniform distribution and allows leading zeroes.
 * @returns {string} A 6-character numeric OTP string (e.g., "048291")
 */
export const generateOtp = () => {
  // randomInt is crypto-secure and gives uniform distribution in [0, 999999]
  const otp = crypto.randomInt(0, 1000000);
  return otp.toString().padStart(6, '0');
};

/**
 * Hash an OTP for secure storage (never store raw OTP).
 * @param {string} otp - The raw OTP string
 * @returns {string} SHA-256 hex digest of the OTP
 */
export const hashOtp = (otp) => {
  return crypto.createHash('sha256').update(otp).digest('hex');
};

/**
 * Compare a raw OTP against a stored hash.
 * @param {string} rawOtp - The raw OTP the user entered
 * @param {string} storedHash - The SHA-256 hash stored during generation
 * @returns {boolean} Whether they match
 */
export const compareOtp = (rawOtp, storedHash) => {
  const inputHash = hashOtp(rawOtp);
  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(storedHash));
  } catch {
    return false;
  }
};
