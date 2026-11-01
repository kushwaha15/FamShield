import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { corsOrigins, env } from './config/env.js';
import { authRouter } from './routes/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { csrfProtection } from './middleware/csrfProtection.js';
import { healthRouter } from './routes/health.js';
import { usersRouter } from './routes/users.js';
import { familiesRouter, invitationsRouter } from './routes/families.js';
import { consentsRouter } from './routes/consents.js';
import { locationsRouter } from './routes/locations.js';
import { ApiError } from './utils/ApiError.js';

export const app = express();
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      },
      requestId: req.requestId,
    });
  },
});

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'This request origin is not allowed.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  }),
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});
app.use(apiLimiter);
app.use(requestLogger);
app.use(csrfProtection);
app.use('/api', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/families', familiesRouter);
app.use('/api/invitations', invitationsRouter);
app.use('/api/consents', consentsRouter);
app.use('/api', locationsRouter);
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    },
    requestId: req.requestId,
  });
});
app.use(errorHandler);

if (env.NODE_ENV === 'production' || env.NODE_ENV === 'test') {
  app.set('trust proxy', 1);
}
