import { Router } from 'express';
import {
  acceptInvitationController,
  createFamilyController,
  createInvitationController,
  declineInvitationController,
  getFamilyController,
  getFamilyMembersController,
  leaveFamilyController,
  listFamiliesController,
  listFamilyInvitationsController,
  listMyInvitationsController,
  removeFamilyMemberController,
  revokeInvitationController,
  transferOwnershipController,
} from '../controllers/familyController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validateBody.js';
import {
  createFamilySchema,
  createInvitationSchema,
  familyIdSchema,
  familyInvitationIdSchema,
  familyUserIdSchema,
  invitationTokenSchema,
  transferOwnershipSchema,
} from '../validators/families.js';

export const familiesRouter = Router();
export const invitationsRouter = Router();

familiesRouter.use(authenticate);
familiesRouter.post('/', validateBody(createFamilySchema), createFamilyController);
familiesRouter.get('/', listFamiliesController);
familiesRouter.get(
  '/:familyId',
  (req, _res, next) => {
    try {
      req.params = familyIdSchema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  },
  getFamilyController,
);
familiesRouter.get(
  '/:familyId/members',
  (req, _res, next) => {
    try {
      req.params = familyIdSchema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  },
  getFamilyMembersController,
);
familiesRouter.post(
  '/:familyId/invitations',
  (req, _res, next) => {
    try {
      req.params = familyIdSchema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  },
  validateBody(createInvitationSchema),
  createInvitationController,
);
familiesRouter.get(
  '/:familyId/invitations',
  (req, _res, next) => {
    try {
      req.params = familyIdSchema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  },
  listFamilyInvitationsController,
);
familiesRouter.delete(
  '/:familyId/invitations/:invitationId',
  (req, _res, next) => {
    try {
      req.params = familyInvitationIdSchema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  },
  revokeInvitationController,
);
familiesRouter.delete(
  '/:familyId/members/:userId',
  (req, _res, next) => {
    try {
      req.params = familyUserIdSchema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  },
  removeFamilyMemberController,
);
familiesRouter.post(
  '/:familyId/leave',
  (req, _res, next) => {
    try {
      req.params = familyIdSchema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  },
  leaveFamilyController,
);
familiesRouter.post(
  '/:familyId/transfer-ownership',
  (req, _res, next) => {
    try {
      req.params = familyIdSchema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  },
  validateBody(transferOwnershipSchema),
  transferOwnershipController,
);

invitationsRouter.use(authenticate);
invitationsRouter.get('/', listMyInvitationsController);
invitationsRouter.post('/accept', validateBody(invitationTokenSchema), acceptInvitationController);
invitationsRouter.post(
  '/decline',
  validateBody(invitationTokenSchema),
  declineInvitationController,
);
