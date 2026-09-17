import { Router } from 'express';
import { getProfile, updateProfile } from '../controllers/user.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { updateProfileSchema } from '../validators/user.validator.js';

const router = Router();

/**
 * All user profile routes require authentication.
 */
router.use(protect);

/**
 * GET  /api/v1/users/me   → Fetch own profile
 * PATCH /api/v1/users/me  → Update own profile
 */
router.get('/me', getProfile);
router.patch('/me', validate(updateProfileSchema), updateProfile);

export default router;
