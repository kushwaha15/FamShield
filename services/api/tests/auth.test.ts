import bcrypt from 'bcrypt';
import type { Express } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import supertest from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { getDatabase, getDatabaseStatus } from '../src/config/database.js';
import { consents, otpVerifications, refreshTokens, users } from '../src/db/schema.js';
import { purgeExpiredAuthRecords } from '../src/services/authService.js';
import { getTestDatabase } from './testDatabase.js';

const credentials = {
  fullName: 'Avery Example',
  email: 'avery@example.test',
  phone: '+14155550123',
  password: 'Strong!Passphrase2026',
  passwordConfirmation: 'Strong!Passphrase2026',
  acceptTerms: true,
  acceptPrivacy: true,
};

let requestIp = '192.0.2.10';
let requestNumber = 10;

function request(application: Express) {
  return {
    delete: (path: string) => supertest(application).delete(path).set('X-Forwarded-For', requestIp),
    get: (path: string) => supertest(application).get(path).set('X-Forwarded-For', requestIp),
    post: (path: string) => supertest(application).post(path).set('X-Forwarded-For', requestIp),
  };
}

async function registerAndVerify(overrides: Partial<typeof credentials> = {}) {
  const registration = { ...credentials, ...overrides };
  const response = await request(app).post('/api/auth/register').send(registration).expect(202);
  const developmentOtp = response.body.data.developmentOtp as { email: string; phone: string };
  await request(app)
    .post('/api/auth/verify-email')
    .send({ email: registration.email, code: developmentOtp.email })
    .expect(200);
  await request(app)
    .post('/api/auth/verify-phone')
    .send({ phone: registration.phone, code: developmentOtp.phone })
    .expect(200);
  return { registration, developmentOtp };
}

beforeEach(async () => {
  requestNumber += 1;
  requestIp = `192.0.2.${requestNumber}`;
  await getDatabase().transaction(async (tx) => {
    await tx.delete(refreshTokens);
    await tx.delete(otpVerifications);
    await tx.delete(consents);
    await tx.delete(users);
  });
});

describe('authentication API', () => {
  it('reports database readiness without exposing configuration', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.data).toMatchObject({
      status: 'ok',
      service: 'famshield-api',
      database: 'connected',
    });
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
  });

  it('issues a browser CSRF token and accepts an empty-body cookie logout', async () => {
    const csrf = await request(app).get('/api/auth/csrf').expect(200);
    expect(csrf.body.data.csrfToken).toBeTruthy();
    expect(csrf.headers['set-cookie'].join(';')).toContain('fs_csrf');
    const logout = await request(app).post('/api/auth/logout').expect(200);
    expect(logout.body.data.message).toBe('Session signed out.');
  });

  it('registers a pending user with a password hash and explicit terms consents', async () => {
    const response = await request(app).post('/api/auth/register').send(credentials);
    expect(response.status).toBe(202);
    const [user] = await getDatabase()
      .select()
      .from(users)
      .where(eq(users.email, credentials.email))
      .limit(1);

    expect(response.body.data.developmentOtp).toEqual({
      email: expect.stringMatching(/^\d{6}$/),
      phone: expect.stringMatching(/^\d{6}$/),
    });
    expect(user?.passwordHash).not.toBe(credentials.password);
    expect(await bcrypt.compare(credentials.password, user!.passwordHash)).toBe(true);
    expect(user?.status).toBe('pending_verification');
    const consentRows = await getDatabase()
      .select({ count: sql<number>`count(*)::int` })
      .from(consents)
      .where(and(eq(consents.userId, user!.id), eq(consents.granted, true)));
    expect(Number(consentRows[0]?.count)).toBe(2);
  });

  it('suppresses duplicate registration with the same generic accepted status', async () => {
    await request(app).post('/api/auth/register').send(credentials).expect(202);
    const duplicate = await request(app).post('/api/auth/register').send(credentials).expect(202);
    expect(duplicate.body.data.message).toMatch(/If the details are eligible/);
    const duplicates = await getDatabase()
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.email, credentials.email));
    expect(Number(duplicates[0]?.count)).toBe(1);
  });

  it('suppresses duplicate phone registration and enforces database uniqueness', async () => {
    await request(app).post('/api/auth/register').send(credentials).expect(202);
    await request(app)
      .post('/api/auth/register')
      .send({ ...credentials, email: 'different@example.test' })
      .expect(202);
    const rows = await getDatabase()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, credentials.phone));
    expect(rows).toHaveLength(1);
  });

  it('creates PostgreSQL uniqueness constraints and denies direct Supabase API-role access', async () => {
    await request(app).post('/api/auth/register').send(credentials).expect(202);
    const indexes = await getDatabase().execute(sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('users_email_unique', 'users_phone_unique', 'refresh_tokens_hash_unique')
    `);
    expect(indexes.rows).toHaveLength(3);
    expect(indexes.rows.every((index) => index.indexdef.includes('UNIQUE'))).toBe(true);

    const checks = await getDatabase().execute(sql`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'users'::regclass AND contype = 'c'
    `);
    expect(checks.rows.length).toBeGreaterThan(0);

    const tables = await getDatabase().execute(sql`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relname IN ('users', 'refresh_tokens', 'otp_verifications', 'consents')
        AND relkind = 'r'
    `);
    expect(tables.rows).toHaveLength(4);
    expect(tables.rows.every((table) => table.relrowsecurity === true)).toBe(true);

    const policies = await getDatabase().execute(sql`
      SELECT tablename FROM pg_policies
      WHERE schemaname = 'public' AND policyname LIKE '%backend_only'
    `);
    expect(policies.rows).toHaveLength(9);

    const roleClient = await getTestDatabase().connect();
    try {
      await roleClient.query('GRANT SELECT ON users TO anon');
      await roleClient.query('SET ROLE anon');
      const visibleUsers = await roleClient.query('SELECT id FROM users');
      expect(visibleUsers.rows).toHaveLength(0);
    } finally {
      await roleClient.query('RESET ROLE');
      roleClient.release();
    }
  });

  it('enforces case-insensitive email uniqueness inside PostgreSQL', async () => {
    await request(app).post('/api/auth/register').send(credentials).expect(202);
    await expect(
      getTestDatabase().query(
        'INSERT INTO users (full_name, email, phone, password_hash) VALUES ($1, $2, $3, $4)',
        [
          'Another Example',
          credentials.email.toUpperCase(),
          '+14155550124',
          'not-a-real-password-hash',
        ],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it.each([
    [{ ...credentials, email: 'not-an-email' }],
    [{ ...credentials, phone: '5550100' }],
    [{ ...credentials, acceptPrivacy: false }],
    [{ ...credentials, password: 'weak', passwordConfirmation: 'weak' }],
  ])('rejects invalid registration fields', async (body) => {
    await request(app).post('/api/auth/register').send(body).expect(400);
    expect(await getDatabase().select({ id: users.id }).from(users)).toHaveLength(0);
  });

  it('requires valid, unexpired OTPs and only activates after both channels verify', async () => {
    const response = await request(app).post('/api/auth/register').send(credentials).expect(202);
    const codes = response.body.data.developmentOtp as { email: string; phone: string };

    const incorrectCode = codes.email === '000000' ? '000001' : '000000';
    await request(app)
      .post('/api/auth/verify-email')
      .send({ email: credentials.email, code: incorrectCode })
      .expect(400);
    let [user] = await getDatabase()
      .select()
      .from(users)
      .where(eq(users.email, credentials.email))
      .limit(1);
    expect(user?.emailVerified).toBe(false);

    await request(app)
      .post('/api/auth/verify-email')
      .send({ email: credentials.email, code: codes.email })
      .expect(200);
    [user] = await getDatabase()
      .select()
      .from(users)
      .where(eq(users.email, credentials.email))
      .limit(1);
    expect(user?.status).toBe('pending_verification');

    await request(app)
      .post('/api/auth/verify-phone')
      .send({ phone: credentials.phone, code: codes.phone })
      .expect(200);
    [user] = await getDatabase()
      .select()
      .from(users)
      .where(eq(users.email, credentials.email))
      .limit(1);
    expect(user?.status).toBe('active');
  });

  it('rejects expired OTPs and locks after five invalid attempts', async () => {
    const response = await request(app).post('/api/auth/register').send(credentials).expect(202);
    const emailCode = response.body.data.developmentOtp.email as string;
    await getDatabase()
      .update(otpVerifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(otpVerifications.purpose, 'verify_email'));
    await request(app)
      .post('/api/auth/verify-email')
      .send({ email: credentials.email, code: emailCode })
      .expect(400);

    const fresh = await request(app)
      .post('/api/auth/register')
      .send({ ...credentials, email: 'second@example.test', phone: '+14155550124' })
      .expect(202);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post('/api/auth/verify-email')
        .send({
          email: 'second@example.test',
          code: fresh.body.data.developmentOtp.email === '000000' ? '000001' : '000000',
        })
        .expect(400);
    }
    await request(app)
      .post('/api/auth/verify-email')
      .send({ email: 'second@example.test', code: fresh.body.data.developmentOtp.email })
      .expect(400);
    const [secondUser] = await getDatabase()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'second@example.test'))
      .limit(1);
    const [locked] = await getDatabase()
      .select()
      .from(otpVerifications)
      .where(
        and(
          eq(otpVerifications.userId, secondUser!.id),
          eq(otpVerifications.purpose, 'verify_email'),
        ),
      )
      .limit(1);
    expect(locked?.status).toBe('locked');
  });

  it('requires active account verification, then logs in and returns an access token', async () => {
    const registration = await request(app)
      .post('/api/auth/register')
      .send(credentials)
      .expect(202);
    await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: credentials.password })
      .expect(401);

    const codes = registration.body.data.developmentOtp as { email: string; phone: string };
    await request(app)
      .post('/api/auth/verify-email')
      .send({ email: credentials.email, code: codes.email })
      .expect(200);
    await request(app)
      .post('/api/auth/verify-phone')
      .send({ phone: credentials.phone, code: codes.phone })
      .expect(200);
    const login = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: credentials.phone,
        password: credentials.password,
        clientType: 'mobile',
      })
      .expect(200);
    expect(login.body.data.accessToken).toBeTruthy();
    expect(login.body.data.refreshToken).toBeTruthy();
    expect(login.body.data.user.passwordHash).toBeUndefined();
  });

  it('returns indistinguishable errors for unknown users and wrong passwords', async () => {
    await registerAndVerify();
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: 'Wrong!Passphrase2026' })
      .expect(401);
    const unknownUser = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'unknown@example.test', password: 'Wrong!Passphrase2026' })
      .expect(401);
    expect(wrongPassword.body.error).toEqual(unknownUser.body.error);
  });

  it('protects the profile endpoint and restricts access to the authenticated user', async () => {
    await request(app).get('/api/users/me').expect(401);
    await registerAndVerify();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: credentials.password })
      .expect(200);
    const profile = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
    expect(profile.body.data.user.email).toBe(credentials.email);
    expect(profile.body.data.user.passwordHash).toBeUndefined();
  });

  it('rotates refresh tokens and revokes a session when a rotated token is replayed', async () => {
    await registerAndVerify();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: credentials.password })
      .expect(200);
    const first = login.body.data.refreshToken as string;
    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first })
      .expect(200);
    const next = refreshed.body.data.refreshToken as string;

    await request(app).post('/api/auth/refresh').send({ refreshToken: first }).expect(401);
    await request(app).post('/api/auth/refresh').send({ refreshToken: next }).expect(401);
    const activeTokens = await getDatabase()
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(isNull(refreshTokens.revokedAt));
    expect(activeTokens).toHaveLength(0);
  });

  it('purges expired authentication records and invalidates their sessions', async () => {
    await registerAndVerify();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: credentials.password })
      .expect(200);
    await getDatabase()
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.sessionId, login.body.data.sessionId));

    await purgeExpiredAuthRecords();
    const remaining = await getDatabase()
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(eq(refreshTokens.sessionId, login.body.data.sessionId));
    expect(remaining).toHaveLength(0);
    await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(401);
  });

  it('sets secure HttpOnly cookie authentication for web without returning bearer tokens', async () => {
    await registerAndVerify();
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: credentials.email,
        password: credentials.password,
        clientType: 'web',
      })
      .expect(200);
    expect(response.body.data.accessToken).toBeUndefined();
    expect(response.headers['set-cookie'].join(';')).toContain('HttpOnly');
    expect(response.body.data.csrfToken).toBeTruthy();
  });

  it('requires a CSRF header for browser-cookie mutations and permits a valid token', async () => {
    await registerAndVerify();
    const agent = supertest.agent(app);
    const login = await agent
      .post('/api/auth/login')
      .set('X-Forwarded-For', requestIp)
      .send({
        identifier: credentials.email,
        password: credentials.password,
        clientType: 'web',
      })
      .expect(200);

    await agent
      .patch('/api/users/me')
      .set('X-Forwarded-For', requestIp)
      .send({ fullName: 'Updated Name' })
      .expect(403);
    const updated = await agent
      .patch('/api/users/me')
      .set('X-Forwarded-For', requestIp)
      .set('X-CSRF-Token', login.body.data.csrfToken)
      .send({ fullName: 'Updated Name' })
      .expect(200);
    expect(updated.body.data.user.fullName).toBe('Updated Name');
  });

  it('lists sessions, revokes one session, and logs out all remaining sessions', async () => {
    await registerAndVerify();
    const loginOne = await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: credentials.password })
      .expect(200);
    const loginTwo = await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: credentials.password })
      .expect(200);
    const sessions = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${loginOne.body.data.accessToken}`)
      .expect(200);
    expect(sessions.body.data.sessions).toHaveLength(2);

    await request(app)
      .delete(`/api/auth/sessions/${loginOne.body.data.sessionId}`)
      .set('Authorization', `Bearer ${loginOne.body.data.accessToken}`)
      .expect(200);
    await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${loginOne.body.data.accessToken}`)
      .expect(401);

    await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${loginTwo.body.data.accessToken}`)
      .expect(200);
    await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${loginTwo.body.data.accessToken}`)
      .expect(401);
  });

  it('deletes only the authenticated user account after password confirmation', async () => {
    await registerAndVerify();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: credentials.password })
      .expect(200);
    await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ password: 'incorrect' })
      .expect(401);
    await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ password: credentials.password })
      .expect(200);
    expect(await getDatabase().select({ id: users.id }).from(users)).toHaveLength(0);
    expect(await getDatabase().select({ id: consents.id }).from(consents)).toHaveLength(0);
  });

  it('resets the password and revokes existing sessions', async () => {
    await registerAndVerify();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: credentials.password })
      .expect(200);
    const reset = await request(app)
      .post('/api/auth/forgot-password')
      .send({ identifier: credentials.email, channel: 'email' })
      .expect(202);
    const code = reset.body.data.developmentOtp as string;
    await request(app)
      .post('/api/auth/reset-password')
      .send({
        identifier: credentials.email,
        code,
        password: 'Another!Passphrase2026',
        passwordConfirmation: 'Another!Passphrase2026',
      })
      .expect(200);
    await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: credentials.password })
      .expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ identifier: credentials.email, password: 'Another!Passphrase2026' })
      .expect(200);
  });

  it('enforces route rate limits with a consistent error response', async () => {
    let finalResponse;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      finalResponse = await request(app).post('/api/auth/register').send({});
    }
    expect(finalResponse?.status).toBe(429);
    expect(finalResponse?.body.error.code).toBe('RATE_LIMITED');
  });
});

afterEach(async () => {
  expect(getDatabaseStatus()).toBe('connected');
});
