import type { Express } from 'express';
import { and, eq } from 'drizzle-orm';
import supertest from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { getDatabase } from '../src/config/database.js';
import { cleanupExpiredLocationSharing } from '../src/services/locationService.js';
import { getTestDatabase, waitForLockWaiters } from './testDatabase.js';
import {
  consents,
  families,
  familyMembers,
  locationPositions,
  locationSharingSessions,
  users,
} from '../src/db/schema.js';

type TestApi = ReturnType<typeof authenticatedApi>;

let identityNumber = 0;
let requestNumber = 120;

function anonymousApi(application: Express) {
  const nextIp = () => `198.51.100.${requestNumber++}`;
  return {
    post: (path: string) => supertest(application).post(path).set('X-Forwarded-For', nextIp()),
  };
}

function authenticatedApi(cookie: string, csrfToken: string) {
  const nextIp = () => `198.51.100.${requestNumber++}`;
  const withHeaders = (test: ReturnType<typeof supertest>) =>
    test.set('Cookie', cookie).set('X-CSRF-Token', csrfToken).set('X-Forwarded-For', nextIp());
  return {
    get: (path: string) =>
      supertest(app).get(path).set('Cookie', cookie).set('X-Forwarded-For', nextIp()),
    post: (path: string) => withHeaders(supertest(app).post(path)),
    put: (path: string) => withHeaders(supertest(app).put(path)),
    delete: (path: string) => withHeaders(supertest(app).delete(path)),
  };
}

async function createVerifiedUser(): Promise<{ api: TestApi; id: string; email: string }> {
  identityNumber += 1;
  const unique = `${Date.now()}-${identityNumber}`;
  const email = `location-${unique}@example.test`;
  const phone = `+1${String(Date.now()).slice(-10)}${identityNumber}`;
  const anonymous = anonymousApi(app);
  const registration = await anonymous
    .post('/api/auth/register')
    .send({
      fullName: `Location User ${identityNumber}`,
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
  const cookie = (login.headers['set-cookie'] as string[])
    .map((value) => value.split(';')[0])
    .join('; ');
  const api = authenticatedApi(cookie, login.body.data.csrfToken as string);
  const profile = await api.get('/api/users/me').expect(200);
  return { api, id: profile.body.data.user.id as string, email };
}

async function createFamily(api: TestApi, name: string) {
  return (await api.post('/api/families').send({ name }).expect(201)).body.data.family as {
    id: string;
    name: string;
  };
}

async function grantConsent(api: TestApi, familyId: string) {
  await api
    .post('/api/consents/location-sharing')
    .send({ familyId, policyVersion: 'location-sharing-v1', confirmed: true })
    .expect(201);
}

async function startSession(api: TestApi, familyId: string) {
  return (await api.post(`/api/families/${familyId}/location-sharing/sessions`).send().expect(201))
    .body.data as { id: string; sessionVersion: string; status: string };
}

function submitPosition(
  api: TestApi,
  familyId: string,
  sessionId: string,
  sequence: number,
  payload: Partial<{
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    clientRecordedAt: string;
  }> = {},
) {
  return api.put(`/api/families/${familyId}/location-sharing/sessions/${sessionId}/position`).send({
    latitude: 37.421999,
    longitude: -122.084057,
    accuracyMeters: 12.34,
    sequence,
    clientRecordedAt: new Date().toISOString(),
    ...payload,
  });
}

async function inviteMember(
  owner: TestApi,
  familyId: string,
  member: { api: TestApi; email: string },
) {
  const invitation = await owner
    .post(`/api/families/${familyId}/invitations`)
    .send({ email: member.email })
    .expect(201);
  await member.api
    .post('/api/invitations/accept')
    .send({ token: invitation.body.data.token as string })
    .expect(200);
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

describe('location-sharing backend', () => {
  it('requires the authenticated sharer to have current consent and active membership', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = await createFamily(owner.api, 'Consented Sharing');
    await inviteMember(owner.api, family.id, member);

    await member.api
      .post(`/api/families/${family.id}/location-sharing/sessions`)
      .send({ userId: owner.id, consentGranted: true })
      .expect(403);
    const session = await startSessionAfterGrant(owner.api, family.id);
    await owner.api
      .put(`/api/families/${family.id}/location-sharing/sessions/${session.id}/position`)
      .send({
        userId: member.id,
        latitude: 0,
        longitude: 0,
        accuracyMeters: 1,
        sequence: 1,
        clientRecordedAt: new Date().toISOString(),
      })
      .expect(400);

    const stranger = await createVerifiedUser();
    await stranger.api
      .post(`/api/families/${family.id}/location-sharing/sessions`)
      .send()
      .expect(404);
    await stranger.api.get(`/api/families/${family.id}/locations`).expect(404);
  });

  it('stores only rounded latest positions, rejects replay, and permits an active non-consenting member to view', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = await createFamily(owner.api, 'Latest Position');
    await inviteMember(owner.api, family.id, member);
    await grantConsent(owner.api, family.id);
    const session = await startSession(owner.api, family.id);

    const accepted = await submitPosition(owner.api, family.id, session.id, 2).expect(200);
    expect(accepted.body.data.precisionDecimalPlaces).toBe(4);
    expect(Date.parse(accepted.body.data.sessionExpiresAt)).toBeGreaterThan(Date.now());
    const rows = await getDatabase().select().from(locationPositions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.latitude).toBe('37.4220');
    expect(rows[0]?.longitude).toBe('-122.0841');

    await submitPosition(owner.api, family.id, session.id, 2).expect(409);
    await submitPosition(owner.api, family.id, session.id, 1).expect(409);
    await submitPosition(owner.api, family.id, session.id, 3, {
      clientRecordedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    }).expect(409);
    const read = await member.api.get(`/api/families/${family.id}/locations`).expect(200);
    expect(read.body.data.locations).toHaveLength(1);
    expect(read.body.data.locations[0]).toMatchObject({
      userId: owner.id,
      status: 'fresh',
      latitude: 37.422,
      longitude: -122.0841,
    });
  });

  it('rejects invalid coordinates and client timestamps', async () => {
    const user = await createVerifiedUser();
    const family = await createFamily(user.api, 'Coordinate Validation');
    await grantConsent(user.api, family.id);
    const session = await startSession(user.api, family.id);

    await submitPosition(user.api, family.id, session.id, 1, { latitude: 91 }).expect(400);
    await submitPosition(user.api, family.id, session.id, 1, { longitude: 181 }).expect(400);
    await submitPosition(user.api, family.id, session.id, 1, { accuracyMeters: -1 }).expect(400);
    await submitPosition(user.api, family.id, session.id, 1, {
      clientRecordedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }).expect(400);
    expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
  });

  it('deletes the current position and permanently invalidates the session on revocation', async () => {
    const user = await createVerifiedUser();
    const family = await createFamily(user.api, 'Revoked Sharing');
    await grantConsent(user.api, family.id);
    const session = await startSession(user.api, family.id);
    await submitPosition(user.api, family.id, session.id, 1).expect(200);

    await user.api.delete(`/api/consents/location-sharing/${family.id}`).expect(200);
    expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
    const [storedSession] = await getDatabase()
      .select()
      .from(locationSharingSessions)
      .where(eq(locationSharingSessions.id, session.id));
    expect(storedSession).toMatchObject({ status: 'stopped' });
    await submitPosition(user.api, family.id, session.id, 2).expect(403);
    await user.api
      .post(`/api/families/${family.id}/location-sharing/sessions/${session.id}/resume`)
      .send()
      .expect(409);
    await user.api
      .get(`/api/families/${family.id}/locations`)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.locations).toHaveLength(0);
      });
  });

  it('invalidates and deletes a removed member’s session within the membership transaction', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = await createFamily(owner.api, 'Removed Sharer');
    await inviteMember(owner.api, family.id, member);
    await grantConsent(member.api, family.id);
    const session = await startSession(member.api, family.id);
    await submitPosition(member.api, family.id, session.id, 1).expect(200);

    await owner.api.delete(`/api/families/${family.id}/members/${member.id}`).expect(200);
    expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
    const [storedSession] = await getDatabase()
      .select()
      .from(locationSharingSessions)
      .where(eq(locationSharingSessions.id, session.id));
    expect(storedSession).toMatchObject({ status: 'stopped' });
    await member.api.get(`/api/families/${family.id}/locations`).expect(404);
  });

  it('serializes position updates racing consent revocation on independent transactions', async () => {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const user = await createVerifiedUser();
      const viewer = await createVerifiedUser();
      const family = await createFamily(user.api, `Concurrent Revoke ${iteration}`);
      await inviteMember(user.api, family.id, viewer);
      await grantConsent(user.api, family.id);
      const session = await startSession(user.api, family.id);
      await submitPosition(user.api, family.id, session.id, 1).expect(200);

      const lockClient = await getTestDatabase().connect();
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT id FROM families WHERE id = $1 FOR UPDATE', [family.id]);
      try {
        const updatePromise = submitPosition(user.api, family.id, session.id, 2).then(
          (response) => response,
        );
        await waitForLockWaiters('families', 1);
        const revokePromise = user.api
          .delete(`/api/consents/location-sharing/${family.id}`)
          .then((response) => response);
        await waitForLockWaiters('families', 2);
        const readPromise = viewer.api
          .get(`/api/families/${family.id}/locations`)
          .then((response) => response);
        await waitForLockWaiters('families', 3);
        await lockClient.query('COMMIT');

        const [update, revoke, concurrentRead] = await Promise.all([
          updatePromise,
          revokePromise,
          readPromise,
        ]);
        expect(update.status).toBe(200);
        expect(revoke.status).toBe(200);
        expect(concurrentRead.status).toBe(200);
        expect(concurrentRead.body.data.locations).toHaveLength(0);
        expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
        expect(
          (await viewer.api.get(`/api/families/${family.id}/locations`).expect(200)).body.data
            .locations,
        ).toHaveLength(0);
        await submitPosition(user.api, family.id, session.id, 3).expect(403);
      } finally {
        await lockClient.query('ROLLBACK');
        lockClient.release();
      }
    }
  });

  it('serializes position updates racing family removal on independent transactions', async () => {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const owner = await createVerifiedUser();
      const sharer = await createVerifiedUser();
      const viewer = await createVerifiedUser();
      const family = await createFamily(owner.api, `Concurrent Removal ${iteration}`);
      await inviteMember(owner.api, family.id, sharer);
      await inviteMember(owner.api, family.id, viewer);
      await grantConsent(sharer.api, family.id);
      const session = await startSession(sharer.api, family.id);
      await submitPosition(sharer.api, family.id, session.id, 1).expect(200);

      const lockClient = await getTestDatabase().connect();
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT id FROM families WHERE id = $1 FOR UPDATE', [family.id]);
      try {
        const updatePromise = submitPosition(sharer.api, family.id, session.id, 2).then(
          (response) => response,
        );
        await waitForLockWaiters('families', 1);
        const removePromise = owner.api
          .delete(`/api/families/${family.id}/members/${sharer.id}`)
          .then((response) => response);
        await waitForLockWaiters('families', 2);
        await lockClient.query('COMMIT');

        const [update, remove] = await Promise.all([updatePromise, removePromise]);
        expect(update.status).toBe(200);
        expect(remove.status).toBe(200);
        expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
        await viewer.api
          .get(`/api/families/${family.id}/locations`)
          .expect(200)
          .expect((response) => {
            expect(response.body.data.locations).toHaveLength(0);
          });
        await submitPosition(sharer.api, family.id, session.id, 3).expect(404);
      } finally {
        await lockClient.query('ROLLBACK');
        lockClient.release();
      }
    }
  });

  it('deletes positions when sharing is paused or stopped and omits expired positions', async () => {
    const user = await createVerifiedUser();
    const family = await createFamily(user.api, 'Session Lifecycle');
    await grantConsent(user.api, family.id);
    const session = await startSession(user.api, family.id);
    await submitPosition(user.api, family.id, session.id, 1).expect(200);

    await user.api
      .post(`/api/families/${family.id}/location-sharing/sessions/${session.id}/pause`)
      .send()
      .expect(200);
    expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
    await submitPosition(user.api, family.id, session.id, 2).expect(409);
    const [pausedSession] = await getDatabase()
      .select()
      .from(locationSharingSessions)
      .where(eq(locationSharingSessions.id, session.id));
    expect(pausedSession?.status).toBe('paused');
    await user.api
      .post(`/api/families/${family.id}/location-sharing/sessions/${session.id}/resume`)
      .send()
      .expect(200);
    await submitPosition(user.api, family.id, session.id, 2).expect(200);
    await getDatabase()
      .update(locationPositions)
      .set({
        recordedAt: new Date(Date.now() - 11 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1000),
      })
      .where(and(eq(locationPositions.userId, user.id), eq(locationPositions.familyId, family.id)));
    expect(
      (await user.api.get(`/api/families/${family.id}/locations`).expect(200)).body.data.locations,
    ).toHaveLength(0);
    await user.api
      .post(`/api/families/${family.id}/location-sharing/sessions/${session.id}/stop`)
      .send()
      .expect(200);
    expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
    await user.api
      .post(`/api/families/${family.id}/location-sharing/sessions/${session.id}/stop`)
      .send()
      .expect(409);
    await submitPosition(user.api, family.id, session.id, 3).expect(403);

    const replacement = await startSession(user.api, family.id);
    await submitPosition(user.api, family.id, replacement.id, 1).expect(200);
    await getDatabase()
      .update(locationPositions)
      .set({
        recordedAt: new Date(Date.now() - 3 * 60 * 1000),
        expiresAt: new Date(Date.now() + 7 * 60 * 1000),
      })
      .where(and(eq(locationPositions.userId, user.id), eq(locationPositions.familyId, family.id)));
    expect(
      (await user.api.get(`/api/families/${family.id}/locations`).expect(200)).body.data
        .locations[0].status,
    ).toBe('stale');
    const [replacementRow] = await getDatabase()
      .select({ startedAt: locationSharingSessions.startedAt })
      .from(locationSharingSessions)
      .where(eq(locationSharingSessions.id, replacement.id));
    if (!replacementRow) throw new Error('Expected the new location session to exist.');
    await getDatabase()
      .update(locationSharingSessions)
      .set({ expiresAt: new Date(replacementRow.startedAt.getTime() + 1) })
      .where(eq(locationSharingSessions.id, replacement.id));
    await submitPosition(user.api, family.id, replacement.id, 2).expect(409);
    const [expiredSession] = await getDatabase()
      .select()
      .from(locationSharingSessions)
      .where(eq(locationSharingSessions.id, replacement.id));
    expect(expiredSession?.status).toBe('expired');
    expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
  });

  it('invalidates sessions and positions when a member leaves or their policy grant is outdated', async () => {
    const owner = await createVerifiedUser();
    const leavingMember = await createVerifiedUser();
    const family = await createFamily(owner.api, 'Leave and Policy');
    await inviteMember(owner.api, family.id, leavingMember);
    await grantConsent(leavingMember.api, family.id);
    const leavingSession = await startSession(leavingMember.api, family.id);
    await submitPosition(leavingMember.api, family.id, leavingSession.id, 1).expect(200);
    await leavingMember.api.post(`/api/families/${family.id}/leave`).send().expect(200);
    expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
    const [stopped] = await getDatabase()
      .select()
      .from(locationSharingSessions)
      .where(eq(locationSharingSessions.id, leavingSession.id));
    expect(stopped?.status).toBe('stopped');

    const policyMember = await createVerifiedUser();
    await inviteMember(owner.api, family.id, policyMember);
    await grantConsent(policyMember.api, family.id);
    const policySession = await startSession(policyMember.api, family.id);
    await submitPosition(policyMember.api, family.id, policySession.id, 1).expect(200);
    await getDatabase()
      .update(consents)
      .set({ version: 'location-sharing-old' })
      .where(and(eq(consents.userId, policyMember.id), eq(consents.familyId, family.id)));
    await cleanupExpiredLocationSharing();
    const [expired] = await getDatabase()
      .select()
      .from(locationSharingSessions)
      .where(eq(locationSharingSessions.id, policySession.id));
    expect(expired?.status).toBe('expired');
    expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
    expect(
      (await owner.api.get(`/api/families/${family.id}/locations`).expect(200)).body.data.locations,
    ).toHaveLength(0);
  });

  it('handles concurrent session creation and never returns locations without valid consent', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = await createFamily(owner.api, 'Concurrent Start');
    await inviteMember(owner.api, family.id, member);
    await grantConsent(owner.api, family.id);

    const starts = await Promise.all([
      owner.api.post(`/api/families/${family.id}/location-sharing/sessions`).send(),
      owner.api.post(`/api/families/${family.id}/location-sharing/sessions`).send(),
    ]);
    expect(starts.map((response) => response.status).sort()).toEqual([201, 409]);
    const sessionId = starts.find((response) => response.status === 201)?.body.data.id as string;
    await submitPosition(owner.api, family.id, sessionId, 1).expect(200);

    const ownerLocations = await owner.api.get(`/api/families/${family.id}/locations`).expect(200);
    expect(
      ownerLocations.body.data.locations.map((item: { userId: string }) => item.userId),
    ).toEqual([owner.id]);
    const memberLocations = await member.api
      .get(`/api/families/${family.id}/locations`)
      .expect(200);
    expect(
      memberLocations.body.data.locations.map((item: { userId: string }) => item.userId),
    ).toEqual([owner.id]);
    const [memberMembership] = await getDatabase()
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, family.id), eq(familyMembers.userId, member.id)));
    expect(memberMembership?.status).toBe('active');
  });
});

async function startSessionAfterGrant(api: TestApi, familyId: string) {
  await grantConsent(api, familyId);
  return startSession(api, familyId);
}
