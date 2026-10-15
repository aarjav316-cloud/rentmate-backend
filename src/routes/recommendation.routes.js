import { Router } from 'express';
import { getRecommendedProperties } from '../controllers/recommendation.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validateQuery } from '../middlewares/validate.middleware.js';
import { recommendationQuerySchema } from '../validators/recommendation.validator.js';

const router = Router();

// ── All routes are protected ─────────────────────────────────────────

router.get('/properties', protect, validateQuery(recommendationQuerySchema), getRecommendedProperties);

export default router;
