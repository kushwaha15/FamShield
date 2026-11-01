import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDatabase } from '../config/database.js';
import {
  consents,
  families,
  familyMembers,
  locationPositions,
  locationSharingSessions,
} from '../db/schema.js';
import { ApiError } from '../utils/ApiError.js';
import { publishLocationInvalidated } from '../sockets/locationNotifications.js';

export const LOCATION_SHARING_POLICY_VERSION = 'location-sharing-v1';

function familyNotFound(): ApiError {
  return new ApiError(404, 'FAMILY_NOT_FOUND', 'The requested family was not found.');
}

export async function hasActiveLocationSharingConsent(
  userId: string,
  familyId: string,
): Promise<boolean> {
  const [activeConsent] = await getDatabase()
    .select({ id: consents.id })
    .from(consents)
    .innerJoin(
      familyMembers,
      and(
        eq(familyMembers.familyId, consents.familyId),
        eq(familyMembers.userId, consents.userId),
        eq(familyMembers.status, 'active'),
      ),
    )
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
    .limit(1);
  return activeConsent !== undefined;
}

export async function getLocationSharingConsent(userId: string) {
  const memberships = await getDatabase()
    .select({
      familyId: families.id,
      familyName: families.name,
    })
    .from(familyMembers)
    .innerJoin(families, eq(families.id, familyMembers.familyId))
    .where(and(eq(familyMembers.userId, userId), eq(familyMembers.status, 'active')))
    .orderBy(families.createdAt);
  const grants = await getDatabase()
    .select({
      familyId: consents.familyId,
      grantedAt: consents.grantedAt,
      version: consents.version,
    })
    .from(consents)
    .where(
      and(
        eq(consents.userId, userId),
        eq(consents.consentType, 'location_sharing'),
        eq(consents.granted, true),
      ),
    );
  const activeGrants = new Map(
    grants.flatMap((grant) =>
      grant.familyId
        ? [[grant.familyId, { grantedAt: grant.grantedAt, version: grant.version }] as const]
        : [],
    ),
  );

  return {
    policyVersion: LOCATION_SHARING_POLICY_VERSION,
    scopes: memberships.map((membership) => {
      const grant = activeGrants.get(membership.familyId);
      const needsReview = grant !== undefined && grant.version !== LOCATION_SHARING_POLICY_VERSION;
      return {
        ...membership,
        enabled: grant !== undefined && !needsReview,
        ...(needsReview ? { needsReview: true } : {}),
        ...(grant?.grantedAt ? { grantedAt: grant.grantedAt.toISOString() } : {}),
        ...(grant ? { grantedPolicyVersion: grant.version } : {}),
      };
    }),
  };
}

export async function getLocationSharingConsentHistory(userId: string) {
  const history = await getDatabase()
    .select({
      id: consents.id,
      familyId: consents.familyId,
      granted: consents.granted,
      grantedAt: consents.grantedAt,
      revokedAt: consents.revokedAt,
      policyVersion: consents.version,
      recordedAt: consents.createdAt,
    })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.consentType, 'location_sharing')))
    .orderBy(desc(consents.createdAt));

  return history.map(({ granted, ...entry }) => ({
    ...entry,
    status: granted
      ? entry.policyVersion === LOCATION_SHARING_POLICY_VERSION
        ? 'granted'
        : 'inactive'
      : entry.revokedAt
        ? 'revoked'
        : 'inactive',
    grantedAt: entry.grantedAt?.toISOString() ?? null,
    revokedAt: entry.revokedAt?.toISOString() ?? null,
    recordedAt: entry.recordedAt.toISOString(),
  }));
}

export async function grantLocationSharingConsent(
  userId: string,
  familyId: string,
  policyVersion: string,
  confirmed: true,
) {
  if (policyVersion !== LOCATION_SHARING_POLICY_VERSION || confirmed !== true) {
    throw new ApiError(
      409,
      'CONSENT_POLICY_CHANGED',
      'Review the current consent information before enabling sharing.',
    );
  }

  let sharingInvalidated = false;
  const result = await getDatabase().transaction(async (tx) => {
    const [family] = await tx
      .select({ id: families.id, name: families.name })
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

    const [existing] = await tx
      .select({
        id: consents.id,
        grantedAt: consents.grantedAt,
        version: consents.version,
      })
      .from(consents)
      .where(
        and(
          eq(consents.userId, userId),
          eq(consents.familyId, familyId),
          eq(consents.consentType, 'location_sharing'),
          eq(consents.granted, true),
        ),
      )
      .for('update')
      .limit(1);
    if (existing?.version === LOCATION_SHARING_POLICY_VERSION && existing.grantedAt) {
      return {
        familyId,
        familyName: family.name,
        enabled: true,
        grantedAt: existing.grantedAt.toISOString(),
        policyVersion: existing.version,
      };
    }

    const now = new Date();
    if (existing) {
      await tx
        .update(consents)
        .set({ granted: false, revokedAt: now })
        .where(eq(consents.id, existing.id));
      await tx
        .update(locationSharingSessions)
        .set({ status: 'stopped', stoppedAt: now })
        .where(
          and(
            eq(locationSharingSessions.userId, userId),
            eq(locationSharingSessions.familyId, familyId),
            inArray(locationSharingSessions.status, ['sharing', 'paused']),
          ),
        );
      await tx
        .delete(locationPositions)
        .where(and(eq(locationPositions.userId, userId), eq(locationPositions.familyId, familyId)));
      sharingInvalidated = true;
    }
    const [created] = await tx
      .insert(consents)
      .values({
        userId,
        familyId,
        consentType: 'location_sharing',
        granted: true,
        grantedAt: now,
        version: LOCATION_SHARING_POLICY_VERSION,
      })
      .returning({ grantedAt: consents.grantedAt });
    if (!created?.grantedAt) {
      throw new Error('PostgreSQL did not return the created location consent.');
    }
    return {
      familyId,
      familyName: family.name,
      enabled: true,
      grantedAt: created.grantedAt.toISOString(),
      policyVersion: LOCATION_SHARING_POLICY_VERSION,
    };
  });
  if (sharingInvalidated) publishLocationInvalidated(familyId);
  return result;
}

export async function revokeLocationSharingConsent(userId: string, familyId: string) {
  const result = await getDatabase().transaction(async (tx) => {
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
    const [existing] = await tx
      .select({ id: consents.id })
      .from(consents)
      .where(
        and(
          eq(consents.userId, userId),
          eq(consents.familyId, familyId),
          eq(consents.consentType, 'location_sharing'),
          eq(consents.granted, true),
          isNull(consents.revokedAt),
        ),
      )
      .for('update')
      .limit(1);

    if (!membership && !existing) throw familyNotFound();
    const revokedAt = new Date();
    if (existing) {
      await tx
        .update(consents)
        .set({ granted: false, revokedAt })
        .where(eq(consents.id, existing.id));
    }
    await tx
      .update(locationSharingSessions)
      .set({ status: 'stopped', stoppedAt: revokedAt })
      .where(
        and(
          eq(locationSharingSessions.userId, userId),
          eq(locationSharingSessions.familyId, familyId),
          inArray(locationSharingSessions.status, ['sharing', 'paused']),
        ),
      );
    await tx
      .delete(locationPositions)
      .where(and(eq(locationPositions.userId, userId), eq(locationPositions.familyId, familyId)));
    return { familyId, enabled: false, revokedAt: revokedAt.toISOString() };
  });
  publishLocationInvalidated(familyId);
  return result;
}
