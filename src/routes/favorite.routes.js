import { Router } from 'express';
import {
  addFavorite,
  removeFavorite,
  getFavorites,
  getFavoriteIds,
} from '../controllers/favorite.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validateQuery } from '../middlewares/validate.middleware.js';
import {
  favoriteParamsSchema,
  favoriteQuerySchema,
  validateParams,
} from '../validators/favorite.validator.js';

const router = Router();

// ── Authentication ───────────────────────────────────────────────────
// All favorite endpoints require an authenticated user session
router.use(protect);

// ── Static / Specific Endpoints ──────────────────────────────────────
// CRITICAL: Must be registered BEFORE dynamic /:propertyId routes to prevent routing conflicts
router.get('/ids', getFavoriteIds);

// ── Collection Endpoints ─────────────────────────────────────────────
router.get('/', validateQuery(favoriteQuerySchema), getFavorites);

// ── Parametric Endpoints ─────────────────────────────────────────────
router.post('/:propertyId', validateParams(favoriteParamsSchema), addFavorite);
router.delete('/:propertyId', validateParams(favoriteParamsSchema), removeFavorite);

export default router;
