import { Router } from 'express';
import {
  createPropertyPreference,
  getMyPropertyPreference,
  updateMyPropertyPreference,
  deleteMyPropertyPreference,
} from '../controllers/propertyPreference.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createPropertyPreferenceSchema,
  updatePropertyPreferenceSchema,
} from '../validators/propertyPreference.validator.js';

const router = Router();

// ── All routes are protected ─────────────────────────────────────────

router.post('/', protect, validate(createPropertyPreferenceSchema), createPropertyPreference);
router.get('/', protect, getMyPropertyPreference);
router.patch('/', protect, validate(updatePropertyPreferenceSchema), updateMyPropertyPreference);
router.delete('/', protect, deleteMyPropertyPreference);

export default router;
