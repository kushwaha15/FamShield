import { Router, type RequestHandler } from 'express';
import {
  getCurrentFamilyLocationsController,
  pauseLocationSharingController,
  resumeLocationSharingController,
  startLocationSharingController,
  stopLocationSharingController,
  updateLocationPositionController,
} from '../controllers/locationController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validateBody.js';
import {
  locationFamilyParamsSchema,
  locationPositionSchema,
  locationSessionParamsSchema,
} from '../validators/locations.js';

export const locationsRouter = Router();

locationsRouter.use(authenticate);

function validateParams(
  schema: typeof locationFamilyParamsSchema | typeof locationSessionParamsSchema,
): RequestHandler {
  return (req, _res, next) => {
    try {
      Object.assign(req.params, schema.parse(req.params));
      next();
    } catch (error) {
      next(error);
    }
  };
}

locationsRouter.get(
  '/families/:familyId/locations',
  validateParams(locationFamilyParamsSchema),
  getCurrentFamilyLocationsController,
);
locationsRouter.post(
  '/families/:familyId/location-sharing/sessions',
  validateParams(locationFamilyParamsSchema),
  startLocationSharingController,
);
locationsRouter.post(
  '/families/:familyId/location-sharing/sessions/:sessionId/pause',
  validateParams(locationSessionParamsSchema),
  pauseLocationSharingController,
);
locationsRouter.post(
  '/families/:familyId/location-sharing/sessions/:sessionId/resume',
  validateParams(locationSessionParamsSchema),
  resumeLocationSharingController,
);
locationsRouter.post(
  '/families/:familyId/location-sharing/sessions/:sessionId/stop',
  validateParams(locationSessionParamsSchema),
  stopLocationSharingController,
);
locationsRouter.put(
  '/families/:familyId/location-sharing/sessions/:sessionId/position',
  validateParams(locationSessionParamsSchema),
  validateBody(locationPositionSchema),
  updateLocationPositionController,
);
