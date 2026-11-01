import type { RequestHandler } from 'express';
import {
  changeLocationSharingSession,
  getCurrentFamilyLocations,
  startLocationSharing,
  updateLocationPosition,
} from '../services/locationService.js';

function respond(res: Parameters<RequestHandler>[1], status: number, data: unknown): void {
  res.status(status).json({ data, requestId: res.req.requestId });
}

function param(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

export const startLocationSharingController: RequestHandler = async (req, res) => {
  respond(res, 201, await startLocationSharing(req.auth!.userId, param(req.params.familyId)));
};

export const pauseLocationSharingController: RequestHandler = async (req, res) => {
  respond(
    res,
    200,
    await changeLocationSharingSession(
      req.auth!.userId,
      param(req.params.familyId),
      param(req.params.sessionId),
      'pause',
    ),
  );
};

export const resumeLocationSharingController: RequestHandler = async (req, res) => {
  respond(
    res,
    200,
    await changeLocationSharingSession(
      req.auth!.userId,
      param(req.params.familyId),
      param(req.params.sessionId),
      'resume',
    ),
  );
};

export const stopLocationSharingController: RequestHandler = async (req, res) => {
  respond(
    res,
    200,
    await changeLocationSharingSession(
      req.auth!.userId,
      param(req.params.familyId),
      param(req.params.sessionId),
      'stop',
    ),
  );
};

export const updateLocationPositionController: RequestHandler = async (req, res) => {
  respond(
    res,
    200,
    await updateLocationPosition(
      req.auth!.userId,
      param(req.params.familyId),
      param(req.params.sessionId),
      req.body,
    ),
  );
};

export const getCurrentFamilyLocationsController: RequestHandler = async (req, res) => {
  respond(res, 200, {
    locations: await getCurrentFamilyLocations(req.auth!.userId, param(req.params.familyId)),
    precisionDecimalPlaces: 4,
    staleAfterSeconds: 120,
  });
};
