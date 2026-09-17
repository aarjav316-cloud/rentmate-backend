import { Router } from 'express';
import {
  createProperty,
  getProperties,
  getPropertyById,
  updateProperty,
  deleteProperty,
  getMyProperties,
} from '../controllers/property.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createPropertySchema,
  updatePropertySchema,
} from '../validators/property.validator.js';

const router = Router();

// ── Public Routes ────────────────────────────────────────────────────
router.get('/', getProperties);

// ── Protected Routes ─────────────────────────────────────────────────

// IMPORTANT: /my must be registered BEFORE /:id to prevent Express
// from treating "my" as a dynamic :id parameter.
router.get('/my', protect, getMyProperties);

router.get('/:id', getPropertyById);

router.post('/', protect, validate(createPropertySchema), createProperty);
router.patch('/:id', protect, validate(updatePropertySchema), updateProperty);
router.delete('/:id', protect, deleteProperty);

export default router;
