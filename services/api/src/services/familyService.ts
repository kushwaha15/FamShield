import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, lt, or, sql } from 'drizzle-orm';
import { getDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import {
  consents,
  families,
  familyInvitations,
  familyMembers,
  locationPositions,
  locationSharingSessions,
  users,
} from '../db/schema.js';
import { ApiError } from '../utils/ApiError.js';
import {
  publishFamilyMembershipRemoved,
  publishLocationInvalidated,
} from '../sockets/locationNotifications.js';

const invitationLifetimeMs = env.FAMILY_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

type FamilyRow = typeof families.$inferSelect;
type MemberRow = typeof familyMembers.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  while (typeof current === 'object' && current !== null) {
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toFamily(family: FamilyRow, role?: string) {
  return {
    id: family.id,
    name: family.name,
    createdBy: family.createdBy,
    createdAt: family.createdAt.toISOString(),
    updatedAt: family.updatedAt.toISOString(),
    ...(role ? { role } : {}),
  };
}

function familyNotFound(): ApiError {
  return new ApiError(404, 'FAMILY_NOT_FOUND', 'The requested family was not found.');
}

function invitationNotFound(): ApiError {
  return new ApiError(404, 'INVITATION_NOT_FOUND', 'The invitation is invalid or unavailable.');
}

async function findActiveMembership(
  userId: string,
  familyId: string,
): Promise<MemberRow | undefined> {
  const [membership] = await getDatabase()
    .select()
    .from(familyMembers)
    .where(
      and(
        eq(familyMembers.userId, userId),
        eq(familyMembers.familyId, familyId),
        eq(familyMembers.status, 'active'),
      ),
    )
    .limit(1);
  return membership;
}

async function requireFamilyMember(userId: string, familyId: string): Promise<MemberRow> {
  const membership = await findActiveMembership(userId, familyId);
  if (!membership) throw familyNotFound();
  return membership;
}

async function requireFamilyOwner(userId: string, familyId: string): Promise<MemberRow> {
  const membership = await requireFamilyMember(userId, familyId);
  if (membership.role !== 'owner') throw familyNotFound();
  return membership;
}

export async function createFamily(userId: string, name: string) {
  const result = await getDatabase().transaction(async (tx) => {
    const [family] = await tx.insert(families).values({ name, createdBy: userId }).returning();
    if (!family) throw new Error('PostgreSQL did not return the created family.');
    await tx.insert(familyMembers).values({
      familyId: family.id,
      userId,
      role: 'owner',
    });
    return family;
  });
  return toFamily(result, 'owner');
}

export async function listFamilies(userId: string) {
  const results = await getDatabase()
    .select({ family: families, role: familyMembers.role })
    .from(familyMembers)
    .innerJoin(families, eq(families.id, familyMembers.familyId))
    .where(and(eq(familyMembers.userId, userId), eq(familyMembers.status, 'active')))
    .orderBy(desc(families.createdAt));
  return results.map(({ family, role }) => toFamily(family, role));
}

export async function getFamily(userId: string, familyId: string) {
  const membership = await requireFamilyMember(userId, familyId);
  const [family] = await getDatabase()
    .select()
    .from(families)
    .where(eq(families.id, familyId))
    .limit(1);
  if (!family) throw familyNotFound();
  return toFamily(family, membership.role);
}

export async function getFamilyMembers(userId: string, familyId: string) {
  await requireFamilyMember(userId, familyId);
  return getDatabase()
    .select({
      familyId: familyMembers.familyId,
      userId: users.id,
      fullName: users.fullName,
      profileImageUrl: users.profileImageUrl,
      role: familyMembers.role,
      status: familyMembers.status,
      joinedAt: familyMembers.joinedAt,
    })
    .from(familyMembers)
    .innerJoin(users, eq(users.id, familyMembers.userId))
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.status, 'active')))
    .orderBy(familyMembers.joinedAt)
    .then((members) =>
      members.map(({ profileImageUrl, joinedAt, ...member }) => ({
        ...member,
        ...(profileImageUrl ? { profileImageUrl } : {}),
        joinedAt: joinedAt.toISOString(),
      })),
    );
}

export async function createInvitation(
  userId: string,
  familyId: string,
  contact: { email: string } | { phone: string },
) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + invitationLifetimeMs);
  const inviteeEmail = 'email' in contact ? contact.email : undefined;
  const inviteePhone = 'phone' in contact ? contact.phone : undefined;
  try {
    const invitation = await getDatabase().transaction(async (tx) => {
      const [family] = await tx
        .select({ id: families.id })
        .from(families)
        .where(eq(families.id, familyId))
        .for('update')
        .limit(1);
      if (!family) throw familyNotFound();
      const [owner] = await tx
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.familyId, familyId),
            eq(familyMembers.userId, userId),
            eq(familyMembers.role, 'owner'),
            eq(familyMembers.status, 'active'),
          ),
        )
        .limit(1);
      if (!owner) throw familyNotFound();
      const now = new Date();
      const expiredPending = and(
        eq(familyInvitations.familyId, familyId),
        eq(familyInvitations.status, 'pending'),
        lt(familyInvitations.expiresAt, now),
      );
      if (inviteeEmail !== undefined) {
        await tx
          .update(familyInvitations)
          .set({ status: 'expired' })
          .where(and(expiredPending, eq(familyInvitations.inviteeEmail, inviteeEmail)));
      } else if (inviteePhone !== undefined) {
        await tx
          .update(familyInvitations)
          .set({ status: 'expired' })
          .where(and(expiredPending, eq(familyInvitations.inviteePhone, inviteePhone)));
      }
      const [created] = await tx
        .insert(familyInvitations)
        .values({
          familyId,
          inviterUserId: userId,
          inviteeEmail,
          inviteePhone,
          tokenHash: hashInvitationToken(token),
          expiresAt,
        })
        .returning({
          id: familyInvitations.id,
          familyId: familyInvitations.familyId,
          inviteeEmail: familyInvitations.inviteeEmail,
          inviteePhone: familyInvitations.inviteePhone,
          expiresAt: familyInvitations.expiresAt,
        });
      if (!created) throw new Error('PostgreSQL did not return the created invitation.');
      return created;
    });
    return {
      invitation: {
        id: invitation.id,
        familyId: invitation.familyId,
        ...(invitation.inviteeEmail ? { inviteeEmail: invitation.inviteeEmail } : {}),
        ...(invitation.inviteePhone ? { inviteePhone: invitation.inviteePhone } : {}),
        expiresAt: invitation.expiresAt.toISOString(),
      },
      token,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(
        409,
        'INVITATION_ALREADY_PENDING',
        'A pending invitation already exists for this contact.',
      );
    }
    throw error;
  }
}

export async function listFamilyInvitations(userId: string, familyId: string) {
  await requireFamilyOwner(userId, familyId);
  const now = new Date();
  await getDatabase()
    .update(familyInvitations)
    .set({ status: 'expired' })
    .where(
      and(
        eq(familyInvitations.familyId, familyId),
        eq(familyInvitations.status, 'pending'),
        lt(familyInvitations.expiresAt, now),
      ),
    );
  const invitations = await getDatabase()
    .select({
      id: familyInvitations.id,
      inviteeEmail: familyInvitations.inviteeEmail,
      inviteePhone: familyInvitations.inviteePhone,
      status: familyInvitations.status,
      expiresAt: familyInvitations.expiresAt,
      createdAt: familyInvitations.createdAt,
    })
    .from(familyInvitations)
    .where(
      and(
        eq(familyInvitations.familyId, familyId),
        eq(familyInvitations.status, 'pending'),
        gt(familyInvitations.expiresAt, now),
      ),
    )
    .orderBy(desc(familyInvitations.createdAt));
  return invitations.map((invitation) => ({
    id: invitation.id,
    ...(invitation.inviteeEmail ? { inviteeEmail: invitation.inviteeEmail } : {}),
    ...(invitation.inviteePhone ? { inviteePhone: invitation.inviteePhone } : {}),
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  }));
}

export async function listMyInvitations(userId: string) {
  const [user] = await getDatabase()
    .select({
      email: users.email,
      emailVerified: users.emailVerified,
      phone: users.phone,
      phoneVerified: users.phoneVerified,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'The account could not be found.');

  const matches = [];
  if (user.emailVerified) {
    matches.push(
      and(
        eq(familyInvitations.inviteeEmail, user.email.toLowerCase()),
        eq(familyInvitations.status, 'pending'),
      ),
    );
  }
  if (user.phoneVerified) {
    matches.push(
      and(eq(familyInvitations.inviteePhone, user.phone), eq(familyInvitations.status, 'pending')),
    );
  }
  if (!matches.length) return [];

  const now = new Date();
  const rows = await getDatabase()
    .select({
      id: familyInvitations.id,
      expiresAt: familyInvitations.expiresAt,
      familyId: families.id,
      familyName: families.name,
      inviterName: users.fullName,
    })
    .from(familyInvitations)
    .innerJoin(families, eq(families.id, familyInvitations.familyId))
    .innerJoin(users, eq(users.id, familyInvitations.inviterUserId))
    .where(and(or(...matches), gt(familyInvitations.expiresAt, now)));
  return rows.map((row) => ({
    id: row.id,
    family: { id: row.familyId, name: row.familyName },
    inviterName: row.inviterName,
    expiresAt: row.expiresAt.toISOString(),
  }));
}

type InvitationOutcome =
  { kind: 'accepted'; family: FamilyRow } | { kind: 'expired' } | { kind: 'invalid' };

export async function acceptInvitation(userId: string, token: string) {
  let uniqueConflict = false;
  let outcome: InvitationOutcome;
  try {
    outcome = await getDatabase().transaction(async (tx): Promise<InvitationOutcome> => {
      const [invitation] = await tx
        .select()
        .from(familyInvitations)
        .where(eq(familyInvitations.tokenHash, hashInvitationToken(token)))
        .for('update')
        .limit(1);
      if (!invitation || invitation.status !== 'pending') return { kind: 'invalid' };
      const now = new Date();
      if (invitation.expiresAt <= now) {
        await tx
          .update(familyInvitations)
          .set({ status: 'expired' })
          .where(eq(familyInvitations.id, invitation.id));
        return { kind: 'expired' };
      }

      const [invitee] = await tx
        .select({
          email: users.email,
          emailVerified: users.emailVerified,
          phone: users.phone,
          phoneVerified: users.phoneVerified,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!invitee || invitee.status !== 'active') return { kind: 'invalid' };
      const emailMatches =
        invitation.inviteeEmail !== null &&
        invitee.emailVerified &&
        invitation.inviteeEmail === invitee.email.toLowerCase();
      const phoneMatches =
        invitation.inviteePhone !== null &&
        invitee.phoneVerified &&
        invitation.inviteePhone === invitee.phone;
      if (!emailMatches && !phoneMatches) return { kind: 'invalid' };

      const [family] = await tx
        .select()
        .from(families)
        .where(eq(families.id, invitation.familyId))
        .for('update')
        .limit(1);
      if (!family) return { kind: 'invalid' };
      const [existingMembership] = await tx
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.familyId, invitation.familyId),
            eq(familyMembers.userId, userId),
            eq(familyMembers.status, 'active'),
          ),
        )
        .limit(1);
      if (existingMembership) return { kind: 'invalid' };

      await tx.insert(familyMembers).values({
        familyId: invitation.familyId,
        userId,
        role: 'member',
      });
      await tx
        .update(familyInvitations)
        .set({ status: 'accepted', acceptedAt: now })
        .where(eq(familyInvitations.id, invitation.id));
      return { kind: 'accepted', family };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    uniqueConflict = true;
    outcome = { kind: 'invalid' };
  }

  if (uniqueConflict) {
    throw new ApiError(409, 'ALREADY_A_MEMBER', 'You are already an active member of this family.');
  }
  if (outcome.kind === 'expired') {
    throw new ApiError(410, 'INVITATION_EXPIRED', 'The invitation has expired.');
  }
  if (outcome.kind !== 'accepted') throw invitationNotFound();
  return toFamily(outcome.family, 'member');
}

async function updateInvitationDecision(
  userId: string,
  token: string,
  decision: 'declined',
): Promise<'done' | 'expired' | 'invalid'> {
  return getDatabase().transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(familyInvitations)
      .where(eq(familyInvitations.tokenHash, hashInvitationToken(token)))
      .for('update')
      .limit(1);
    if (!invitation || invitation.status !== 'pending') return 'invalid';
    const now = new Date();
    if (invitation.expiresAt <= now) {
      await tx
        .update(familyInvitations)
        .set({ status: 'expired' })
        .where(eq(familyInvitations.id, invitation.id));
      return 'expired';
    }
    const [invitee] = await tx
      .select({
        email: users.email,
        emailVerified: users.emailVerified,
        phone: users.phone,
        phoneVerified: users.phoneVerified,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const emailMatches =
      invitation.inviteeEmail !== null &&
      invitee?.emailVerified === true &&
      invitation.inviteeEmail === invitee.email.toLowerCase();
    const phoneMatches =
      invitation.inviteePhone !== null &&
      invitee?.phoneVerified === true &&
      invitation.inviteePhone === invitee.phone;
    if (!emailMatches && !phoneMatches) return 'invalid';
    await tx
      .update(familyInvitations)
      .set({ status: decision, declinedAt: now })
      .where(eq(familyInvitations.id, invitation.id));
    return 'done';
  });
}

export async function declineInvitation(userId: string, token: string): Promise<void> {
  const outcome = await updateInvitationDecision(userId, token, 'declined');
  if (outcome === 'expired') {
    throw new ApiError(410, 'INVITATION_EXPIRED', 'The invitation has expired.');
  }
  if (outcome !== 'done') throw invitationNotFound();
}

export async function revokeInvitation(
  userId: string,
  familyId: string,
  invitationId: string,
): Promise<void> {
  await getDatabase().transaction(async (tx) => {
    const [family] = await tx
      .select({ id: families.id })
      .from(families)
      .where(eq(families.id, familyId))
      .for('update')
      .limit(1);
    if (!family) throw familyNotFound();
    const [owner] = await tx
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, userId),
          eq(familyMembers.role, 'owner'),
          eq(familyMembers.status, 'active'),
        ),
      )
      .limit(1);
    if (!owner) throw familyNotFound();
    const [invitation] = await tx
      .update(familyInvitations)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(
        and(
          eq(familyInvitations.id, invitationId),
          eq(familyInvitations.familyId, familyId),
          eq(familyInvitations.status, 'pending'),
        ),
      )
      .returning({ id: familyInvitations.id });
    if (!invitation) throw invitationNotFound();
  });
}

export async function removeFamilyMember(
  userId: string,
  familyId: string,
  targetUserId: string,
): Promise<void> {
  await getDatabase().transaction(async (tx) => {
    const [family] = await tx
      .select({ id: families.id })
      .from(families)
      .where(eq(families.id, familyId))
      .for('update')
      .limit(1);
    if (!family) throw familyNotFound();
    const [owner] = await tx
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, userId),
          eq(familyMembers.role, 'owner'),
          eq(familyMembers.status, 'active'),
        ),
      )
      .limit(1);
    if (!owner) throw familyNotFound();
    const [target] = await tx
      .select()
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, targetUserId),
          eq(familyMembers.status, 'active'),
        ),
      )
      .for('update')
      .limit(1);
    if (!target || target.role === 'owner' || targetUserId === userId) {
      throw new ApiError(404, 'MEMBER_NOT_FOUND', 'The requested active member was not found.');
    }
    const now = new Date();
    await tx
      .update(familyMembers)
      .set({ status: 'removed', leftAt: now })
      .where(eq(familyMembers.id, target.id));
    await tx
      .update(consents)
      .set({ granted: false, revokedAt: now })
      .where(
        and(
          eq(consents.userId, targetUserId),
          eq(consents.familyId, familyId),
          eq(consents.consentType, 'location_sharing'),
          eq(consents.granted, true),
        ),
      );
    await tx
      .update(locationSharingSessions)
      .set({ status: 'stopped', stoppedAt: now })
      .where(
        and(
          eq(locationSharingSessions.userId, targetUserId),
          eq(locationSharingSessions.familyId, familyId),
          sql`${locationSharingSessions.status} IN ('sharing', 'paused')`,
        ),
      );
    await tx
      .delete(locationPositions)
      .where(
        and(eq(locationPositions.userId, targetUserId), eq(locationPositions.familyId, familyId)),
      );
  });
  publishFamilyMembershipRemoved(familyId, targetUserId);
  publishLocationInvalidated(familyId);
}

export async function leaveFamily(userId: string, familyId: string): Promise<void> {
  await getDatabase().transaction(async (tx) => {
    const [family] = await tx
      .select({ id: families.id })
      .from(families)
      .where(eq(families.id, familyId))
      .for('update')
      .limit(1);
    if (!family) throw familyNotFound();
    const [membership] = await tx
      .select()
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
    if (membership.role === 'owner') {
      throw new ApiError(
        409,
        'OWNER_TRANSFER_REQUIRED',
        'Transfer ownership before leaving the family.',
      );
    }
    const now = new Date();
    await tx
      .update(familyMembers)
      .set({ status: 'left', leftAt: now })
      .where(eq(familyMembers.id, membership.id));
    await tx
      .update(consents)
      .set({ granted: false, revokedAt: now })
      .where(
        and(
          eq(consents.userId, userId),
          eq(consents.familyId, familyId),
          eq(consents.consentType, 'location_sharing'),
          eq(consents.granted, true),
        ),
      );
    await tx
      .update(locationSharingSessions)
      .set({ status: 'stopped', stoppedAt: now })
      .where(
        and(
          eq(locationSharingSessions.userId, userId),
          eq(locationSharingSessions.familyId, familyId),
          sql`${locationSharingSessions.status} IN ('sharing', 'paused')`,
        ),
      );
    await tx
      .delete(locationPositions)
      .where(and(eq(locationPositions.userId, userId), eq(locationPositions.familyId, familyId)));
  });
  publishFamilyMembershipRemoved(familyId, userId);
  publishLocationInvalidated(familyId);
}

export async function transferFamilyOwnership(
  userId: string,
  familyId: string,
  targetUserId: string,
): Promise<void> {
  if (userId === targetUserId) {
    throw new ApiError(400, 'INVALID_TRANSFER_TARGET', 'Choose another active family member.');
  }
  await getDatabase().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`famshield:family:${familyId}`}))`,
    );
    const [family] = await tx
      .select({ id: families.id })
      .from(families)
      .where(eq(families.id, familyId))
      .for('update')
      .limit(1);
    if (!family) throw familyNotFound();
    const [owner] = await tx
      .select()
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, userId),
          eq(familyMembers.role, 'owner'),
          eq(familyMembers.status, 'active'),
        ),
      )
      .for('update')
      .limit(1);
    if (!owner) throw familyNotFound();
    const [target] = await tx
      .select()
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, targetUserId),
          eq(familyMembers.status, 'active'),
          eq(familyMembers.role, 'member'),
        ),
      )
      .for('update')
      .limit(1);
    if (!target) {
      throw new ApiError(404, 'MEMBER_NOT_FOUND', 'The requested active member was not found.');
    }
    await tx.update(familyMembers).set({ role: 'member' }).where(eq(familyMembers.id, owner.id));
    await tx.update(familyMembers).set({ role: 'owner' }).where(eq(familyMembers.id, target.id));
  });
}
