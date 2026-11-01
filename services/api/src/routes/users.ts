import { Router } from 'express';
import {
  deleteCurrentUser,
  getCurrentUser,
  updateCurrentUser,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validateBody.js';
import { deleteAccountSchema, profileUpdateSchema } from '../validators/auth.js';

const usersRouter = Router();

usersRouter.use(authenticate);
usersRouter.get('/me', getCurrentUser);
usersRouter.patch('/me', validateBody(profileUpdateSchema), updateCurrentUser);
usersRouter.delete('/me', validateBody(deleteAccountSchema), deleteCurrentUser);

export { usersRouter };
