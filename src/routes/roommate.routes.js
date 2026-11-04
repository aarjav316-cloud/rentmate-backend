import { Router } from 'express';
import {
  createProfile,
  getMyProfile,
  updateProfile,
  deactivateProfile,
  discoverRoommates,
  interactWithRoommate,
  getMyMatches,
  closeMatch,
} from '../controllers/roommate.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validate, validateQuery } from '../middlewares/validate.middleware.js';
import {
  createRoommateProfileSchema,
  updateRoommateProfileSchema,
  roommateDiscoveryQuerySchema,
  roommateInteractionSchema,
} from '../validators/roommate.validator.js';

const router = Router();

// ── Authentication ───────────────────────────────────────────────────
// All roommate routes require an authenticated user session
router.use(protect);

// ── Profile Endpoints ────────────────────────────────────────────────
router.get('/profile/me', getMyProfile);
router.post('/profile/me', validate(createRoommateProfileSchema), createProfile);
router.patch('/profile/me', validate(updateRoommateProfileSchema), updateProfile);
router.delete('/profile/me', deactivateProfile);

// ── Discovery Endpoint ───────────────────────────────────────────────
router.get('/discover', validateQuery(roommateDiscoveryQuerySchema), discoverRoommates);

// ── Match Endpoints ──────────────────────────────────────────────────
router.get('/matches', getMyMatches);
router.patch('/matches/:matchId', closeMatch);

// ── Interaction Endpoint ─────────────────────────────────────────────
router.post(
  '/:userId/interaction',
  validate(roommateInteractionSchema),
  (req, res, next) => {
    // Map URL parameter :userId to toUserId/id for controller flexibility
    if (req.params.userId) {
      req.params.toUserId = req.params.toUserId || req.params.userId;
      req.params.id = req.params.id || req.params.userId;
    }
    return interactWithRoommate(req, res, next);
  }
);

export default router;
