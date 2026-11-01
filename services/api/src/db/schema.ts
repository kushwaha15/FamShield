import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
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

export const families = pgTable(
  'families',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    check('families_name_check', sql`char_length(btrim(${table.name})) BETWEEN 2 AND 100`),
    index('families_created_by_idx').on(table.createdBy),
  ],
);

export const familyMembers = pgTable(
  'family_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: varchar('role', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('family_members_role_check', sql`${table.role} IN ('owner', 'member')`),
    check('family_members_status_check', sql`${table.status} IN ('active', 'left', 'removed')`),
    check(
      'family_members_lifecycle_check',
      sql`(${table.status} = 'active' AND ${table.leftAt} IS NULL) OR (${table.status} <> 'active' AND ${table.leftAt} IS NOT NULL)`,
    ),
    uniqueIndex('family_members_active_unique')
      .on(table.familyId, table.userId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('family_members_active_owner_unique')
      .on(table.familyId)
      .where(sql`${table.status} = 'active' AND ${table.role} = 'owner'`),
    index('family_members_user_active_idx').on(table.userId, table.status, table.familyId),
    index('family_members_family_active_idx').on(table.familyId, table.status, table.joinedAt),
  ],
);

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').references(() => families.id, { onDelete: 'restrict' }),
    consentType: varchar('consent_type', { length: 32 }).notNull(),
    granted: boolean('granted').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    version: varchar('version', { length: 32 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('consents_user_type_created_idx').on(table.userId, table.consentType, table.createdAt),
    index('consents_location_scope_created_idx')
      .on(table.userId, table.familyId, table.createdAt.desc())
      .where(sql`${table.consentType} = 'location_sharing'`),
    uniqueIndex('consents_location_active_unique')
      .on(table.userId, table.familyId)
      .where(
        sql`${table.consentType} = 'location_sharing' AND ${table.granted} = true AND ${table.familyId} IS NOT NULL`,
      ),
    uniqueIndex('consents_id_user_family_unique').on(table.id, table.userId, table.familyId),
    check(
      'consents_location_grant_scope_check',
      sql`${table.consentType} <> 'location_sharing' OR NOT ${table.granted} OR (${table.familyId} IS NOT NULL AND ${table.revokedAt} IS NULL)`,
    ),
  ],
);

export const familyInvitations = pgTable(
  'family_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    inviterUserId: uuid('inviter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    inviteeEmail: varchar('invitee_email', { length: 254 }),
    inviteePhone: varchar('invitee_phone', { length: 16 }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      'family_invitations_exactly_one_contact_check',
      sql`(${table.inviteeEmail} IS NOT NULL AND ${table.inviteePhone} IS NULL) OR (${table.inviteeEmail} IS NULL AND ${table.inviteePhone} IS NOT NULL)`,
    ),
    check(
      'family_invitations_status_check',
      sql`${table.status} IN ('pending', 'accepted', 'declined', 'revoked', 'expired')`,
    ),
    check(
      'family_invitations_email_normalized_check',
      sql`${table.inviteeEmail} IS NULL OR (${table.inviteeEmail} = lower(btrim(${table.inviteeEmail})) AND ${table.inviteeEmail} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$')`,
    ),
    check(
      'family_invitations_phone_check',
      sql`${table.inviteePhone} IS NULL OR ${table.inviteePhone} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
    check('family_invitations_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'family_invitations_lifecycle_check',
      sql`(${table.status} = 'accepted' AND ${table.acceptedAt} IS NOT NULL) OR (${table.status} <> 'accepted' AND ${table.acceptedAt} IS NULL)`,
    ),
    check(
      'family_invitations_declined_lifecycle_check',
      sql`(${table.status} = 'declined' AND ${table.declinedAt} IS NOT NULL) OR (${table.status} <> 'declined' AND ${table.declinedAt} IS NULL)`,
    ),
    check(
      'family_invitations_revoked_lifecycle_check',
      sql`(${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL) OR (${table.status} <> 'revoked' AND ${table.revokedAt} IS NULL)`,
    ),
    uniqueIndex('family_invitations_token_hash_unique').on(table.tokenHash),
    uniqueIndex('family_invitations_pending_email_unique')
      .on(table.familyId, table.inviteeEmail)
      .where(sql`${table.status} = 'pending' AND ${table.inviteeEmail} IS NOT NULL`),
    uniqueIndex('family_invitations_pending_phone_unique')
      .on(table.familyId, table.inviteePhone)
      .where(sql`${table.status} = 'pending' AND ${table.inviteePhone} IS NOT NULL`),
    index('family_invitations_lookup_email_idx').on(
      table.inviteeEmail,
      table.status,
      table.expiresAt,
    ),
    index('family_invitations_lookup_phone_idx').on(
      table.inviteePhone,
      table.status,
      table.expiresAt,
    ),
    index('family_invitations_family_status_idx').on(table.familyId, table.status, table.expiresAt),
  ],
);

export const locationSharingSessions = pgTable(
  'location_sharing_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    consentId: uuid('consent_id').notNull(),
    sessionVersion: uuid('session_version').notNull().defaultRandom(),
    status: varchar('status', { length: 16 }).notNull().default('sharing'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    lastUpdateAt: timestamp('last_update_at', { withTimezone: true }),
    lastClientRecordedAt: timestamp('last_client_recorded_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 minutes'`),
    lastSequence: bigint('last_sequence', { mode: 'number' }).notNull().default(0),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'location_sessions_consent_scope_fk',
      columns: [table.consentId, table.userId, table.familyId],
      foreignColumns: [consents.id, consents.userId, consents.familyId],
    }).onDelete('cascade'),
    uniqueIndex('location_sessions_id_scope_unique').on(table.id, table.userId, table.familyId),
    check(
      'location_sessions_status_check',
      sql`${table.status} IN ('sharing', 'paused', 'stopped', 'expired')`,
    ),
    check('location_sessions_sequence_check', sql`${table.lastSequence} >= 0`),
    check(
      'location_sessions_lifecycle_check',
      sql`(${table.status} = 'sharing' AND ${table.pausedAt} IS NULL AND ${table.stoppedAt} IS NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'paused' AND ${table.pausedAt} IS NOT NULL AND ${table.stoppedAt} IS NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'stopped' AND ${table.stoppedAt} IS NOT NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'expired' AND ${table.expiredAt} IS NOT NULL AND ${table.stoppedAt} IS NULL)`,
    ),
    check('location_sessions_expiry_check', sql`${table.expiresAt} > ${table.startedAt}`),
    uniqueIndex('location_sessions_active_user_family_unique')
      .on(table.userId, table.familyId)
      .where(sql`${table.status} IN ('sharing', 'paused')`),
    index('location_sessions_family_status_expiry_idx').on(
      table.familyId,
      table.status,
      table.expiresAt,
    ),
    index('location_sessions_user_status_idx').on(table.userId, table.status, table.familyId),
  ],
);

export const locationPositions = pgTable(
  'location_positions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    latitude: numeric('latitude', { precision: 6, scale: 4 }).notNull(),
    longitude: numeric('longitude', { precision: 7, scale: 4 }).notNull(),
    accuracyMeters: numeric('accuracy_meters', { precision: 7, scale: 2 }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'location_positions_user_family_pk',
      columns: [table.userId, table.familyId],
    }),
    uniqueIndex('location_positions_session_unique').on(table.sessionId),
    foreignKey({
      name: 'location_positions_session_scope_fk',
      columns: [table.sessionId, table.userId, table.familyId],
      foreignColumns: [
        locationSharingSessions.id,
        locationSharingSessions.userId,
        locationSharingSessions.familyId,
      ],
    }).onDelete('cascade'),
    check('location_positions_latitude_check', sql`${table.latitude} BETWEEN -90 AND 90`),
    check('location_positions_longitude_check', sql`${table.longitude} BETWEEN -180 AND 180`),
    check('location_positions_accuracy_check', sql`${table.accuracyMeters} BETWEEN 0 AND 1000`),
    check('location_positions_expiry_check', sql`${table.expiresAt} > ${table.recordedAt}`),
    index('location_positions_family_expiry_idx').on(
      table.familyId,
      table.expiresAt,
      table.recordedAt,
    ),
  ],
);

export const schema = {
  users,
  refreshTokens,
  otpVerifications,
  consents,
  families,
  familyMembers,
  familyInvitations,
  locationSharingSessions,
  locationPositions,
};
