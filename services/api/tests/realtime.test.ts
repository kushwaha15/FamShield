import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import supertest from 'supertest';
import { io as createSocket, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { getDatabase } from '../src/config/database.js';
import {
  consents,
  families,
  locationPositions,
  locationSharingSessions,
  refreshTokens,
  users,
} from '../src/db/schema.js';
import { createRealtimeServer } from '../src/sockets/realtimeServer.js';
import { publishLocationChanged } from '../src/sockets/locationNotifications.js';
import { getTestDatabase, waitForLockWaiters, waitForNoLockWaiters } from './testDatabase.js';

type TestIdentity = {
  accessToken: string;
  api: ReturnType<typeof authenticatedApi>;
  email: string;
  id: string;
  refreshToken: string;
  sessionId: string;
};

const server = createServer(app);
let realtime: ReturnType<typeof createRealtimeServer>;
let realtimeUrl = '';
const sockets = new Set<ClientSocket>();
let identityNumber = 0;
let requestNumber = 30;

function request(application: Express = app) {
  const nextIp = () => `192.0.2.${requestNumber++}`;
  return {
    get: (path: string) => supertest(application).get(path).set('X-Forwarded-For', nextIp()),
    post: (path: string) => supertest(application).post(path).set('X-Forwarded-For', nextIp()),
  };
}

function authenticatedApi(accessToken: string) {
  const nextIp = () => `192.0.2.${requestNumber++}`;
  const withAuth = (test: ReturnType<typeof supertest>) =>
    test.set('Authorization', `Bearer ${accessToken}`).set('X-Forwarded-For', nextIp());
  return {
    get: (path: string) => withAuth(supertest(app).get(path)),
    post: (path: string) => withAuth(supertest(app).post(path)),
    put: (path: string) => withAuth(supertest(app).put(path)),
    delete: (path: string) => withAuth(supertest(app).delete(path)),
  };
}

async function createVerifiedUser(): Promise<TestIdentity> {
  identityNumber += 1;
  const unique = `${Date.now()}-${identityNumber}`;
  const email = `realtime-${unique}@example.test`;
  const phone = `+1${String(Date.now()).slice(-10)}${identityNumber}`;
  const anonymous = request();
  const registration = await anonymous
    .post('/api/auth/register')
    .send({
      fullName: `Realtime User ${identityNumber}`,
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
    .send({ identifier: email, password: 'Strong!Passphrase2026', clientType: 'mobile' })
    .expect(200);
  const accessToken = login.body.data.accessToken as string;
  const api = authenticatedApi(accessToken);
  const profile = await api.get('/api/users/me').expect(200);
  return {
    accessToken,
    api,
    email,
    id: profile.body.data.user.id as string,
    refreshToken: login.body.data.refreshToken as string,
    sessionId: login.body.data.sessionId as string,
  };
}

async function createFamily(owner: TestIdentity, name: string) {
  return (await owner.api.post('/api/families').send({ name }).expect(201)).body.data.family as {
    id: string;
    name: string;
  };
}

async function inviteMember(owner: TestIdentity, familyId: string, member: TestIdentity) {
  const invitation = await owner.api
    .post(`/api/families/${familyId}/invitations`)
    .send({ email: member.email })
    .expect(201);
  await member.api
    .post('/api/invitations/accept')
    .send({ token: invitation.body.data.token as string })
    .expect(200);
}

async function startSharing(user: TestIdentity, familyId: string) {
  await user.api
    .post('/api/consents/location-sharing')
    .send({ familyId, policyVersion: 'location-sharing-v1', confirmed: true })
    .expect(201);
  const response = await user.api
    .post(`/api/families/${familyId}/location-sharing/sessions`)
    .send()
    .expect(201);
  return response.body.data as { id: string; status: string };
}

function connectSocket(
  options: {
    accessToken?: string;
    origin?: string;
    cookie?: string;
    csrfToken?: string;
  } = {},
): ClientSocket {
  const socket = createSocket(realtimeUrl, {
    auth: {
      ...(options.accessToken ? { accessToken: options.accessToken } : {}),
      ...(options.csrfToken ? { csrfToken: options.csrfToken } : {}),
    },
    ...(options.cookie ? { extraHeaders: { Cookie: options.cookie } } : {}),
    ...(options.origin
      ? {
          extraHeaders: {
            ...(options.cookie ? { Cookie: options.cookie } : {}),
            Origin: options.origin,
          },
        }
      : {}),
    transports: ['websocket'],
    reconnection: false,
    timeout: 3000,
  });
  sockets.add(socket);
  socket.once('disconnect', () => sockets.delete(socket));
  return socket;
}

async function waitForConnection(socket: ClientSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

async function waitForRejectedConnection(socket: ClientSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once('connect_error', resolve);
    socket.once('connect', () => reject(new Error('Socket connection unexpectedly succeeded.')));
    setTimeout(() => reject(new Error('Socket connection rejection timed out.')), 5000).unref();
  });
  socket.disconnect();
}

async function subscribe(socket: ClientSocket, familyId: string) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    socket.emit(
      'location:subscribe',
      { familyId },
      (acknowledgement: { ok: boolean; error?: string }) => resolve(acknowledgement),
    );
    setTimeout(() => resolve({ ok: false, error: 'ACK_TIMEOUT' }), 5000).unref();
  });
}

async function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}.`)), 5000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function expectNoEvent(socket: ClientSocket, event: string, durationMs = 150) {
  await new Promise<void>((resolve, reject) => {
    const listener = () => {
      clearTimeout(timer);
      reject(new Error(`Unexpected ${event} event.`));
    };
    const timer = setTimeout(() => {
      socket.off(event, listener);
      resolve();
    }, durationMs);
    socket.once(event, listener);
  });
}

beforeAll(async () => {
  realtime = createRealtimeServer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  realtimeUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  for (const socket of sockets) socket.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await getDatabase().transaction(async (tx) => {
    await tx.delete(consents);
    await tx.delete(families);
    await tx.delete(users);
  });
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await realtime.close();
});

describe('authenticated realtime location notifications', () => {
  it('serializes family subscription racing membership removal on independent transactions', async () => {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const owner = await createVerifiedUser();
      const member = await createVerifiedUser();
      const family = await createFamily(owner, `Socket Subscribe Race ${iteration}`);
      await inviteMember(owner, family.id, member);
      const session = await startSharing(owner, family.id);
      const memberSocket = connectSocket({ accessToken: member.accessToken });
      await waitForConnection(memberSocket);

      const lockClient = await getTestDatabase().connect();
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT id FROM families WHERE id = $1 FOR UPDATE', [family.id]);
      try {
        const subscriptionPromise = subscribe(memberSocket, family.id);
        await waitForLockWaiters('families', 1);
        const removalPromise = owner.api
          .delete(`/api/families/${family.id}/members/${member.id}`)
          .then((response) => response);
        await waitForLockWaiters('families', 2);
        await lockClient.query('COMMIT');

        expect(await subscriptionPromise).toEqual({ ok: true });
        expect((await removalPromise).status).toBe(200);
        await member.api.get(`/api/families/${family.id}/locations`).expect(404);
        expect(await subscribe(memberSocket, family.id)).toMatchObject({ ok: false });

        await owner.api
          .put(`/api/families/${family.id}/location-sharing/sessions/${session.id}/position`)
          .send({
            latitude: 37.421999,
            longitude: -122.084057,
            accuracyMeters: 12.34,
            sequence: 1,
            clientRecordedAt: new Date().toISOString(),
          })
          .expect(200);
        await expectNoEvent(memberSocket, 'location:changed');
      } finally {
        await lockClient.query('ROLLBACK');
        lockClient.release();
      }
    }
  });

  it('suppresses queued socket delivery when consent revocation wins the lock race', async () => {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const owner = await createVerifiedUser();
      const viewer = await createVerifiedUser();
      const family = await createFamily(owner, `Socket Consent Race ${iteration}`);
      await inviteMember(owner, family.id, viewer);
      const session = await startSharing(owner, family.id);
      await owner.api
        .put(`/api/families/${family.id}/location-sharing/sessions/${session.id}/position`)
        .send({
          latitude: 37.421999,
          longitude: -122.084057,
          accuracyMeters: 12.34,
          sequence: 1,
          clientRecordedAt: new Date().toISOString(),
        })
        .expect(200);
      const viewerSocket = connectSocket({ accessToken: viewer.accessToken });
      await waitForConnection(viewerSocket);
      expect(await subscribe(viewerSocket, family.id)).toEqual({ ok: true });

      const lockClient = await getTestDatabase().connect();
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT id FROM families WHERE id = $1 FOR UPDATE', [family.id]);
      try {
        const revocationPromise = owner.api
          .delete(`/api/consents/location-sharing/${family.id}`)
          .then((response) => response);
        await waitForLockWaiters('families', 1);
        publishLocationChanged(family.id, owner.id);
        await waitForLockWaiters('families', 2);
        await lockClient.query('COMMIT');

        expect((await revocationPromise).status).toBe(200);
        await waitForNoLockWaiters('families');
        await expectNoEvent(viewerSocket, 'location:changed');
        expect(await getDatabase().select().from(locationPositions)).toHaveLength(0);
        await viewer.api
          .get(`/api/families/${family.id}/locations`)
          .expect(200)
          .expect((response) => expect(response.body.data.locations).toHaveLength(0));
        await owner.api
          .put(`/api/families/${family.id}/location-sharing/sessions/${session.id}/position`)
          .send({
            latitude: 37.421999,
            longitude: -122.084057,
            accuracyMeters: 12.34,
            sequence: 2,
            clientRecordedAt: new Date().toISOString(),
          })
          .expect(403);
      } finally {
        await lockClient.query('ROLLBACK');
        lockClient.release();
      }
    }
  });

  it('rejects unauthenticated, invalid, revoked-session, and invalid-Origin connections', async () => {
    await waitForRejectedConnection(connectSocket());
    await waitForRejectedConnection(connectSocket({ accessToken: 'invalid-token' }));

    const user = await createVerifiedUser();
    const expiredToken = await new SignJWT({ sid: user.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('famshield-api')
      .setAudience('famshield-client')
      .setSubject(user.id)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));
    await waitForRejectedConnection(connectSocket({ accessToken: expiredToken }));
    await waitForRejectedConnection(
      connectSocket({ accessToken: user.accessToken, origin: 'https://attacker.example' }),
    );
    const validSocket = connectSocket({ accessToken: user.accessToken });
    await waitForConnection(validSocket);
    validSocket.disconnect();

    await getDatabase()
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, user.id));
    await waitForRejectedConnection(connectSocket({ accessToken: user.accessToken }));
  });

  it('authorizes family rooms and emits metadata-only events to multiple devices', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const outsider = await createVerifiedUser();
    const family = await createFamily(owner, 'Realtime Access');
    const otherFamily = await createFamily(outsider, 'Other Family');
    await inviteMember(owner, family.id, member);
    const session = await startSharing(owner, family.id);

    const ownerSocket = connectSocket({ accessToken: owner.accessToken });
    const memberSocketOne = connectSocket({ accessToken: member.accessToken });
    const memberSocketTwo = connectSocket({ accessToken: member.accessToken });
    const outsiderSocket = connectSocket({ accessToken: outsider.accessToken });
    await Promise.all([
      waitForConnection(ownerSocket),
      waitForConnection(memberSocketOne),
      waitForConnection(memberSocketTwo),
      waitForConnection(outsiderSocket),
    ]);

    expect(await subscribe(ownerSocket, family.id)).toEqual({ ok: true });
    expect(await subscribe(memberSocketOne, family.id)).toEqual({ ok: true });
    expect(await subscribe(memberSocketTwo, family.id)).toEqual({ ok: true });
    expect(await subscribe(outsiderSocket, family.id)).toMatchObject({ ok: false });
    expect(await subscribe(memberSocketOne, otherFamily.id)).toMatchObject({ ok: false });

    const eventOne = waitForEvent<Record<string, unknown>>(memberSocketOne, 'location:changed');
    const eventTwo = waitForEvent<Record<string, unknown>>(memberSocketTwo, 'location:changed');
    await owner.api
      .put(`/api/families/${family.id}/location-sharing/sessions/${session.id}/position`)
      .send({
        latitude: 37.421999,
        longitude: -122.084057,
        accuracyMeters: 12.34,
        sequence: 1,
        clientRecordedAt: new Date().toISOString(),
      })
      .expect(200);
    const [payloadOne, payloadTwo] = await Promise.all([eventOne, eventTwo]);
    expect(payloadOne).toEqual(payloadTwo);
    expect(Object.keys(payloadOne).sort()).toEqual(
      ['familyId', 'eventId', 'revision', 'occurredAt'].sort(),
    );
    expect(payloadOne.familyId).toBe(family.id);
    expect(JSON.stringify(payloadOne)).not.toMatch(/latitude|longitude|coordinates/i);
    const storedPosition = await getDatabase()
      .select()
      .from(locationPositions)
      .where(
        and(eq(locationPositions.familyId, family.id), eq(locationPositions.userId, owner.id)),
      );
    expect(storedPosition).toHaveLength(1);
  });

  it('invalidates an active sharer after consent revocation and rejects subsequent writes', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = await createFamily(owner, 'Consent Revocation');
    await inviteMember(owner, family.id, member);
    const session = await startSharing(owner, family.id);

    const viewerSocket = connectSocket({ accessToken: member.accessToken });
    await waitForConnection(viewerSocket);
    expect(await subscribe(viewerSocket, family.id)).toEqual({ ok: true });
    const invalidated = waitForEvent<Record<string, unknown>>(viewerSocket, 'location:invalidated');
    await owner.api.delete(`/api/consents/location-sharing/${family.id}`).expect(200);
    const payload = await invalidated;
    expect(Object.keys(payload).sort()).toEqual(
      ['familyId', 'eventId', 'revision', 'occurredAt'].sort(),
    );
    await owner.api
      .put(`/api/families/${family.id}/location-sharing/sessions/${session.id}/position`)
      .send({
        latitude: 37.421999,
        longitude: -122.084057,
        accuracyMeters: 12.34,
        sequence: 1,
        clientRecordedAt: new Date().toISOString(),
      })
      .expect(403);
    const positions = await getDatabase()
      .select()
      .from(locationPositions)
      .where(eq(locationPositions.familyId, family.id));
    expect(positions).toHaveLength(0);

    const reconnectedSharer = connectSocket({ accessToken: owner.accessToken });
    await waitForConnection(reconnectedSharer);
    expect(await subscribe(reconnectedSharer, family.id)).toEqual({ ok: true });
    publishLocationChanged(family.id, owner.id);
    await expectNoEvent(reconnectedSharer, 'location:changed');
  });

  it('removes a removed member from the room and prevents renewed subscription', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = await createFamily(owner, 'Member Removal');
    await inviteMember(owner, family.id, member);
    const session = await startSharing(owner, family.id);
    const memberSession = await startSharing(member, family.id);

    const memberSocket = connectSocket({ accessToken: member.accessToken });
    await waitForConnection(memberSocket);
    expect(await subscribe(memberSocket, family.id)).toEqual({ ok: true });
    const membershipInvalidation = waitForEvent<Record<string, unknown>>(
      memberSocket,
      'location:invalidated',
    );
    await owner.api.delete(`/api/families/${family.id}/members/${member.id}`).expect(200);
    const invalidation = await membershipInvalidation;
    expect(Object.keys(invalidation).sort()).toEqual(
      ['familyId', 'eventId', 'revision', 'occurredAt'].sort(),
    );
    expect(await subscribe(memberSocket, family.id)).toMatchObject({ ok: false });
    const reconnectedMember = connectSocket({ accessToken: member.accessToken });
    await waitForConnection(reconnectedMember);
    expect(await subscribe(reconnectedMember, family.id)).toMatchObject({ ok: false });
    await member.api
      .put(`/api/families/${family.id}/location-sharing/sessions/${memberSession.id}/position`)
      .send({
        latitude: 37.421999,
        longitude: -122.084057,
        accuracyMeters: 12.34,
        sequence: 1,
        clientRecordedAt: new Date().toISOString(),
      })
      .expect(404);

    await expectNoEvent(memberSocket, 'location:changed');
    await owner.api
      .put(`/api/families/${family.id}/location-sharing/sessions/${session.id}/position`)
      .send({
        latitude: 37.421999,
        longitude: -122.084057,
        accuracyMeters: 12.34,
        sequence: 1,
        clientRecordedAt: new Date().toISOString(),
      })
      .expect(200);
    await expectNoEvent(memberSocket, 'location:changed');
  });

  it('suppresses change signals after a sharing session expires', async () => {
    const owner = await createVerifiedUser();
    const member = await createVerifiedUser();
    const family = await createFamily(owner, 'Session Expiry');
    await inviteMember(owner, family.id, member);
    const session = await startSharing(owner, family.id);
    const viewerSocket = connectSocket({ accessToken: member.accessToken });
    await waitForConnection(viewerSocket);
    expect(await subscribe(viewerSocket, family.id)).toEqual({ ok: true });

    await getDatabase()
      .update(locationSharingSessions)
      .set({
        startedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 1000),
      })
      .where(eq(locationSharingSessions.id, session.id));
    const invalidated = waitForEvent(viewerSocket, 'location:invalidated');
    await owner.api
      .put(`/api/families/${family.id}/location-sharing/sessions/${session.id}/position`)
      .send({
        latitude: 37.421999,
        longitude: -122.084057,
        accuracyMeters: 12.34,
        sequence: 1,
        clientRecordedAt: new Date().toISOString(),
      })
      .expect(409);
    await invalidated;
    publishLocationChanged(family.id, owner.id);
    await expectNoEvent(viewerSocket, 'location:changed');
  });

  it('disconnects sockets on single-session and logout-all revocation', async () => {
    const user = await createVerifiedUser();
    const sessionSocket = connectSocket({ accessToken: user.accessToken });
    await waitForConnection(sessionSocket);
    const revocationSignal = waitForEvent<{ reason: string }>(sessionSocket, 'session:revoked');
    const disconnect = new Promise<void>((resolve) =>
      sessionSocket.once('disconnect', () => resolve()),
    );
    await user.api.post('/api/auth/logout').send({ refreshToken: user.refreshToken }).expect(200);
    await expect(revocationSignal).resolves.toEqual({ reason: 'session_revoked' });
    await disconnect;

    const anotherUser = await createVerifiedUser();
    const anotherSocket = connectSocket({ accessToken: anotherUser.accessToken });
    await waitForConnection(anotherSocket);
    const disconnected = new Promise<void>((resolve) =>
      anotherSocket.once('disconnect', () => resolve()),
    );
    await anotherUser.api.post('/api/auth/logout-all').send().expect(200);
    await disconnected;
  });

  it('rejects cookie-authenticated sockets without matching Origin and CSRF proof', async () => {
    const user = await createVerifiedUser();
    const response = await request()
      .post('/api/auth/login')
      .send({
        identifier: user.email,
        password: 'Strong!Passphrase2026',
        clientType: 'web',
      })
      .expect(200);
    const cookies = (response.headers['set-cookie'] as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    const csrfToken = response.body.data.csrfToken as string;
    await waitForRejectedConnection(
      connectSocket({
        cookie: cookies,
        csrfToken: 'incorrect-csrf-token',
        origin: 'http://localhost:5173',
      }),
    );
    const socket = connectSocket({
      cookie: cookies,
      csrfToken,
      origin: 'http://localhost:5173',
    });
    await waitForConnection(socket);
  });
});
