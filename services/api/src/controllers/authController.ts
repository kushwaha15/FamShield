import type { RequestHandler } from 'express';
import {
  clearAuthCookies,
  createCsrfToken,
  deleteAccount,
  getRefreshTokenFromCookies,
  getProfile,
  listSessions,
  login,
  registerUser,
  resendOtp,
  resetPassword,
  revokeAllSessions,
  revokeRefreshToken,
  revokeSession,
  rotateRefreshToken,
  setAuthCookies,
  shouldExposeDevelopmentOtp,
  startPasswordReset,
  updateProfile,
  verifyEmail,
  verifyPhone,
} from '../services/authService.js';
import { ApiError } from '../utils/ApiError.js';
import { auditSecurityEvent } from '../utils/audit.js';
import { z } from 'zod';

function respond(res: Parameters<RequestHandler>[1], status: number, data: unknown): void {
  res.status(status).json({
    data,
    requestId: res.req.requestId,
  });
}

export const register: RequestHandler = async (req, res) => {
  const result = await registerUser(req.body, req);
  respond(res, 202, {
    message: 'If the details are eligible, verification codes have been sent.',
    ...(result.developmentOtp ? { developmentOtp: result.developmentOtp } : {}),
  });
};

export const verifyEmailAddress: RequestHandler = async (req, res) => {
  await verifyEmail(req.body.email, req.body.code, req);
  respond(res, 200, { message: 'Email verification completed.' });
};

export const verifyPhoneNumber: RequestHandler = async (req, res) => {
  await verifyPhone(req.body.phone, req.body.code, req);
  respond(res, 200, { message: 'Phone verification completed.' });
};

export const resendVerificationCode: RequestHandler = async (req, res) => {
  const code = await resendOtp(req.body.identifier, req.body.purpose);
  respond(res, 202, {
    message: 'If the account is eligible, a verification code has been sent.',
    ...(code && shouldExposeDevelopmentOtp() ? { developmentOtp: code } : {}),
  });
};

export const loginUser: RequestHandler = async (req, res) => {
  const { user, tokens } = await login(
    req.body.identifier,
    req.body.password,
    (req.body.deviceInfo ?? req.get('user-agent'))?.slice(0, 256),
    req,
  );
  if (req.body.clientType === 'web') {
    const csrfToken = createCsrfToken();
    setAuthCookies(res, tokens, csrfToken);
    respond(res, 200, { user, csrfToken });
    return;
  }
  respond(res, 200, { user, ...tokens });
};

export const refreshSession: RequestHandler = async (req, res) => {
  const token = getRefreshTokenFromCookies(req) ?? req.body.refreshToken;
  if (!token) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'The session is invalid or expired.');
  }

  const { user, tokens } = await rotateRefreshToken(token, req);
  if (getRefreshTokenFromCookies(req)) {
    const csrfToken = createCsrfToken();
    setAuthCookies(res, tokens, csrfToken);
    respond(res, 200, { user, csrfToken });
    return;
  }
  respond(res, 200, { user, ...tokens });
};

export const logout: RequestHandler = async (req, res) => {
  const token = getRefreshTokenFromCookies(req) ?? req.body.refreshToken;
  await revokeRefreshToken(token, req);
  clearAuthCookies(res);
  respond(res, 200, { message: 'Session signed out.' });
};

export const logoutEverywhere: RequestHandler = async (req, res) => {
  await revokeAllSessions(req.auth!.userId, req);
  clearAuthCookies(res);
  respond(res, 200, { message: 'All sessions signed out.' });
};

export const getCsrfToken: RequestHandler = (_req, res) => {
  const csrfToken = createCsrfToken();
  res.cookie('fs_csrf', csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
  respond(res, 200, { csrfToken });
};

export const forgotPassword: RequestHandler = async (req, res) => {
  const code = await startPasswordReset(req.body.identifier, req.body.channel, req);
  respond(res, 202, {
    message: 'If the account is eligible, password-reset instructions have been sent.',
    ...(code && shouldExposeDevelopmentOtp() ? { developmentOtp: code } : {}),
  });
};

export const resetPasswordController: RequestHandler = async (req, res) => {
  await resetPassword(req.body.identifier, req.body.code, req.body.password, req);
  respond(res, 200, { message: 'Password has been reset. Sign in again on your devices.' });
};

export const listActiveSessions: RequestHandler = async (req, res) => {
  respond(res, 200, { sessions: await listSessions(req.auth!.userId) });
};

export const revokeActiveSession: RequestHandler = async (req, res) => {
  const sessionId = z.string().uuid().parse(req.params.sessionId);
  await revokeSession(req.auth!.userId, sessionId, req);
  respond(res, 200, { message: 'Session revoked.' });
};

export const getCurrentUser: RequestHandler = async (req, res) => {
  respond(res, 200, { user: await getProfile(req.auth!.userId) });
};

export const updateCurrentUser: RequestHandler = async (req, res) => {
  const user = await updateProfile(req.auth!.userId, req.body);
  auditSecurityEvent('profile_updated', req, req.auth!.userId);
  respond(res, 200, { user });
};

export const deleteCurrentUser: RequestHandler = async (req, res) => {
  await deleteAccount(req.auth!.userId, req.body.password, req);
  clearAuthCookies(res);
  respond(res, 200, { message: 'Account deleted.' });
};
