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

const router = Router();

/**
 * PUBLIC ROUTES
 * These endpoints enforce data schema validation but do not require JWT authorization.
 */
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh-token', validate(refreshTokenSchema), refreshToken);

/**
 * EMAIL OTP VERIFICATION ROUTES
 */
router.post('/verify-email', validate(verifyEmailSchema), verifyEmail);
router.post('/resend-otp', validate(resendOtpSchema), resendOtp);

/**
 * GOOGLE OAUTH ROUTES
 */
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false }),
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
