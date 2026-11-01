import type { Express } from 'express';
import { and, eq } from 'drizzle-orm';
import supertest from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { getDatabase } from '../src/config/database.js';
import { consents, familyInvitations, familyMembers, families, users } from '../src/db/schema.js';
import { getTestDatabase } from './testDatabase.js';

type TestApi = ReturnType<typeof authenticatedApi>;

let identityNumber = 0;
let requestNumber = 30;

function request(application: Express) {
  return {
    get: (path: string) =>
      supertest(application).get(path).set('X-Forwarded-For', `198.51.100.${requestNumber++}`),
    post: (path: string) =>
      supertest(application).post(path).set('X-Forwarded-For', `198.51.100.${requestNumber++}`),
  };
}

function authenticatedApi(cookie: string, csrfToken: string) {
  const withHeaders = (test: ReturnType<typeof supertest>) =>
    test.set('Cookie', cookie).set('X-CSRF-Token', csrfToken);
  return {
    get: (path: string) =>
      supertest(app)
        .get(path)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', `198.51.100.${requestNumber++}`),
    post: (path: string) =>
      withHeaders(
        supertest(app).post(path).set('X-Forwarded-For', `198.51.100.${requestNumber++}`),
      ),
    delete: (path: string) =>
      withHeaders(
        supertest(app).delete(path).set('X-Forwarded-For', `198.51.100.${requestNumber++}`),
      ),
    cookie,
    csrfToken,
  };
}

async function createVerifiedUser(): Promise<{ api: TestApi; id: string; email: string }> {
  identityNumber += 1;
  const unique = `${Date.now()}-${identityNumber}`;
  const email = `family-${unique}@example.test`;
  const phone = `+1${String(Date.now()).slice(-10)}${identityNumber}`;
  const anonymous = request(app);
  const registration = await anonymous
    .post('/api/auth/register')
    .send({
      fullName: `Family Member ${identityNumber}`,
      email,
      phone,
      password: 'Strong!Passphrase2026',
      passwordConfirmation: 'Strong!Passphrase2026',
      acceptTerms: true,
      acceptPrivacy: true,
    })
    .expect(202);
  const codes = registration.body.data.developmentOtp as { email: string; phone: string };
  await anonymous.post('/api/auth/verify-email').send({ email, code: codes.email }).expect(200);
  await anonymous.post('/api/auth/verify-phone').send({ phone, code: codes.phone }).expect(200);
  const login = await anonymous
    .post('/api/auth/login')
    .send({ identifier: email, password: 'Strong!Passphrase2026', clientType: 'web' })
    .expect(200);
  const cookies = (login.headers['set-cookie'] as string[])
    .map((value) => value.split(';')[0])
    .join('; ');
  const api = authenticatedApi(cookies, login.body.data.csrfToken as string);
  const profile = await api.get('/api/users/me').expect(200);
  return { api, id: profile.body.data.user.id as string, email };
}

beforeEach(async () => {
  await getDatabase().transaction(async (tx) => {
    await tx.delete(consents);
    await tx.delete(families);
    await tx.delete(users);
  });
});

afterEach(async () => {
  await getDatabase().transaction(async (tx) => {
    await tx.delete(consents);
    await tx.delete(families);
    await tx.delete(users);
  });
});

describe('family management API', () => {
  it('creates owner memberships, lists multiple families, and scopes member access', async () => {
    const owner = await createVerifiedUser();
    const first = await owner.api
      .post('/api/families')
      .send({ name: 'Northstar Family' })
      .expect(201);
    const second = await owner.api
      .post('/api/families')
      .send({ name: 'Harbor Family' })
      .expect(201);

    expect(first.body.data.family.role).toBe('owner');
    expect((await owner.api.get('/api/families').expect(200)).body.data.families).toHaveLength(2);
    expect(
      (await owner.api.get(`/api/families/${first.body.data.family.id}/members`).expect(200)).body
        .data.members,
    ).toHaveLength(1);

    const stranger = await createVerifiedUser();
    await stranger.api.get(`/api/families/${first.body.data.family.id}`).expect(404);
    await stranger.api.get(`/api/families/${second.body.data.family.id}/members`).expect(404);
    const storedOwner = await getDatabase()
      .select()
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, first.body.data.family.id),
          eq(familyMembers.userId, owner.id),
        ),
      );
    expect(storedOwner[0]).toMatchObject({ role: 'owner', status: 'active' });
    const locationConsent = await getDatabase()
      .select()
      .from(consents)
      .where(and(eq(consents.userId, owner.id), eq(consents.consentType, 'location_sharing')));
    expect(locationConsent).toHaveLength(0);
    await expect(
      getTestDatabase().query(
        'INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, $3)',
        [first.body.data.family.id, owner.id, 'member'],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      getTestDatabase().query('INSERT INTO families (name, created_by) VALUES ($1, $2)', [
        'Ownerless',
        owner.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('creates hashed one-time invitations and accepts only for a verified matching contact', async () => {
    const owner = await createVerifiedUser();
    const invitee = await createVerifiedUser();
    const stranger = await createVerifiedUser();
    const family = (await owner.api.post('/api/families').send({ name: 'Pine Family' }).expect(201))
      .body.data.family;
    const created = await owner.api
      .post(`/api/families/${family.id}/invitations`)
      .send({ email: invitee.email })
      .expect(201);
    const token = created.body.data.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(JSON.stringify(created.body)).not.toContain('tokenHash');
    const [storedInvitation] = await getDatabase()
      .select()
      .from(familyInvitations)
      .where(eq(familyInvitations.id, created.body.data.invitation.id));
    expect(storedInvitation?.tokenHash).not.toBe(token);

    const invitationList = await owner.api
      .get(`/api/families/${family.id}/invitations`)
      .expect(200);
    expect(JSON.stringify(invitationList.body)).not.toContain(token);
    expect(JSON.stringify(invitationList.body)).not.toContain(storedInvitation?.tokenHash);
    expect(
      (await invitee.api.get('/api/invitations').expect(200)).body.data.invitations,
    ).toHaveLength(1);

    await stranger.api.post('/api/invitations/accept').send({ token }).expect(404);
    await getDatabase().update(users).set({ emailVerified: false }).where(eq(users.id, invitee.id));
    await invitee.api.post('/api/invitations/accept').send({ token }).expect(404);
    await getDatabase().update(users).set({ emailVerified: true }).where(eq(users.id, invitee.id));
    const accepted = await invitee.api.post('/api/invitations/accept').send({ token }).expect(200);
    expect(accepted.body.data.family).toMatchObject({ id: family.id, role: 'member' });
    expect((await invitee.api.get('/api/families').expect(200)).body.data.families).toHaveLength(1);
    const joinedLocationConsent = await getDatabase()
      .select()
      .from(consents)
      .where(and(eq(consents.userId, invitee.id), eq(consents.consentType, 'location_sharing')));
    expect(joinedLocationConsent).toHaveLength(0);
    await invitee.api.post('/api/invitations/accept').send({ token }).expect(404);
    await expect(
      owner.api.post(`/api/families/${family.id}/invitations`).send({ email: invitee.email }),
    ).resolves.toMatchObject({ status: 201 });
  });

  it('enforces owner-only management and protects ownership and membership lifecycle', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = (
      await owner.api.post('/api/families').send({ name: 'Cedar Family' }).expect(201)
    ).body.data.family;
    const invitation = (
      await owner.api
        .post(`/api/families/${family.id}/invitations`)
        .send({ email: member.email })
        .expect(201)
    ).body.data;
    await member.api.post('/api/invitations/accept').send({ token: invitation.token }).expect(200);

    await member.api
      .post(`/api/families/${family.id}/invitations`)
      .send({ email: 'another@example.test' })
      .expect(404);
    await member.api
      .post(`/api/families/${family.id}/transfer-ownership`)
      .send({ targetUserId: owner.id })
      .expect(404);
    await owner.api.post(`/api/families/${family.id}/leave`).send({}).expect(409);

    await owner.api
      .post(`/api/families/${family.id}/transfer-ownership`)
      .send({ targetUserId: member.id })
      .expect(200);
    const memberships = await getDatabase()
      .select({ userId: familyMembers.userId, role: familyMembers.role })
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, family.id), eq(familyMembers.status, 'active')));
    expect(memberships).toHaveLength(2);
    expect(memberships.find((row) => row.userId === member.id)?.role).toBe('owner');
    expect(memberships.find((row) => row.userId === owner.id)?.role).toBe('member');

    await owner.api.delete(`/api/families/${family.id}/members/${member.id}`).expect(404);
    await member.api.delete(`/api/families/${family.id}/members/${owner.id}`).expect(200);
    await owner.api.get(`/api/families/${family.id}`).expect(404);
    await member.api.post(`/api/families/${family.id}/leave`).send({}).expect(409);
  });

  it('expires invitations and blocks declined, revoked, and replayed invitations', async () => {
    const owner = await createVerifiedUser();
    const firstInvitee = await createVerifiedUser();
    const secondInvitee = await createVerifiedUser();
    const family = (
      await owner.api.post('/api/families').send({ name: 'Maple Family' }).expect(201)
    ).body.data.family;

    const toExpire = (
      await owner.api
        .post(`/api/families/${family.id}/invitations`)
        .send({ email: firstInvitee.email })
        .expect(201)
    ).body.data;
    const [expirationTarget] = await getDatabase()
      .select()
      .from(familyInvitations)
      .where(eq(familyInvitations.id, toExpire.invitation.id));
    if (!expirationTarget) throw new Error('Test invitation was not persisted.');
    await getDatabase()
      .update(familyInvitations)
      .set({ expiresAt: new Date(expirationTarget.createdAt.getTime() + 1) })
      .where(eq(familyInvitations.id, toExpire.invitation.id));
    await firstInvitee.api
      .post('/api/invitations/accept')
      .send({ token: toExpire.token })
      .expect(410);
    const [expired] = await getDatabase()
      .select()
      .from(familyInvitations)
      .where(eq(familyInvitations.id, toExpire.invitation.id));
    expect(expired?.status).toBe('expired');

    const toDecline = (
      await owner.api
        .post(`/api/families/${family.id}/invitations`)
        .send({ email: firstInvitee.email })
        .expect(201)
    ).body.data;
    await firstInvitee.api
      .post('/api/invitations/decline')
      .send({ token: toDecline.token })
      .expect(200);
    await firstInvitee.api
      .post('/api/invitations/accept')
      .send({ token: toDecline.token })
      .expect(404);

    const toRevoke = (
      await owner.api
        .post(`/api/families/${family.id}/invitations`)
        .send({ email: secondInvitee.email })
        .expect(201)
    ).body.data;
    await owner.api
      .delete(`/api/families/${family.id}/invitations/${toRevoke.invitation.id}`)
      .expect(200);
    await secondInvitee.api
      .post('/api/invitations/accept')
      .send({ token: toRevoke.token })
      .expect(404);
    await owner.api
      .post(`/api/families/${family.id}/invitations`)
      .send({ email: secondInvitee.email })
      .expect(201);
  });

  it('rejects duplicate pending invitations and atomically accepts a token once', async () => {
    const owner = await createVerifiedUser();
    const invitee = await createVerifiedUser();
    const family = (
      await owner.api.post('/api/families').send({ name: 'Birch Family' }).expect(201)
    ).body.data.family;
    const invitation = (
      await owner.api
        .post(`/api/families/${family.id}/invitations`)
        .send({ phone: '+14155550991' })
        .expect(201)
    ).body.data;
    await owner.api
      .post(`/api/families/${family.id}/invitations`)
      .send({ phone: '+14155550991' })
      .expect(409);
    const actualContactInvitation = (
      await owner.api
        .post(`/api/families/${family.id}/invitations`)
        .send({ email: invitee.email })
        .expect(201)
    ).body.data;
    const results = await Promise.all([
      invitee.api.post('/api/invitations/accept').send({ token: actualContactInvitation.token }),
      invitee.api.post('/api/invitations/accept').send({ token: actualContactInvitation.token }),
    ]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status !== 200)).toHaveLength(1);
    await expect(
      getDatabase()
        .select()
        .from(familyInvitations)
        .where(eq(familyInvitations.id, invitation.invitation.id)),
    ).resolves.toHaveLength(1);
  });

  it('preserves membership history when a member leaves and rejoins', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = (
      await owner.api.post('/api/families').send({ name: 'Willow Family' }).expect(201)
    ).body.data.family;
    const invitation = (
      await owner.api
        .post(`/api/families/${family.id}/invitations`)
        .send({ email: member.email })
        .expect(201)
    ).body.data;
    await member.api.post('/api/invitations/accept').send({ token: invitation.token }).expect(200);
    await member.api.post(`/api/families/${family.id}/leave`).send({}).expect(200);
    const [leftMembership] = await getDatabase()
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, family.id), eq(familyMembers.userId, member.id)));
    expect(leftMembership).toMatchObject({ status: 'left', role: 'member' });
    expect(leftMembership?.leftAt).toBeInstanceOf(Date);

    const reinvitation = (
      await owner.api
        .post(`/api/families/${family.id}/invitations`)
        .send({ email: member.email })
        .expect(201)
    ).body.data;
    await member.api
      .post('/api/invitations/accept')
      .send({ token: reinvitation.token })
      .expect(200);
    const history = await getDatabase()
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, family.id), eq(familyMembers.userId, member.id)));
    expect(history.map((membership) => membership.status).sort()).toEqual(['active', 'left']);
  });

  it('serializes competing ownership transfers and leaves exactly one active owner', async () => {
    const owner = await createVerifiedUser();
    const firstMember = await createVerifiedUser();
    const secondMember = await createVerifiedUser();
    const family = (
      await owner.api.post('/api/families').send({ name: 'Aspen Family' }).expect(201)
    ).body.data.family;
    for (const member of [firstMember, secondMember]) {
      const invitation = (
        await owner.api
          .post(`/api/families/${family.id}/invitations`)
          .send({ email: member.email })
          .expect(201)
      ).body.data;
      await member.api
        .post('/api/invitations/accept')
        .send({ token: invitation.token })
        .expect(200);
    }

    const transfers = await Promise.all([
      owner.api
        .post(`/api/families/${family.id}/transfer-ownership`)
        .send({ targetUserId: firstMember.id }),
      owner.api
        .post(`/api/families/${family.id}/transfer-ownership`)
        .send({ targetUserId: secondMember.id }),
    ]);
    expect(transfers.map((response) => response.status).sort()).toEqual([200, 404]);
    const activeOwners = await getDatabase()
      .select()
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, family.id),
          eq(familyMembers.role, 'owner'),
          eq(familyMembers.status, 'active'),
        ),
      );
    expect(activeOwners).toHaveLength(1);
  });
});
