import type { RequestHandler } from 'express';
import { corsOrigins } from '../config/env.js';
import { csrfTokensMatch } from '../services/authService.js';
import { ApiError } from '../utils/ApiError.js';

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfProtection: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (origin && !corsOrigins.includes(origin)) {
    next(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'This request origin is not allowed.'));
    return;
  }

  const hasBrowserSession = Boolean(req.cookies?.fs_access || req.cookies?.fs_refresh);
  if (unsafeMethods.has(req.method) && hasBrowserSession) {
    const cookieToken = req.cookies?.fs_csrf;
    const headerToken = req.get('x-csrf-token');
    if (
      typeof cookieToken !== 'string' ||
      typeof headerToken !== 'string' ||
      !csrfTokensMatch(cookieToken, headerToken)
    ) {
      next(new ApiError(403, 'CSRF_VALIDATION_FAILED', 'The request could not be verified.'));
      return;
    }
  }

  next();
};
