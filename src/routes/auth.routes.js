import { Router } from 'express';
import passport from 'passport';
import {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  verifyEmail,
  resendOtp,
  googleCallback,
  googleExchange,
} from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  oauthExchangeSchema,
  verifyEmailSchema,
  resendOtpSchema,
} from '../validators/auth.validator.js';

import { protect } from '../middlewares/auth.middleware.js';
import rateLimit from '../middlewares/rateLimit.middleware.js';

const router = Router();

// ── Rate Limiter Presets ─────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowSeconds: 900,    // 15 minutes
  maxRequests: 5,
  keyPrefix: 'login',
});

const registerLimiter = rateLimit({
  windowSeconds: 900,
  maxRequests: 5,
  keyPrefix: 'register',
});

const refreshLimiter = rateLimit({
  windowSeconds: 900,
  maxRequests: 20,
  keyPrefix: 'refresh',
});

const verifyEmailLimiter = rateLimit({
  windowSeconds: 900,
  maxRequests: 10,
  keyPrefix: 'verify-email',
});

const resendOtpLimiter = rateLimit({
  windowSeconds: 900,
  maxRequests: 5,
  keyPrefix: 'resend-otp',
});

/**
 * PUBLIC ROUTES
 * These endpoints enforce data schema validation but do not require JWT authorization.
 * Rate limiters run BEFORE validation to block abusive IPs early.
 */
router.post('/register', registerLimiter, validate(registerSchema), register);
router.post('/login', loginLimiter, validate(loginSchema), login);
router.post('/refresh-token', refreshLimiter, validate(refreshTokenSchema), refreshToken);

/**
 * EMAIL OTP VERIFICATION ROUTES
 */
router.post('/verify-email', verifyEmailLimiter, validate(verifyEmailSchema), verifyEmail);
router.post('/resend-otp', resendOtpLimiter, validate(resendOtpSchema), resendOtp);

/**
 * GOOGLE OAUTH ROUTES
 */
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
  '/google/callback',
  (req, res, next) => {
    passport.authenticate('google', { session: false }, (err, user) => {
      const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
      
      if (err) {
        const message = encodeURIComponent(err.message || 'Google authentication failed');
        return res.redirect(`${FRONTEND_URL}/login?error=${message}`);
      }

      if (!user) {
        return res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent('Google authentication failed. Please try again.')}`);
      }

      // Attach user for the next handler
      req.user = user;
      next();
    })(req, res, next);
  },
  googleCallback
);

router.post('/google/exchange', validate(oauthExchangeSchema), googleExchange);

/**
 * PROTECTED ROUTES 
 * These endpoints require a valid access token to be present via the `protect` middleware.
 */
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);

export default router;
