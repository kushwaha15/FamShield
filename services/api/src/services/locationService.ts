import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { getDatabase } from '../config/database.js';
import {
  consents,
  families,
  familyMembers,
  locationPositions,
  locationSharingSessions,
  users,
} from '../db/schema.js';
import { ApiError } from '../utils/ApiError.js';
import { LOCATION_SHARING_POLICY_VERSION } from './consentService.js';
import {
  publishLocationChanged,
  publishLocationInvalidated,
} from '../sockets/locationNotifications.js';

const SESSION_TTL_MILLISECONDS = 30 * 60 * 1000;
const POSITION_TTL_MILLISECONDS = 10 * 60 * 1000;
const STALE_AFTER_MILLISECONDS = 2 * 60 * 1000;
const CLIENT_TIMESTAMP_PAST_TOLERANCE_MILLISECONDS = 5 * 60 * 1000;
const CLIENT_TIMESTAMP_FUTURE_TOLERANCE_MILLISECONDS = 30 * 1000;

function familyNotFound(): ApiError {
  return new ApiError(404, 'FAMILY_NOT_FOUND', 'The requested family was not found.');
}

function sessionNotFound(): ApiError {
  return new ApiError(404, 'LOCATION_SESSION_NOT_FOUND', 'The location session was not found.');
}

function conflict(message: string): ApiError {
  return new ApiError(409, 'LOCATION_SESSION_CONFLICT', message);
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current = error;
  while (typeof current === 'object' && current !== null) {
    if (
      'code' in current &&
      current.code === '23505' &&
      'constraint' in current &&
      current.constraint === constraint
    ) {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

async function lockFamilyAndMembership(
  tx: Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0],
  userId: string,
  familyId: string,
) {
  const [family] = await tx
    .select({ id: families.id })
    .from(families)
    .where(eq(families.id, familyId))
    .for('update')
    .limit(1);
  if (!family) throw familyNotFound();

  const [membership] = await tx
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(
      and(
        eq(familyMembers.familyId, familyId),
        eq(familyMembers.userId, userId),
        eq(familyMembers.status, 'active'),
      ),
    )
    .for('update')
    .limit(1);
  if (!membership) throw familyNotFound();
}

async function hasCurrentConsent(
  tx: Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0],
  consentId: string,
  userId: string,
  familyId: string,
) {
  const [consent] = await tx
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.id, consentId),
        eq(consents.userId, userId),
        eq(consents.familyId, familyId),
        eq(consents.consentType, 'location_sharing'),
        eq(consents.granted, true),
        eq(consents.version, LOCATION_SHARING_POLICY_VERSION),
        isNull(consents.revokedAt),
      ),
    )
    .for('update')
    .limit(1);
  return consent !== undefined;
}

export async function startLocationSharing(userId: string, familyId: string) {
  try {
    return await getDatabase().transaction(async (tx) => {
      await lockFamilyAndMembership(tx, userId, familyId);
      const [consent] = await tx
        .select({ id: consents.id })
        .from(consents)
        .where(
          and(
            eq(consents.userId, userId),
            eq(consents.familyId, familyId),
            eq(consents.consentType, 'location_sharing'),
            eq(consents.granted, true),
            eq(consents.version, LOCATION_SHARING_POLICY_VERSION),
            isNull(consents.revokedAt),
          ),
        )
        .for('update')
        .limit(1);
      if (!consent) {
        throw new ApiError(
          403,
          'LOCATION_CONSENT_REQUIRED',
          'Enable current location-sharing consent before starting a session.',
        );
      }

      const [existingSession] = await tx
        .select({ id: locationSharingSessions.id })
        .from(locationSharingSessions)
        .where(
          and(
            eq(locationSharingSessions.userId, userId),
            eq(locationSharingSessions.familyId, familyId),
            inArray(locationSharingSessions.status, ['sharing', 'paused']),
          ),
        )
        .for('update')
        .limit(1);
      if (existingSession) {
        throw conflict('An active or paused location-sharing session already exists.');
      }

      const now = new Date();
      const [session] = await tx
        .insert(locationSharingSessions)
        .values({
          userId,
          familyId,
          consentId: consent.id,
          startedAt: now,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MILLISECONDS),
        })
        .returning({
          id: locationSharingSessions.id,
          sessionVersion: locationSharingSessions.sessionVersion,
          status: locationSharingSessions.status,
          startedAt: locationSharingSessions.startedAt,
          expiresAt: locationSharingSessions.expiresAt,
        });
      if (!session) throw new Error('PostgreSQL did not return the created location session.');
      return {
        ...session,
        startedAt: session.startedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'location_sessions_active_user_family_unique')) {
      throw conflict('An active or paused location-sharing session already exists.');
    }
    throw error;
  }
}

type SessionAction = 'pause' | 'resume' | 'stop';

export async function changeLocationSharingSession(
  userId: string,
  familyId: string,
  sessionId: string,
  action: SessionAction,
) {
  const result = await getDatabase().transaction(async (tx) => {
    await lockFamilyAndMembership(tx, userId, familyId);
    const [session] = await tx
      .select()
      .from(locationSharingSessions)
      .where(
        and(
          eq(locationSharingSessions.id, sessionId),
          eq(locationSharingSessions.userId, userId),
          eq(locationSharingSessions.familyId, familyId),
        ),
      )
      .for('update')
      .limit(1);
    if (!session) throw sessionNotFound();

    const now = new Date();
    if (session.status === 'expired') {
      await tx.delete(locationPositions).where(eq(locationPositions.sessionId, session.id));
      return {
        error: conflict('The location-sharing session has expired.'),
        invalidated: true,
      } as const;
    }
    if ((session.status === 'sharing' || session.status === 'paused') && session.expiresAt <= now) {
      await tx
        .update(locationSharingSessions)
        .set({ status: 'expired', expiredAt: now })
        .where(eq(locationSharingSessions.id, session.id));
      await tx.delete(locationPositions).where(eq(locationPositions.sessionId, session.id));
      return {
        error: conflict('The location-sharing session has expired.'),
        invalidated: true,
      } as const;
    }

    if (action === 'pause') {
      if (session.status !== 'sharing') throw conflict('Only a sharing session can be paused.');
      await tx
        .update(locationSharingSessions)
        .set({ status: 'paused', pausedAt: now })
        .where(eq(locationSharingSessions.id, session.id));
      await tx.delete(locationPositions).where(eq(locationPositions.sessionId, session.id));
    } else if (action === 'resume') {
      if (session.status !== 'paused') throw conflict('Only a paused session can be resumed.');
      if (!(await hasCurrentConsent(tx, session.consentId, userId, familyId))) {
        await tx
          .update(locationSharingSessions)
          .set({ status: 'stopped', stoppedAt: now })
          .where(eq(locationSharingSessions.id, session.id));
        await tx.delete(locationPositions).where(eq(locationPositions.sessionId, session.id));
        return {
          error: new ApiError(
            403,
            'LOCATION_CONSENT_REQUIRED',
            'Current location-sharing consent is required to resume.',
          ),
          invalidated: true,
        } as const;
      }
      await tx
        .update(locationSharingSessions)
        .set({
          status: 'sharing',
          pausedAt: null,
          resumedAt: now,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MILLISECONDS),
        })
        .where(eq(locationSharingSessions.id, session.id));
    } else {
      if (session.status !== 'sharing' && session.status !== 'paused') {
        throw conflict('Only an active session can be stopped.');
      }
      await tx
        .update(locationSharingSessions)
        .set({ status: 'stopped', stoppedAt: now })
        .where(eq(locationSharingSessions.id, session.id));
      await tx.delete(locationPositions).where(eq(locationPositions.sessionId, session.id));
    }
    return {
      data: {
        sessionId,
        status: action === 'stop' ? 'stopped' : action === 'pause' ? 'paused' : 'sharing',
      },
    } as const;
  });
  if ('error' in result) {
    if ('invalidated' in result) publishLocationInvalidated(familyId);
    throw result.error;
  }
  publishLocationInvalidated(familyId);
  return result.data;
}

export interface LocationPositionInput {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  sequence: number;
  clientRecordedAt: string;
}

export async function updateLocationPosition(
  userId: string,
  familyId: string,
  sessionId: string,
  input: LocationPositionInput,
) {
  const result = await getDatabase().transaction(async (tx) => {
    await lockFamilyAndMembership(tx, userId, familyId);
    const [session] = await tx
      .select()
      .from(locationSharingSessions)
      .where(
        and(
          eq(locationSharingSessions.id, sessionId),
          eq(locationSharingSessions.userId, userId),
          eq(locationSharingSessions.familyId, familyId),
        ),
      )
      .for('update')
      .limit(1);
    if (!session) throw sessionNotFound();

    const receivedAt = new Date();
    if (
      (session.status === 'sharing' || session.status === 'paused') &&
      session.expiresAt <= receivedAt
    ) {
      await tx
        .update(locationSharingSessions)
        .set({ status: 'expired', expiredAt: receivedAt })
        .where(eq(locationSharingSessions.id, session.id));
      await tx.delete(locationPositions).where(eq(locationPositions.sessionId, session.id));
      return {
        error: new ApiError(
          409,
          'LOCATION_SESSION_EXPIRED',
          'The location-sharing session has expired.',
        ),
        invalidated: true,
      } as const;
    }
    if (session.status === 'paused') {
      throw conflict('A paused session cannot submit location updates.');
    }
    if (session.status !== 'sharing') {
      throw new ApiError(
        403,
        'LOCATION_SHARING_NOT_AUTHORIZED',
        'The location-sharing session is no longer authorized.',
      );
    }
    if (!(await hasCurrentConsent(tx, session.consentId, userId, familyId))) {
      await tx
        .update(locationSharingSessions)
        .set({ status: 'stopped', stoppedAt: receivedAt })
        .where(eq(locationSharingSessions.id, session.id));
      await tx.delete(locationPositions).where(eq(locationPositions.sessionId, session.id));
      return {
        error: new ApiError(
          403,
          'LOCATION_SHARING_NOT_AUTHORIZED',
          'The location-sharing session is no longer authorized.',
        ),
        invalidated: true,
      } as const;
    }
    if (input.sequence <= session.lastSequence) {
      throw new ApiError(
        409,
        'LOCATION_UPDATE_REPLAYED',
        'The location update is outdated and was not accepted.',
      );
    }

    const clientTimestamp = new Date(input.clientRecordedAt).getTime();
    if (
      clientTimestamp > receivedAt.getTime() + CLIENT_TIMESTAMP_FUTURE_TOLERANCE_MILLISECONDS ||
      clientTimestamp < receivedAt.getTime() - CLIENT_TIMESTAMP_PAST_TOLERANCE_MILLISECONDS
    ) {
      throw new ApiError(
        400,
        'LOCATION_UPDATE_TIMESTAMP_INVALID',
        'The location update timestamp is outside the accepted time window.',
      );
    }
    if (session.lastClientRecordedAt && clientTimestamp <= session.lastClientRecordedAt.getTime()) {
      throw new ApiError(
        409,
        'LOCATION_UPDATE_OUT_OF_ORDER',
        'The location update is out of order and was not accepted.',
      );
    }

    const latitude = Math.round(input.latitude * 10_000) / 10_000;
    const longitude = Math.round(input.longitude * 10_000) / 10_000;
    const expiresAt = new Date(receivedAt.getTime() + POSITION_TTL_MILLISECONDS);
    await tx
      .insert(locationPositions)
      .values({
        userId,
        familyId,
        sessionId,
        latitude: latitude.toFixed(4),
        longitude: longitude.toFixed(4),
        accuracyMeters: input.accuracyMeters.toFixed(2),
        recordedAt: receivedAt,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [locationPositions.userId, locationPositions.familyId],
        set: {
          sessionId,
          latitude: latitude.toFixed(4),
          longitude: longitude.toFixed(4),
          accuracyMeters: input.accuracyMeters.toFixed(2),
          recordedAt: receivedAt,
          expiresAt,
        },
      });
    const sessionExpiresAt = new Date(receivedAt.getTime() + SESSION_TTL_MILLISECONDS);
    await tx
      .update(locationSharingSessions)
      .set({
        lastSequence: input.sequence,
        lastUpdateAt: receivedAt,
        lastClientRecordedAt: new Date(clientTimestamp),
        expiresAt: sessionExpiresAt,
      })
      .where(eq(locationSharingSessions.id, session.id));

    return {
      data: {
        sessionId,
        recordedAt: receivedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        sessionExpiresAt: sessionExpiresAt.toISOString(),
        precisionDecimalPlaces: 4,
      },
    } as const;
  });
  if ('error' in result) {
    if ('invalidated' in result) publishLocationInvalidated(familyId);
    throw result.error;
  }
  publishLocationChanged(familyId, userId);
  return result.data;
}

export async function getCurrentFamilyLocations(viewerId: string, familyId: string) {
  return getDatabase().transaction(async (tx) => {
    const [family] = await tx
      .select({ id: families.id })
      .from(families)
      .where(eq(families.id, familyId))
      .for('share')
      .limit(1);
    if (!family) throw familyNotFound();

    const [viewerMembership] = await tx
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, viewerId),
          eq(familyMembers.status, 'active'),
        ),
      )
      .for('share')
      .limit(1);
    if (!viewerMembership) throw familyNotFound();

    const now = new Date();
    const rows = await tx
      .select({
        userId: users.id,
        fullName: users.fullName,
        latitude: locationPositions.latitude,
        longitude: locationPositions.longitude,
        accuracyMeters: locationPositions.accuracyMeters,
        recordedAt: locationPositions.recordedAt,
      })
      .from(locationPositions)
      .innerJoin(
        locationSharingSessions,
        and(
          eq(locationSharingSessions.id, locationPositions.sessionId),
          eq(locationSharingSessions.userId, locationPositions.userId),
          eq(locationSharingSessions.familyId, locationPositions.familyId),
        ),
      )
      .innerJoin(
        familyMembers,
        and(
          eq(familyMembers.userId, locationPositions.userId),
          eq(familyMembers.familyId, locationPositions.familyId),
          eq(familyMembers.status, 'active'),
        ),
      )
      .innerJoin(
        consents,
        and(
          eq(consents.id, locationSharingSessions.consentId),
          eq(consents.userId, locationPositions.userId),
          eq(consents.familyId, locationPositions.familyId),
          eq(consents.consentType, 'location_sharing'),
          eq(consents.granted, true),
          eq(consents.version, LOCATION_SHARING_POLICY_VERSION),
          isNull(consents.revokedAt),
        ),
      )
      .innerJoin(users, eq(users.id, locationPositions.userId))
      .where(
        and(
          eq(locationPositions.familyId, familyId),
          eq(locationSharingSessions.status, 'sharing'),
          gt(locationSharingSessions.expiresAt, now),
          gt(locationPositions.expiresAt, now),
        ),
      );
    return rows.map((row) => ({
      userId: row.userId,
      fullName: row.fullName,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracyMeters: Number(row.accuracyMeters),
      recordedAt: row.recordedAt.toISOString(),
      status:
        row.recordedAt.getTime() <= now.getTime() - STALE_AFTER_MILLISECONDS ? 'stale' : 'fresh',
    }));
  });
}

export async function cleanupExpiredLocationSharing(): Promise<void> {
  const now = new Date();
  const invalidatedFamilyIds = await getDatabase().transaction(async (tx) => {
    const invalidatedPositions = await tx.execute(sql`
      SELECT DISTINCT family_id FROM location_positions
      WHERE expires_at <= ${now}
    `);
    const affectedSessions = await tx.execute(sql`
      SELECT DISTINCT family_id FROM location_sharing_sessions AS session
      WHERE session.status IN ('sharing', 'paused')
        AND (
          session.expires_at <= ${now}
          OR NOT EXISTS (
            SELECT 1 FROM consents
            WHERE consents.id = session.consent_id
              AND consents.user_id = session.user_id
              AND consents.family_id = session.family_id
              AND consents.consent_type = 'location_sharing'
              AND consents.granted = true
              AND consents.version = ${LOCATION_SHARING_POLICY_VERSION}
              AND consents.revoked_at IS NULL
          )
          OR NOT EXISTS (
            SELECT 1 FROM family_members
            WHERE family_members.user_id = session.user_id
              AND family_members.family_id = session.family_id
              AND family_members.status = 'active'
          )
        )
    `);
    const familyIds = new Set<string>();
    for (const row of [...invalidatedPositions.rows, ...affectedSessions.rows]) {
      if (typeof row.family_id === 'string') familyIds.add(row.family_id);
    }

    await tx.execute(sql`
      UPDATE location_sharing_sessions AS session
      SET status = 'expired', expired_at = ${now}, updated_at = ${now}
      WHERE session.status IN ('sharing', 'paused')
        AND (
          session.expires_at <= ${now}
          OR NOT EXISTS (
            SELECT 1 FROM consents
            WHERE consents.id = session.consent_id
              AND consents.user_id = session.user_id
              AND consents.family_id = session.family_id
              AND consents.consent_type = 'location_sharing'
              AND consents.granted = true
              AND consents.version = ${LOCATION_SHARING_POLICY_VERSION}
              AND consents.revoked_at IS NULL
          )
          OR NOT EXISTS (
            SELECT 1 FROM family_members
            WHERE family_members.user_id = session.user_id
              AND family_members.family_id = session.family_id
              AND family_members.status = 'active'
          )
        )
    `);
    await tx.execute(sql`
      DELETE FROM location_positions
      WHERE expires_at <= ${now}
        OR NOT EXISTS (
          SELECT 1 FROM location_sharing_sessions AS session
          JOIN consents ON consents.id = session.consent_id
            AND consents.user_id = session.user_id
            AND consents.family_id = session.family_id
          JOIN family_members ON family_members.user_id = session.user_id
            AND family_members.family_id = session.family_id
            AND family_members.status = 'active'
          WHERE session.id = location_positions.session_id
            AND session.status = 'sharing'
            AND session.expires_at > ${now}
            AND consents.consent_type = 'location_sharing'
            AND consents.granted = true
            AND consents.version = ${LOCATION_SHARING_POLICY_VERSION}
            AND consents.revoked_at IS NULL
        )
    `);
    return [...familyIds];
  });
  for (const familyId of invalidatedFamilyIds) publishLocationInvalidated(familyId);
}
