import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../config/env.js';

export function auditSecurityEvent(event: string, req: Request, userId?: string): void {
  console.info(
    JSON.stringify({
      type: 'security_audit',
      event,
      ...(userId
        ? {
            subjectRef: createHmac('sha256', env.AUTH_TOKEN_PEPPER)
              .update(userId)
              .digest('hex')
              .slice(0, 24),
          }
        : {}),
      requestId: req.requestId,
      occurredAt: new Date().toISOString(),
    }),
  );
}
