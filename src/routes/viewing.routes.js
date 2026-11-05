import { Router } from 'express';
import {
  createViewing,
  getMyViewings,
  getReceivedViewings,
  getViewingById,
  updateViewingStatus,
} from '../controllers/viewing.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validate, validateQuery } from '../middlewares/validate.middleware.js';
import {
  createViewingSchema,
  updateViewingStatusSchema,
  viewingParamsSchema,
  viewingQuerySchema,
  validateParams,
} from '../validators/viewing.validator.js';

const router = Router();

// ── Authentication ───────────────────────────────────────────────────
// All property viewing endpoints require an authenticated user session
router.use(protect);

// ── Collection Endpoints ─────────────────────────────────────────────
// POST /api/v1/viewings - Book a new viewing appointment request
router.post('/', validate(createViewingSchema), createViewing);

// ── Static / Specific Endpoints ──────────────────────────────────────
// CRITICAL: Must be registered BEFORE dynamic /:id to prevent routing collisions
// GET /api/v1/viewings/my - Get viewing appointments for authenticated tenant
router.get('/my', validateQuery(viewingQuerySchema), getMyViewings);

// GET /api/v1/viewings/received - Get viewing appointments received by authenticated owner
router.get('/received', validateQuery(viewingQuerySchema), getReceivedViewings);

// ── Parametric Endpoints ─────────────────────────────────────────────
// GET /api/v1/viewings/:id - View details of a specific viewing appointment
router.get('/:id', validateParams(viewingParamsSchema), getViewingById);

// PATCH /api/v1/viewings/:id/status - Update appointment status (confirm/reject/reschedule/cancel/complete)
router.patch(
  '/:id/status',
  validateParams(viewingParamsSchema),
  validate(updateViewingStatusSchema),
  updateViewingStatus
);

export default router;
