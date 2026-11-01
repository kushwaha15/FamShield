import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import {
  forgotPassword,
  getCsrfToken,
  listActiveSessions,
  loginUser,
  logout,
  logoutEverywhere,
  refreshSession,
  register,
  resendVerificationCode,
  resetPasswordController,
  revokeActiveSession,
  verifyEmailAddress,
  verifyPhoneNumber,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validateBody.js';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registrationSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verificationSchema,
} from '../validators/auth.js';

const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? 'unknown')}:${req.path}`,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authentication attempts. Please try again later.',
      },
      requestId: req.requestId,
    });
  },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? 'unknown')}:${req.path}`,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many verification attempts. Please try again later.',
      },
      requestId: req.requestId,
    });
  },
});

authRouter.get('/csrf', getCsrfToken);
authRouter.post('/register', authLimiter, validateBody(registrationSchema), register);
authRouter.post('/verify-phone', otpLimiter, validateBody(verificationSchema), verifyPhoneNumber);
authRouter.post('/verify-email', otpLimiter, validateBody(verificationSchema), verifyEmailAddress);
authRouter.post('/resend-otp', otpLimiter, validateBody(resendOtpSchema), resendVerificationCode);
authRouter.post('/login', authLimiter, validateBody(loginSchema), loginUser);
authRouter.post('/refresh', authLimiter, validateBody(refreshSchema), refreshSession);
authRouter.post('/logout', validateBody(refreshSchema), logout);
authRouter.post('/logout-all', authenticate, logoutEverywhere);
authRouter.get('/sessions', authenticate, listActiveSessions);
authRouter.delete('/sessions/:sessionId', authenticate, revokeActiveSession);
authRouter.post(
  '/forgot-password',
  authLimiter,
  validateBody(forgotPasswordSchema),
  forgotPassword,
);
authRouter.post(
  '/reset-password',
  otpLimiter,
  validateBody(resetPasswordSchema),
  resetPasswordController,
);

export { authRouter };
