import { Router } from 'express';
import {
  getLocationConsentController,
  getLocationConsentHistoryController,
  grantLocationConsentController,
  revokeLocationConsentController,
} from '../controllers/consentController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validateBody.js';
import {
  grantLocationConsentSchema,
  locationConsentFamilyParamsSchema,
} from '../validators/consents.js';

export const consentsRouter = Router();

consentsRouter.use(authenticate);
consentsRouter.get('/location-sharing', getLocationConsentController);
consentsRouter.get('/location-sharing/history', getLocationConsentHistoryController);
consentsRouter.post(
  '/location-sharing',
  validateBody(grantLocationConsentSchema),
  grantLocationConsentController,
);
consentsRouter.delete(
  '/location-sharing/:familyId',
  (req, _res, next) => {
    try {
      req.params = locationConsentFamilyParamsSchema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  },
  revokeLocationConsentController,
);
