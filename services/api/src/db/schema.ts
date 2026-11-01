import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: varchar('full_name', { length: 100 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    phone: varchar('phone', { length: 16 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    status: varchar('status', { length: 32 }).notNull().default('pending_verification'),
    profileImageUrl: varchar('profile_image_url', { length: 2048 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
    uniqueIndex('users_phone_unique').on(table.phone),
    index('users_status_idx').on(table.status),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedByTokenHash: varchar('replaced_by_token_hash', { length: 64 }),
    deviceInfo: varchar('device_info', { length: 256 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_unique').on(table.tokenHash),
    index('refresh_tokens_user_session_idx').on(
      table.userId,
      table.sessionId,
      table.revokedAt,
      table.expiresAt,
    ),
    index('refresh_tokens_expiry_idx').on(table.expiresAt),
  ],
);

export const otpVerifications = pgTable(
  'otp_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 32 }).notNull(),
    otpHash: varchar('otp_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    purgeAt: timestamp('purge_at', { withTimezone: true }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    ...timestamps,
  },
  (table) => [
    index('otp_verifications_user_purpose_status_created_idx').on(
      table.userId,
      table.purpose,
      table.status,
      table.createdAt,
    ),
    index('otp_verifications_purge_idx').on(table.purgeAt),
  ],
);

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    consentType: varchar('consent_type', { length: 32 }).notNull(),
    granted: boolean('granted').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    version: varchar('version', { length: 32 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('consents_user_type_created_idx').on(table.userId, table.consentType, table.createdAt),
  ],
);

export const schema = { users, refreshTokens, otpVerifications, consents };
