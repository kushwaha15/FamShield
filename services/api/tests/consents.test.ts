import type { Express } from 'express';
import { and, eq } from 'drizzle-orm';
import supertest from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { getDatabase } from '../src/config/database.js';
import { consents, families, users } from '../src/db/schema.js';
import { hasActiveLocationSharingConsent } from '../src/services/consentService.js';

type TestApi = ReturnType<typeof authenticatedApi>;

let identityNumber = 0;
let requestNumber = 70;

function request(application: Express) {
  return {
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
  };
}

async function createVerifiedUser(): Promise<{ api: TestApi; id: string; email: string }> {
  identityNumber += 1;
  const unique = `${Date.now()}-${identityNumber}`;
  const email = `consent-${unique}@example.test`;
  const phone = `+1${String(Date.now()).slice(-10)}${identityNumber}`;
  const anonymous = request(app);
  const registration = await anonymous
    .post('/api/auth/register')
    .send({
      fullName: `Consent User ${identityNumber}`,
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

describe('location-sharing consent API', () => {
  it('requires explicit current-policy confirmation for an active family member', async () => {
    const owner = await createVerifiedUser();
    const family = (
      await owner.api.post('/api/families').send({ name: 'Consent Family' }).expect(201)
    ).body.data.family;
    const initial = await owner.api.get('/api/consents/location-sharing').expect(200);
    expect(initial.body.data).toMatchObject({
      policyVersion: 'location-sharing-v1',
      scopes: [{ familyId: family.id, familyName: 'Consent Family', enabled: false }],
    });

    await owner.api
      .post('/api/consents/location-sharing')
      .send({
        familyId: family.id,
        policyVersion: 'location-sharing-v1',
        confirmed: true,
        userId: owner.id,
      })
      .expect(400);
    await owner.api
      .post('/api/consents/location-sharing')
      .send({ familyId: family.id, policyVersion: 'location-sharing-old', confirmed: true })
      .expect(409);

    const grant = await owner.api
      .post('/api/consents/location-sharing')
      .send({ familyId: family.id, policyVersion: 'location-sharing-v1', confirmed: true })
      .expect(201);
    expect(grant.body.data).toMatchObject({
      familyId: family.id,
      familyName: 'Consent Family',
      enabled: true,
      policyVersion: 'location-sharing-v1',
    });
    expect(await hasActiveLocationSharingConsent(owner.id, family.id)).toBe(true);

    await Promise.all([
      owner.api
        .post('/api/consents/location-sharing')
        .send({ familyId: family.id, policyVersion: 'location-sharing-v1', confirmed: true })
        .expect(201),
      owner.api
        .post('/api/consents/location-sharing')
        .send({ familyId: family.id, policyVersion: 'location-sharing-v1', confirmed: true })
        .expect(201),
    ]);
    const activeGrants = await getDatabase()
      .select()
      .from(consents)
      .where(
        and(
          eq(consents.userId, owner.id),
          eq(consents.familyId, family.id),
          eq(consents.consentType, 'location_sharing'),
          eq(consents.granted, true),
        ),
      );
    expect(activeGrants).toHaveLength(1);

    const unrelated = await createVerifiedUser();
    await unrelated.api
      .post('/api/consents/location-sharing')
      .send({ familyId: family.id, policyVersion: 'location-sharing-v1', confirmed: true })
      .expect(404);
    await unrelated.api.delete(`/api/consents/location-sharing/${family.id}`).expect(404);
  });

  it('records grants and revocations in user-scoped history and revokes idempotently', async () => {
    const user = await createVerifiedUser();
    const family = (
      await user.api.post('/api/families').send({ name: 'History Family' }).expect(201)
    ).body.data.family;
    await user.api
      .post('/api/consents/location-sharing')
      .send({ familyId: family.id, policyVersion: 'location-sharing-v1', confirmed: true })
      .expect(201);

    await user.api.delete(`/api/consents/location-sharing/${family.id}`).expect(200);
    expect(await hasActiveLocationSharingConsent(user.id, family.id)).toBe(false);
    const current = await user.api.get('/api/consents/location-sharing').expect(200);
    expect(current.body.data.scopes).toMatchObject([{ familyId: family.id, enabled: false }]);
    const history = await user.api.get('/api/consents/location-sharing/history').expect(200);
    expect(history.body.data.history).toHaveLength(1);
    expect(history.body.data.history[0]).toMatchObject({
      familyId: family.id,
      status: 'revoked',
      policyVersion: 'location-sharing-v1',
    });
    expect(history.body.data.history[0].grantedAt).toEqual(expect.any(String));
    expect(history.body.data.history[0].revokedAt).toEqual(expect.any(String));
    await user.api.delete(`/api/consents/location-sharing/${family.id}`).expect(200);

    const stored = await getDatabase()
      .select()
      .from(consents)
      .where(
        and(
          eq(consents.userId, user.id),
          eq(consents.familyId, family.id),
          eq(consents.consentType, 'location_sharing'),
        ),
      );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ granted: false, version: 'location-sharing-v1' });

    await user.api
      .post('/api/consents/location-sharing')
      .send({ familyId: family.id, policyVersion: 'location-sharing-v1', confirmed: true })
      .expect(201);
    const newHistory = await user.api.get('/api/consents/location-sharing/history').expect(200);
    expect(newHistory.body.data.history).toHaveLength(2);
    expect(newHistory.body.data.history.map((entry: { status: string }) => entry.status)).toEqual([
      'granted',
      'revoked',
    ]);
  });

  it('does not authorize an outdated policy and requires a fresh confirmation', async () => {
    const user = await createVerifiedUser();
    const family = (
      await user.api.post('/api/families').send({ name: 'Policy Update Family' }).expect(201)
    ).body.data.family;
    await getDatabase().insert(consents).values({
      userId: user.id,
      familyId: family.id,
      consentType: 'location_sharing',
      granted: true,
      grantedAt: new Date(),
      version: 'location-sharing-v0',
    });

    const status = await user.api.get('/api/consents/location-sharing').expect(200);
    expect(status.body.data.scopes).toMatchObject([
      { familyId: family.id, enabled: false, needsReview: true },
    ]);
    expect(await hasActiveLocationSharingConsent(user.id, family.id)).toBe(false);

    await user.api
      .post('/api/consents/location-sharing')
      .send({ familyId: family.id, policyVersion: 'location-sharing-v1', confirmed: true })
      .expect(201);
    expect(await hasActiveLocationSharingConsent(user.id, family.id)).toBe(true);
    const history = await user.api.get('/api/consents/location-sharing/history').expect(200);
    expect(history.body.data.history.map((entry: { status: string }) => entry.status)).toEqual([
      'granted',
      'revoked',
    ]);
  });

  it('does not transfer consent and revokes it atomically when a member leaves', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = (
      await owner.api.post('/api/families').send({ name: 'Member Consent Family' }).expect(201)
    ).body.data.family;
    const invitation = (
      await owner.api
        .post(`/api/families/${family.id}/invitations`)
        .send({ email: member.email })
        .expect(201)
    ).body.data.token as string;
    await member.api.post('/api/invitations/accept').send({ token: invitation }).expect(200);

    expect(
      (await member.api.get('/api/consents/location-sharing').expect(200)).body.data.scopes,
    ).toMatchObject([{ familyId: family.id, enabled: false }]);
    await member.api
      .post('/api/consents/location-sharing')
      .send({ familyId: family.id, policyVersion: 'location-sharing-v1', confirmed: true })
      .expect(201);
    await member.api.post(`/api/families/${family.id}/leave`).send({}).expect(200);
    expect(await hasActiveLocationSharingConsent(member.id, family.id)).toBe(false);

    const history = await member.api.get('/api/consents/location-sharing/history').expect(200);
    expect(history.body.data.history[0]).toMatchObject({
      familyId: family.id,
      status: 'revoked',
    });
    const [stored] = await getDatabase()
      .select()
      .from(consents)
      .where(
        and(
          eq(consents.userId, member.id),
          eq(consents.familyId, family.id),
          eq(consents.consentType, 'location_sharing'),
        ),
      );
    expect(stored).toMatchObject({ granted: false });
    expect(stored?.revokedAt).toBeInstanceOf(Date);
  });

  it('revokes an active grant when an owner removes the consenting member', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = (
      await owner.api.post('/api/families').send({ name: 'Removal Consent Family' }).expect(201)
    ).body.data.family;
    const invitation = (
      await owner.api
        .post(`/api/families/${family.id}/invitations`)
        .send({ email: member.email })
        .expect(201)
    ).body.data.token as string;
    await member.api.post('/api/invitations/accept').send({ token: invitation }).expect(200);
    await member.api
      .post('/api/consents/location-sharing')
      .send({ familyId: family.id, policyVersion: 'location-sharing-v1', confirmed: true })
      .expect(201);

    await owner.api.delete(`/api/families/${family.id}/members/${member.id}`).expect(200);
    const history = await member.api.get('/api/consents/location-sharing/history').expect(200);
    expect(history.body.data.history[0]).toMatchObject({
      familyId: family.id,
      status: 'revoked',
    });
    expect(history.body.data.history[0].revokedAt).toEqual(expect.any(String));
  });
});
