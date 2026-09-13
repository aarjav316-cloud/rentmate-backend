import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  getMe,
} from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
} from '../validators/auth.validator.js';

// Note: To fulfill the 'authentication middleware against protected routes' rule,
// we import `protect` assuming it will be created next in the architecture.
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
 * PROTECTED ROUTES 
 * These endpoints require a valid access token to be present via the `protect` middleware.
 */
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);

export default router;
