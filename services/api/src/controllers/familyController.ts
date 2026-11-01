import type { RequestHandler } from 'express';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
  declineInvitation,
  getFamily,
  getFamilyMembers,
  leaveFamily,
  listFamilies,
  listFamilyInvitations,
  listMyInvitations,
  removeFamilyMember,
  revokeInvitation,
  transferFamilyOwnership,
} from '../services/familyService.js';
import { ApiError } from '../utils/ApiError.js';

function respond(res: Parameters<RequestHandler>[1], status: number, data: unknown): void {
  res.status(status).json({ data, requestId: res.req.requestId });
}

function routeParam(req: Parameters<RequestHandler>[0], name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_REQUEST', 'The request could not be completed.');
  }
  return value;
}

export const createFamilyController: RequestHandler = async (req, res) => {
  respond(res, 201, { family: await createFamily(req.auth!.userId, req.body.name) });
};

export const listFamiliesController: RequestHandler = async (req, res) => {
  respond(res, 200, { families: await listFamilies(req.auth!.userId) });
};

export const getFamilyController: RequestHandler = async (req, res) => {
  respond(res, 200, { family: await getFamily(req.auth!.userId, routeParam(req, 'familyId')) });
};

export const getFamilyMembersController: RequestHandler = async (req, res) => {
  respond(res, 200, {
    members: await getFamilyMembers(req.auth!.userId, routeParam(req, 'familyId')),
  });
};

export const createInvitationController: RequestHandler = async (req, res) => {
  respond(
    res,
    201,
    await createInvitation(req.auth!.userId, routeParam(req, 'familyId'), req.body),
  );
};

export const listFamilyInvitationsController: RequestHandler = async (req, res) => {
  respond(res, 200, {
    invitations: await listFamilyInvitations(req.auth!.userId, routeParam(req, 'familyId')),
  });
};

export const listMyInvitationsController: RequestHandler = async (req, res) => {
  respond(res, 200, { invitations: await listMyInvitations(req.auth!.userId) });
};

export const acceptInvitationController: RequestHandler = async (req, res) => {
  respond(res, 200, { family: await acceptInvitation(req.auth!.userId, req.body.token) });
};

export const declineInvitationController: RequestHandler = async (req, res) => {
  await declineInvitation(req.auth!.userId, req.body.token);
  respond(res, 200, { message: 'Invitation declined.' });
};

export const revokeInvitationController: RequestHandler = async (req, res) => {
  await revokeInvitation(
    req.auth!.userId,
    routeParam(req, 'familyId'),
    routeParam(req, 'invitationId'),
  );
  respond(res, 200, { message: 'Invitation revoked.' });
};

export const removeFamilyMemberController: RequestHandler = async (req, res) => {
  await removeFamilyMember(
    req.auth!.userId,
    routeParam(req, 'familyId'),
    routeParam(req, 'userId'),
  );
  respond(res, 200, { message: 'Family member removed.' });
};

export const leaveFamilyController: RequestHandler = async (req, res) => {
  await leaveFamily(req.auth!.userId, routeParam(req, 'familyId'));
  respond(res, 200, { message: 'You left the family.' });
};

export const transferOwnershipController: RequestHandler = async (req, res) => {
  await transferFamilyOwnership(
    req.auth!.userId,
    routeParam(req, 'familyId'),
    req.body.targetUserId,
  );
  respond(res, 200, { message: 'Family ownership transferred.' });
};
