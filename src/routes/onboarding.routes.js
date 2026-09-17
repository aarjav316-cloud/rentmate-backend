import { Router } from 'express';
import { getOnboarding, saveOnboarding } from '../controllers/onboarding.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { onboardingSchema } from '../validators/onboarding.validator.js';

const router = Router();

/**
 * All onboarding routes require authentication.
 */
router.use(protect);

router.get('/', getOnboarding);
router.post('/', validate(onboardingSchema), saveOnboarding);

export default router;
