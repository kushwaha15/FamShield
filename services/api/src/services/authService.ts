import bcrypt from 'bcrypt';
import { createHmac, randomBytes, randomInt, timingSafeEqual, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, gte, isNull, lt, sql } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response } from 'express';
import { getDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { consents, otpVerifications, refreshTokens, users } from '../db/schema.js';
import type { RegistrationInput } from '../validators/auth.js';
import { ApiError } from '../utils/ApiError.js';
import { auditSecurityEvent } from '../utils/audit.js';
import { otpDelivery } from './otpDelivery.js';

const otpMaxAttempts = 5;
const otpCooldownMs = 60_000;
const otpWindowMs = 15 * 60_000;
const otpMaxSendsPerWindow = 3;
const accessTokenLifetimeSeconds = 15 * 60;
const refreshTokenLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const jwtSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const dummyPasswordHashPromise = bcrypt.hash(randomBytes(32).toString('hex'), env.BCRYPT_ROUNDS);

export type OtpPurpose = 'verify_email' | 'verify_phone' | 'reset_password';
export type ClientType = 'web' | 'mobile';

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export interface PublicUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  status: string;
  profileImageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

type UserRow = typeof users.$inferSelect;
type PublicUserRow = Pick<
  UserRow,
  | 'id'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'emailVerified'
  | 'phoneVerified'
  | 'status'
  | 'profileImageUrl'
  | 'createdAt'
  | 'updatedAt'
>;

const publicUserSelection = {
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  phone: users.phone,
  emailVerified: users.emailVerified,
  phoneVerified: users.phoneVerified,
  status: users.status,
  profileImageUrl: users.profileImageUrl,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

function hashOpaqueToken(token: string): string {
  return createHmac('sha256', env.AUTH_TOKEN_PEPPER).update(token).digest('hex');
}

function hashOtp(userId: string, purpose: OtpPurpose, code: string): string {
  return createHmac('sha256', env.AUTH_TOKEN_PEPPER)
    .update(`${userId}:${purpose}:${code}`)
    .digest('hex');
}

function codesMatch(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  while (typeof current === 'object' && current !== null) {
    if ('code' in current && current.code === '23505') {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

export function toPublicUser(user: PublicUserRow): PublicUser {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    status: user.status,
    ...(user.profileImageUrl ? { profileImageUrl: user.profileImageUrl } : {}),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

async function findUser(identifier: string): Promise<PublicUserRow | undefined> {
  const predicate = identifier.includes('@')
    ? eq(users.email, identifier)
    : eq(users.phone, identifier);
  const [user] = await getDatabase()
    .select(publicUserSelection)
    .from(users)
    .where(predicate)
    .limit(1);
  return user;
}

async function findUserById(userId: string): Promise<PublicUserRow | undefined> {
  const [user] = await getDatabase()
    .select(publicUserSelection)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user;
}

async function userExists(identifier: string): Promise<boolean> {
  const predicate = identifier.includes('@')
    ? eq(users.email, identifier)
    : eq(users.phone, identifier);
  const [user] = await getDatabase().select({ id: users.id }).from(users).where(predicate).limit(1);
  return Boolean(user);
}

export async function registerUser(
  input: RegistrationInput,
  req: Request,
): Promise<{ developmentOtp?: { email: string; phone: string } }> {
  const existingEmail = await userExists(input.email);
  const existingPhone = await userExists(input.phone);
  if (existingEmail || existingPhone) {
    auditSecurityEvent('registration_duplicate_suppressed', req);
    return {};
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const userId = randomUUID();
  let user: PublicUserRow;
  try {
    user = await getDatabase().transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(users)
        .values({
          id: userId,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          passwordHash,
        })
        .returning(publicUserSelection);
      if (!createdUser) {
        throw new Error('PostgreSQL did not return the inserted user.');
      }
      await tx.insert(consents).values([
        {
          userId,
          consentType: 'terms_of_service',
          granted: true,
          grantedAt: new Date(),
          version: '1',
        },
        {
          userId,
          consentType: 'privacy_policy',
          granted: true,
          grantedAt: new Date(),
          version: '1',
        },
      ]);
      return createdUser;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      auditSecurityEvent('registration_duplicate_suppressed', req);
      return {};
    }
    throw error;
  }

  let emailCode: string;
  let phoneCode: string;
  try {
    emailCode = await issueOtp(user.id, 'verify_email', input.email);
    phoneCode = await issueOtp(user.id, 'verify_phone', input.phone);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 503) {
      auditSecurityEvent('registration_verification_delivery_failed', req, user.id);
      return {};
    }
    throw error;
  }
  auditSecurityEvent('registration_created', req, user.id);

  return env.AUTH_DEV_OTP_EXPOSE ? { developmentOtp: { email: emailCode, phone: phoneCode } } : {};
}

async function issueOtp(userId: string, purpose: OtpPurpose, destination: string): Promise<string> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - otpWindowMs);
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

  await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${purpose}`}))`);
    await tx.delete(otpVerifications).where(lt(otpVerifications.purgeAt, now));
    const recent = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(otpVerifications)
      .where(
        and(
          eq(otpVerifications.userId, userId),
          eq(otpVerifications.purpose, purpose),
          gte(otpVerifications.createdAt, cutoff),
        ),
      );
    const [latest] = await tx
      .select({ createdAt: otpVerifications.createdAt })
      .from(otpVerifications)
      .where(and(eq(otpVerifications.userId, userId), eq(otpVerifications.purpose, purpose)))
      .orderBy(desc(otpVerifications.createdAt))
      .limit(1);

    if (
      Number(recent[0]?.count ?? 0) >= otpMaxSendsPerWindow ||
      (latest && now.getTime() - latest.createdAt.getTime() < otpCooldownMs)
    ) {
      throw new ApiError(429, 'OTP_RATE_LIMITED', 'Please wait before requesting another code.');
    }

    await tx
      .update(otpVerifications)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(otpVerifications.userId, userId),
          eq(otpVerifications.purpose, purpose),
          eq(otpVerifications.status, 'pending'),
        ),
      );

    await tx.insert(otpVerifications).values({
      userId,
      purpose,
      otpHash: hashOtp(userId, purpose, code),
      expiresAt: new Date(now.getTime() + env.OTP_TTL_MINUTES * 60_000),
      purgeAt: new Date(now.getTime() + 24 * 60 * 60_000),
    });
  });

  if (purpose === 'verify_phone' || (purpose === 'reset_password' && destination.startsWith('+'))) {
    await otpDelivery.sendSms(destination, code, purpose);
  } else {
    await otpDelivery.sendEmail(destination, code, purpose);
  }

  return code;
}

export async function resendOtp(
  identifier: string,
  purpose: 'verify_email' | 'verify_phone',
): Promise<string | undefined> {
  const user = await findUser(identifier);
  if (!user || user.status !== 'pending_verification') {
    return undefined;
  }

  const isEmail = purpose === 'verify_email';
  const destination = isEmail ? user.email : user.phone;
  if ((isEmail && user.emailVerified) || (!isEmail && user.phoneVerified)) {
    return undefined;
  }

  try {
    return await issueOtp(user.id, purpose, destination);
  } catch (error) {
    if (error instanceof ApiError && (error.statusCode === 429 || error.statusCode === 503)) {
      return undefined;
    }
    throw error;
  }
}

async function consumeOtp(
  userId: string,
  purpose: OtpPurpose,
  code: string,
  req: Request,
): Promise<void> {
  const [record] = await getDatabase()
    .select()
    .from(otpVerifications)
    .where(
      and(
        eq(otpVerifications.userId, userId),
        eq(otpVerifications.purpose, purpose),
        eq(otpVerifications.status, 'pending'),
      ),
    )
    .orderBy(desc(otpVerifications.createdAt))
    .limit(1);

  if (!record) {
    auditSecurityEvent('otp_verification_failed', req, userId);
    throw new ApiError(400, 'INVALID_OR_EXPIRED_CODE', 'The code is invalid or expired.');
  }

  const invalidCode = () =>
    new ApiError(400, 'INVALID_OR_EXPIRED_CODE', 'The code is invalid or expired.');
  const now = new Date();
  if (record.expiresAt <= now) {
    await getDatabase()
      .update(otpVerifications)
      .set({ status: 'expired' })
      .where(and(eq(otpVerifications.id, record.id), eq(otpVerifications.status, 'pending')));
    auditSecurityEvent('otp_verification_failed', req, userId);
    throw invalidCode();
  }

  if (record.attemptCount >= otpMaxAttempts) {
    await getDatabase()
      .update(otpVerifications)
      .set({ status: 'locked' })
      .where(and(eq(otpVerifications.id, record.id), eq(otpVerifications.status, 'pending')));
    auditSecurityEvent('otp_verification_failed', req, userId);
    throw invalidCode();
  }

  const suppliedHash = hashOtp(userId, purpose, code);
  if (!codesMatch(record.otpHash, suppliedHash)) {
    await getDatabase()
      .update(otpVerifications)
      .set({
        attemptCount: sql`${otpVerifications.attemptCount} + 1`,
        status: sql`CASE WHEN ${otpVerifications.attemptCount} + 1 >= ${otpMaxAttempts} THEN 'locked' ELSE 'pending' END`,
      })
      .where(
        and(
          eq(otpVerifications.id, record.id),
          eq(otpVerifications.status, 'pending'),
          lt(otpVerifications.attemptCount, otpMaxAttempts),
        ),
      );
    auditSecurityEvent('otp_verification_failed', req, userId);
    throw invalidCode();
  }

  const consumed = await getDatabase()
    .update(otpVerifications)
    .set({ status: 'verified' })
    .where(
      and(
        eq(otpVerifications.id, record.id),
        eq(otpVerifications.status, 'pending'),
        gt(otpVerifications.expiresAt, now),
        lt(otpVerifications.attemptCount, otpMaxAttempts),
      ),
    )
    .returning({ id: otpVerifications.id });
  if (!consumed.length) {
    auditSecurityEvent('otp_verification_failed', req, userId);
    throw invalidCode();
  }
}

export async function verifyEmail(email: string, code: string, req: Request): Promise<void> {
  const user = await findUser(email);
  if (!user || user.emailVerified) {
    throw new ApiError(400, 'INVALID_OR_EXPIRED_CODE', 'The code is invalid or expired.');
  }
  await consumeOtp(user.id, 'verify_email', code, req);
  await getDatabase()
    .update(users)
    .set({
      emailVerified: true,
      status: sql`CASE WHEN ${users.phoneVerified} AND ${users.status} = 'pending_verification' THEN 'active' ELSE ${users.status} END`,
    })
    .where(eq(users.id, user.id));
  auditSecurityEvent('email_verified', req, user.id);
}

export async function verifyPhone(phone: string, code: string, req: Request): Promise<void> {
  const user = await findUser(phone);
  if (!user || user.phoneVerified) {
    throw new ApiError(400, 'INVALID_OR_EXPIRED_CODE', 'The code is invalid or expired.');
  }
  await consumeOtp(user.id, 'verify_phone', code, req);
  await getDatabase()
    .update(users)
    .set({
      phoneVerified: true,
      status: sql`CASE WHEN ${users.emailVerified} AND ${users.status} = 'pending_verification' THEN 'active' ELSE ${users.status} END`,
    })
    .where(eq(users.id, user.id));
  auditSecurityEvent('phone_verified', req, user.id);
}

async function createAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer('famshield-api')
    .setAudience('famshield-client')
    .setIssuedAt()
    .setExpirationTime(`${accessTokenLifetimeSeconds}s`)
    .sign(jwtSecret);
}

async function createRefreshToken(userId: string, sessionId: string, deviceInfo?: string) {
  const token = randomBytes(48).toString('base64url');
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + refreshTokenLifetimeMs);
  await getDatabase().insert(refreshTokens).values({
    userId,
    sessionId,
    tokenHash,
    expiresAt,
    deviceInfo,
  });
  return { token, tokenHash, expiresAt };
}

export async function login(
  identifier: string,
  password: string,
  deviceInfo: string | undefined,
  req: Request,
): Promise<{ user: PublicUser; tokens: AuthTokenPair }> {
  const [user] = await getDatabase()
    .select({ ...publicUserSelection, passwordHash: users.passwordHash })
    .from(users)
    .where(identifier.includes('@') ? eq(users.email, identifier) : eq(users.phone, identifier))
    .limit(1);
  const passwordHash = user ? user.passwordHash : await dummyPasswordHashPromise;
  const validPassword = await bcrypt.compare(password, passwordHash);

  if (!user || !validPassword || user.status !== 'active') {
    auditSecurityEvent('login_failed', req, user?.id);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email, phone, or password is incorrect.');
  }

  if (!user.emailVerified || !user.phoneVerified) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email, phone, or password is incorrect.');
  }

  const sessionId = randomUUID();
  const refresh = await createRefreshToken(user.id, sessionId, deviceInfo);
  const accessToken = await createAccessToken(user.id, sessionId);
  auditSecurityEvent('login_succeeded', req, user.id);
  return {
    user: toPublicUser(user),
    tokens: { accessToken, refreshToken: refresh.token, sessionId },
  };
}

export async function rotateRefreshToken(
  token: string,
  req: Request,
): Promise<{ user: PublicUser; tokens: AuthTokenPair }> {
  const tokenHash = hashOpaqueToken(token);
  const [current] = await getDatabase()
    .select({
      id: refreshTokens.id,
      userId: refreshTokens.userId,
      sessionId: refreshTokens.sessionId,
      expiresAt: refreshTokens.expiresAt,
      revokedAt: refreshTokens.revokedAt,
      deviceInfo: refreshTokens.deviceInfo,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  if (!current) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'The session is invalid or expired.');
  }

  const now = new Date();
  if (current.revokedAt) {
    await revokeSessionTokens(current.userId, current.sessionId, now);
    auditSecurityEvent('refresh_token_reuse_detected', req, current.userId);
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'The session is invalid or expired.');
  }
  if (current.expiresAt <= now) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'The session is invalid or expired.');
  }

  const user = await findUserById(current.userId);
  if (!user || user.status !== 'active' || !user.emailVerified || !user.phoneVerified) {
    await revokeSessionTokens(current.userId, current.sessionId, now);
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'The session is invalid or expired.');
  }

  const nextToken = randomBytes(48).toString('base64url');
  const nextHash = hashOpaqueToken(nextToken);
  const expiresAt = new Date(Date.now() + refreshTokenLifetimeMs);
  const rotated = await getDatabase().transaction(async (tx) => {
    const claimed = await tx
      .update(refreshTokens)
      .set({ revokedAt: now, replacedByTokenHash: nextHash })
      .where(
        and(
          eq(refreshTokens.id, current.id),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ),
      )
      .returning({ id: refreshTokens.id });
    if (!claimed.length) {
      return false;
    }
    await tx.insert(refreshTokens).values({
      userId: current.userId,
      sessionId: current.sessionId,
      tokenHash: nextHash,
      expiresAt,
      deviceInfo: current.deviceInfo,
    });
    return true;
  });

  if (!rotated) {
    await revokeSessionTokens(current.userId, current.sessionId, now);
    auditSecurityEvent('refresh_token_reuse_detected', req, current.userId);
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'The session is invalid or expired.');
  }

  const accessToken = await createAccessToken(user.id, current.sessionId);
  auditSecurityEvent('refresh_token_rotated', req, user.id);
  return {
    user: toPublicUser(user),
    tokens: { accessToken, refreshToken: nextToken, sessionId: current.sessionId },
  };
}

async function revokeSessionTokens(userId: string, sessionId: string, revokedAt: Date) {
  await getDatabase()
    .update(refreshTokens)
    .set({ revokedAt })
    .where(
      and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.sessionId, sessionId),
        isNull(refreshTokens.revokedAt),
      ),
    );
}

export async function authenticateAccessToken(token: string): Promise<{
  userId: string;
  sessionId: string;
}> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwtSecret, {
      issuer: 'famshield-api',
      audience: 'famshield-client',
      algorithms: ['HS256'],
    }));
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  const [activeSession] = await getDatabase()
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, payload.sub),
        eq(refreshTokens.sessionId, payload.sid),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const [activeUser] = await getDatabase()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, payload.sub), eq(users.status, 'active')))
    .limit(1);
  if (!activeSession || !activeUser) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  return { userId: payload.sub, sessionId: payload.sid };
}

export async function revokeRefreshToken(token: string | undefined, req: Request): Promise<void> {
  if (!token) {
    return;
  }
  const [revoked] = await getDatabase()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(refreshTokens.tokenHash, hashOpaqueToken(token)), isNull(refreshTokens.revokedAt)),
    )
    .returning({ userId: refreshTokens.userId });
  if (revoked) {
    auditSecurityEvent('logout', req, revoked.userId);
  }
}

export async function revokeAllSessions(userId: string, req: Request): Promise<void> {
  await getDatabase()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  auditSecurityEvent('logout_all', req, userId);
}

export async function purgeExpiredAuthRecords(): Promise<void> {
  const now = new Date();
  await getDatabase().delete(refreshTokens).where(lt(refreshTokens.expiresAt, now));
  await getDatabase().delete(otpVerifications).where(lt(otpVerifications.purgeAt, now));
}

export async function listSessions(
  userId: string,
): Promise<
  Array<{ sessionId: string; deviceInfo?: string; createdAt: string; expiresAt: string }>
> {
  const tokens = await getDatabase()
    .select({
      sessionId: refreshTokens.sessionId,
      deviceInfo: refreshTokens.deviceInfo,
      createdAt: refreshTokens.createdAt,
      expiresAt: refreshTokens.expiresAt,
    })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(refreshTokens.createdAt));
  const sessions = new Map<string, (typeof tokens)[number]>();
  for (const token of tokens) {
    if (!sessions.has(token.sessionId)) {
      sessions.set(token.sessionId, token);
    }
  }

  return [...sessions.values()].map((session) => ({
    sessionId: session.sessionId,
    ...(session.deviceInfo ? { deviceInfo: session.deviceInfo } : {}),
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  }));
}

export async function revokeSession(
  userId: string,
  sessionId: string,
  req: Request,
): Promise<void> {
  const revoked = await getDatabase()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.sessionId, sessionId),
        isNull(refreshTokens.revokedAt),
      ),
    )
    .returning({ id: refreshTokens.id });
  if (!revoked.length) {
    throw new ApiError(404, 'SESSION_NOT_FOUND', 'The requested session was not found.');
  }
  auditSecurityEvent('session_revoked', req, userId);
}

export async function startPasswordReset(
  identifier: string,
  channel: 'email' | 'phone',
  req: Request,
): Promise<string | undefined> {
  const user = await findUser(identifier);
  if (!user || user.status !== 'active') {
    return undefined;
  }
  const destination = channel === 'email' ? user.email : user.phone;
  if (
    (channel === 'email' && !user.emailVerified) ||
    (channel === 'phone' && !user.phoneVerified)
  ) {
    return undefined;
  }
  try {
    return await issueOtp(user.id, 'reset_password', destination);
  } catch (error) {
    if (error instanceof ApiError && (error.statusCode === 429 || error.statusCode === 503)) {
      auditSecurityEvent('password_reset_delivery_suppressed', req, user.id);
      return undefined;
    }
    throw error;
  }
}

export async function resetPassword(
  identifier: string,
  code: string,
  password: string,
  req: Request,
): Promise<void> {
  const user = await findUser(identifier);
  if (!user || user.status !== 'active') {
    throw new ApiError(400, 'INVALID_OR_EXPIRED_CODE', 'The code is invalid or expired.');
  }

  await consumeOtp(user.id, 'reset_password', code, req);
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  await getDatabase().transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
  });
  auditSecurityEvent('password_reset', req, user.id);
}

export async function updateProfile(
  userId: string,
  changes: { fullName?: string; profileImageUrl?: string | null },
): Promise<PublicUser> {
  const [user] = await getDatabase()
    .update(users)
    .set(changes)
    .where(eq(users.id, userId))
    .returning(publicUserSelection);
  if (!user) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'The account could not be found.');
  }
  return toPublicUser(user);
}

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await findUserById(userId);
  if (!user) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'The account could not be found.');
  }
  return toPublicUser(user);
}

export async function deleteAccount(userId: string, password: string, req: Request): Promise<void> {
  const [user] = await getDatabase()
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'The password is incorrect.');
  }

  await getDatabase().delete(users).where(eq(users.id, userId));
  auditSecurityEvent('account_deleted', req, userId);
}

export function createCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function csrfTokensMatch(cookieToken: string, headerToken: string): boolean {
  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  return cookieBuffer.length === headerBuffer.length && timingSafeEqual(cookieBuffer, headerBuffer);
}

export function shouldExposeDevelopmentOtp(): boolean {
  return env.NODE_ENV !== 'production' && env.AUTH_DEV_OTP_EXPOSE;
}

export function setAuthCookies(res: Response, tokens: AuthTokenPair, csrfToken: string): void {
  const secure = env.NODE_ENV === 'production';
  res.cookie('fs_access', tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api',
    maxAge: accessTokenLifetimeSeconds * 1000,
  });
  res.cookie('fs_refresh', tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: refreshTokenLifetimeMs,
  });
  res.cookie('fs_csrf', csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: refreshTokenLifetimeMs,
  });
}

export function clearAuthCookies(res: Response): void {
  const secure = env.NODE_ENV === 'production';
  res.clearCookie('fs_access', { httpOnly: true, secure, sameSite: 'strict', path: '/api' });
  res.clearCookie('fs_refresh', { httpOnly: true, secure, sameSite: 'strict', path: '/api/auth' });
  res.clearCookie('fs_csrf', { httpOnly: false, secure, sameSite: 'strict', path: '/' });
}

export function getRefreshTokenFromCookies(req: Request): string | undefined {
  return typeof req.cookies?.fs_refresh === 'string' ? req.cookies.fs_refresh : undefined;
}

export function getAccessTokenFromRequest(req: Request): string | undefined {
  const authorization = req.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }
  return typeof req.cookies?.fs_access === 'string' ? req.cookies.fs_access : undefined;
}
