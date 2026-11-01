import type { RequestHandler } from 'express';
import {
  getLocationSharingConsent,
  getLocationSharingConsentHistory,
  grantLocationSharingConsent,
  revokeLocationSharingConsent,
} from '../services/consentService.js';

function respond(res: Parameters<RequestHandler>[1], status: number, data: unknown): void {
  res.status(status).json({ data, requestId: res.req.requestId });
}

export const getLocationConsentController: RequestHandler = async (req, res) => {
  respond(res, 200, await getLocationSharingConsent(req.auth!.userId));
};

export const getLocationConsentHistoryController: RequestHandler = async (req, res) => {
  respond(res, 200, {
    history: await getLocationSharingConsentHistory(req.auth!.userId),
  });
};

export const grantLocationConsentController: RequestHandler = async (req, res) => {
  respond(
    res,
    201,
    await grantLocationSharingConsent(
      req.auth!.userId,
      req.body.familyId,
      req.body.policyVersion,
      req.body.confirmed,
    ),
  );
};

export const revokeLocationConsentController: RequestHandler = async (req, res) => {
  const familyId = req.params.familyId;
  if (typeof familyId !== 'string') {
    res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'The request could not be completed.' },
      requestId: req.requestId,
    });
    return;
  }
  respond(res, 200, await revokeLocationSharingConsent(req.auth!.userId, familyId));
};
