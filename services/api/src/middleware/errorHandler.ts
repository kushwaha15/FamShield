import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  if (res.headersSent) {
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
      },
      requestId: res.req.requestId,
    });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
      requestId: res.req.requestId,
    });
    return;
  }

  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
    res.status(409).json({
      error: { code: 'CONFLICT', message: 'The request conflicts with an existing record.' },
      requestId: res.req.requestId,
    });
    return;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'CastError'
  ) {
    res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'The request could not be completed.' },
      requestId: res.req.requestId,
    });
    return;
  }

  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 500;

  if (status >= 500) {
    console.error('Unhandled API error:', error instanceof Error ? error.name : 'Unknown error');
  }

  res.status(status).json({
    error: {
      code: status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR',
      message:
        status >= 500 ? 'An unexpected error occurred.' : 'The request could not be completed.',
    },
    requestId: res.req.requestId,
  });
};
