import { Router } from 'express';
import {
  createRentalRequest,
  getMyRentalRequests,
  getReceivedRentalRequests,
  getRentalRequestById,
  updateRentalRequestStatus,
} from '../controllers/rentalRequest.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validate, validateQuery } from '../middlewares/validate.middleware.js';
import {
  createRentalRequestSchema,
  updateRentalRequestStatusSchema,
  rentalRequestParamsSchema,
  rentalRequestQuerySchema,
  validateParams,
} from '../validators/rentalRequest.validator.js';

const router = Router();

// ── Authentication ───────────────────────────────────────────────────
// All rental request endpoints require an authenticated user session
router.use(protect);

// ── Collection Endpoints ─────────────────────────────────────────────
// POST /api/v1/rental-requests - Submit a new rental application
router.post('/', validate(createRentalRequestSchema), createRentalRequest);

// ── Static / Specific Endpoints ──────────────────────────────────────
// CRITICAL: Must be registered BEFORE dynamic /:id to prevent routing collisions
// GET /api/v1/rental-requests/my - Get applications submitted by authenticated tenant
router.get('/my', validateQuery(rentalRequestQuerySchema), getMyRentalRequests);

// GET /api/v1/rental-requests/received - Get applications received by authenticated owner
router.get('/received', validateQuery(rentalRequestQuerySchema), getReceivedRentalRequests);

// ── Parametric Endpoints ─────────────────────────────────────────────
// GET /api/v1/rental-requests/:id - View details of a specific application
router.get('/:id', validateParams(rentalRequestParamsSchema), getRentalRequestById);

// PATCH /api/v1/rental-requests/:id/status - Update application status (accept/reject/cancel)
router.patch(
  '/:id/status',
  validateParams(rentalRequestParamsSchema),
  validate(updateRentalRequestStatusSchema),
  updateRentalRequestStatus
);

export default router;
