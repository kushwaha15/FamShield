import type { RequestHandler } from 'express';
import { authenticateAccessToken, getAccessTokenFromRequest } from '../services/authService.js';
import { ApiError } from '../utils/ApiError.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = getAccessTokenFromRequest(req);
    if (!token) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
    }
    req.auth = await authenticateAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
};
