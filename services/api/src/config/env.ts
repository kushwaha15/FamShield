import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(32),
  AUTH_TOKEN_PEPPER: z.string().min(32),
  AUTH_DEV_OTP_EXPOSE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  OTP_TTL_MINUTES: z.coerce.number().int().min(5).max(15).default(10),
  SMS_PROVIDER: z.enum(['development', 'twilio', 'http']).default('development'),
  EMAIL_PROVIDER: z.enum(['development', 'http']).default('development'),
  SMS_HTTP_URL: z.string().url().optional(),
  SMS_HTTP_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  EMAIL_HTTP_URL: z.string().url().optional(),
  EMAIL_HTTP_API_KEY: z.string().optional(),
});

const parsedEnvironment = environmentSchema
  .superRefine((config, context) => {
    if (
      config.DATABASE_URL &&
      !['postgres:', 'postgresql:'].includes(new URL(config.DATABASE_URL).protocol)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL must use the PostgreSQL protocol.',
      });
    }

    const origins = config.CORS_ORIGINS.split(',').map((origin) => origin.trim());
    for (const origin of origins) {
      try {
        const parsedOrigin = new URL(origin);
        if (
          parsedOrigin.origin !== origin ||
          (config.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:')
        ) {
          throw new Error('Invalid origin.');
        }
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'CORS origins must be valid origins (HTTPS in production).',
        });
        break;
      }
    }

    if (config.NODE_ENV === 'production' && config.AUTH_DEV_OTP_EXPOSE) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_DEV_OTP_EXPOSE'],
        message: 'Development OTP exposure must be disabled in production.',
      });
    }

    if (config.NODE_ENV === 'production' && config.SMS_PROVIDER === 'development') {
      context.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'A real SMS provider must be configured in production.',
      });
    }

    if (config.NODE_ENV === 'production' && config.EMAIL_PROVIDER === 'development') {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: 'A real email provider must be configured in production.',
      });
    }

    if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'A production PostgreSQL connection URL is required.',
      });
    }

    for (const key of ['SMS_HTTP_URL', 'EMAIL_HTTP_URL'] as const) {
      const endpoint = config[key];
      if (config.NODE_ENV === 'production' && endpoint && !endpoint.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Provider endpoints must use HTTPS in production.',
        });
      }
    }

    if (config.JWT_ACCESS_SECRET === config.AUTH_TOKEN_PEPPER) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_TOKEN_PEPPER'],
        message: 'JWT and token hashing secrets must be independent.',
      });
    }

    if (config.SMS_PROVIDER === 'http' && (!config.SMS_HTTP_URL || !config.SMS_HTTP_API_KEY)) {
      context.addIssue({
        code: 'custom',
        path: ['SMS_HTTP_URL'],
        message: 'SMS_HTTP_URL and SMS_HTTP_API_KEY are required for the HTTP SMS provider.',
      });
    }

    if (
      config.SMS_PROVIDER === 'twilio' &&
      (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_FROM_NUMBER)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['TWILIO_ACCOUNT_SID'],
        message: 'Twilio account SID, auth token, and sender number are required.',
      });
    }

    if (
      config.EMAIL_PROVIDER === 'http' &&
      (!config.EMAIL_HTTP_URL || !config.EMAIL_HTTP_API_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_HTTP_URL'],
        message: 'EMAIL_HTTP_URL and EMAIL_HTTP_API_KEY are required for the HTTP email provider.',
      });
    }
  })
  .safeParse(process.env);

if (!parsedEnvironment.success) {
  console.error('Invalid environment configuration:', z.treeifyError(parsedEnvironment.error));
  process.exit(1);
}

export const env = parsedEnvironment.data;
export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
