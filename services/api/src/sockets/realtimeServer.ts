import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { corsOrigins } from '../config/env.js';
import { getDatabase } from '../config/database.js';
import { authenticateAccessToken, csrfTokensMatch } from '../services/authService.js';
import { LOCATION_SHARING_POLICY_VERSION } from '../services/consentService.js';
import {
  consents,
  families,
  familyMembers,
  locationSharingSessions,
  refreshTokens,
  users,
} from '../db/schema.js';
import { locationNotifications, type LocationSignal } from './locationNotifications.js';

const SOCKET_PING_INTERVAL_MS = 25_000;
const SOCKET_PING_TIMEOUT_MS = 20_000;
const SOCKET_REVALIDATION_INTERVAL_MS = 15_000;
const SOCKET_MAX_CONNECTIONS_PER_ADDRESS = 10;
const SOCKET_MAX_CONNECTIONS = 5_000;

interface SocketData {
  userId: string;
  sessionId: string;
  accessToken: string;
  familyIds: Set<string>;
}

interface ClientToServerEvents {
  'location:subscribe': (
    payload: unknown,
    acknowledge?: (result: SocketAcknowledgement) => void,
  ) => void;
  'location:unsubscribe': (
    payload: unknown,
    acknowledge?: (result: SocketAcknowledgement) => void,
  ) => void;
}

interface ServerToClientEvents {
  'location:changed': (payload: LocationSignal) => void;
  'location:invalidated': (payload: LocationSignal) => void;
  'session:revoked': (payload: { reason: 'session_revoked' }) => void;
}

interface SocketAcknowledgement {
  ok: boolean;
  error?: 'UNAUTHORIZED' | 'FAMILY_UNAVAILABLE' | 'INVALID_REQUEST';
}

type LocationSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

const familyIdSchema = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cookieValue(cookieHeader: string | undefined, cookieName: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== cookieName) continue;
    const value = entry.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

function familyRoom(familyId: string): string {
  return `famshield:family:${familyId}:locations`;
}

function rejectSocket(next: (error?: Error) => void): void {
  next(new Error('Authentication is required.'));
}

async function validateSocketIdentity(socket: LocationSocket): Promise<boolean> {
  const identity = socket.data;
  try {
    const auth = await authenticateAccessToken(identity.accessToken);
    return auth.userId === identity.userId && auth.sessionId === identity.sessionId;
  } catch {
    return false;
  }
}

export function createRealtimeServer(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(
    httpServer,
    {
      cors: {
        origin: corsOrigins,
        credentials: true,
        methods: ['GET', 'POST'],
      },
      pingInterval: SOCKET_PING_INTERVAL_MS,
      pingTimeout: SOCKET_PING_TIMEOUT_MS,
      maxHttpBufferSize: 16 * 1024,
      perMessageDeflate: false,
    },
  );
  const activeConnectionsByAddress = new Map<string, number>();
  let activeConnections = 0;

  io.use(async (socket, next) => {
    const origin = socket.handshake.headers.origin;
    if (origin && !corsOrigins.includes(origin)) {
      rejectSocket(next);
      return;
    }

    const authToken = socket.handshake.auth.accessToken;
    const cookieHeader = socket.request.headers.cookie;
    const cookieToken = cookieValue(cookieHeader, 'fs_access');
    const cookieAuthenticated = typeof authToken !== 'string';
    const accessToken = cookieAuthenticated
      ? cookieToken
      : typeof authToken === 'string'
        ? authToken
        : undefined;
    if (!accessToken || accessToken.length > 4096) {
      rejectSocket(next);
      return;
    }

    const csrfCookie = cookieAuthenticated ? cookieValue(cookieHeader, 'fs_csrf') : undefined;
    const csrfToken = socket.handshake.auth.csrfToken;
    if (
      cookieAuthenticated &&
      (!origin ||
        typeof csrfCookie !== 'string' ||
        typeof csrfToken !== 'string' ||
        !csrfTokensMatch(csrfCookie, csrfToken))
    ) {
      rejectSocket(next);
      return;
    }

    try {
      const identity = await authenticateAccessToken(accessToken);
      socket.data = {
        ...identity,
        accessToken,
        familyIds: new Set<string>(),
      };
      next();
    } catch {
      rejectSocket(next);
    }
  });

  io.on('connection', (socket) => {
    const peerAddress = socket.handshake.address;
    const activeCount = activeConnectionsByAddress.get(peerAddress) ?? 0;
    if (
      activeCount >= SOCKET_MAX_CONNECTIONS_PER_ADDRESS ||
      activeConnections >= SOCKET_MAX_CONNECTIONS
    ) {
      socket.disconnect(true);
      return;
    }
    activeConnectionsByAddress.set(peerAddress, activeCount + 1);
    activeConnections += 1;

    const revalidationTimer = setInterval(() => {
      void revalidateSocket(socket).catch(() => socket.disconnect(true));
    }, SOCKET_REVALIDATION_INTERVAL_MS);
    revalidationTimer.unref();

    socket.on('location:subscribe', (payload, acknowledge) => {
      void handleSubscribe(socket, payload)
        .then((result) => acknowledge?.(result))
        .catch(() => acknowledge?.({ ok: false, error: 'UNAUTHORIZED' }));
    });

    socket.on('location:unsubscribe', (payload, acknowledge) => {
      const familyId = readFamilyId(payload);
      if (!familyId) {
        acknowledge?.({ ok: false, error: 'INVALID_REQUEST' });
        return;
      }
      void socket.leave(familyRoom(familyId));
      socket.data.familyIds.delete(familyId);
      acknowledge?.({ ok: true });
    });

    socket.on('disconnect', () => {
      clearInterval(revalidationTimer);
      const remaining = (activeConnectionsByAddress.get(peerAddress) ?? 1) - 1;
      activeConnections -= 1;
      if (remaining <= 0) activeConnectionsByAddress.delete(peerAddress);
      else activeConnectionsByAddress.set(peerAddress, remaining);
    });
  });

  const sendFamilySignal = async (
    signal: LocationSignal,
    event: 'location:changed' | 'location:invalidated',
    sharerUserId?: string,
  ) => {
    const sockets = await io.in(familyRoom(signal.familyId)).fetchSockets();
    await Promise.all(
      sockets.map(async (socket) => {
        const typedSocket = socket as unknown as LocationSocket;
        if (!(await validateSocketIdentity(typedSocket))) {
          typedSocket.disconnect(true);
          return;
        }
        const delivery = await getDatabase().transaction(async (tx) => {
          const now = new Date();
          const [activeSession] = await tx
            .select({ id: refreshTokens.id })
            .from(refreshTokens)
            .where(
              and(
                eq(refreshTokens.userId, typedSocket.data.userId),
                eq(refreshTokens.sessionId, typedSocket.data.sessionId),
                isNull(refreshTokens.revokedAt),
                gt(refreshTokens.expiresAt, now),
              ),
            )
            .for('share')
            .limit(1);
          const [activeUser] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, typedSocket.data.userId), eq(users.status, 'active')))
            .for('share')
            .limit(1);
          const [family] = await tx
            .select({ id: families.id })
            .from(families)
            .where(eq(families.id, signal.familyId))
            .for('share')
            .limit(1);
          const [membership] = await tx
            .select({ id: familyMembers.id })
            .from(familyMembers)
            .where(
              and(
                eq(familyMembers.userId, typedSocket.data.userId),
                eq(familyMembers.familyId, signal.familyId),
                eq(familyMembers.status, 'active'),
              ),
            )
            .for('share')
            .limit(1);
          if (!activeSession || !activeUser || !family || !membership) return 'denied';

          if (event === 'location:changed') {
            if (!sharerUserId) return 'sharer-unavailable';
            const [authorizedSharer] = await tx
              .select({ id: locationSharingSessions.id })
              .from(locationSharingSessions)
              .innerJoin(
                consents,
                and(
                  eq(consents.id, locationSharingSessions.consentId),
                  eq(consents.userId, locationSharingSessions.userId),
                  eq(consents.familyId, locationSharingSessions.familyId),
                  eq(consents.consentType, 'location_sharing'),
                  eq(consents.granted, true),
                  eq(consents.version, LOCATION_SHARING_POLICY_VERSION),
                  isNull(consents.revokedAt),
                ),
              )
              .innerJoin(
                familyMembers,
                and(
                  eq(familyMembers.userId, locationSharingSessions.userId),
                  eq(familyMembers.familyId, locationSharingSessions.familyId),
                  eq(familyMembers.status, 'active'),
                ),
              )
              .where(
                and(
                  eq(locationSharingSessions.userId, sharerUserId),
                  eq(locationSharingSessions.familyId, signal.familyId),
                  eq(locationSharingSessions.status, 'sharing'),
                  gt(locationSharingSessions.expiresAt, now),
                ),
              )
              .for('share')
              .limit(1);
            if (!authorizedSharer) return 'sharer-unavailable';
          }

          typedSocket.emit(event, signal);
          return 'delivered';
        });
        if (delivery === 'denied') {
          await typedSocket.leave(familyRoom(signal.familyId));
          typedSocket.data.familyIds.delete(signal.familyId);
          return;
        }
      }),
    );
  };

  locationNotifications.on('changed', (notification) => {
    const { sharerUserId, ...signal } = notification;
    void sendFamilySignal(signal, 'location:changed', sharerUserId).catch(() => {
      console.error('Realtime location notification delivery failed.');
    });
  });
  locationNotifications.on('invalidated', (signal) => {
    void sendFamilySignal(signal, 'location:invalidated').catch(() => {
      console.error('Realtime location notification delivery failed.');
    });
  });
  locationNotifications.on('membershipRemoved', ({ familyId, userId }) => {
    const room = familyRoom(familyId);
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId === userId && socket.data.familyIds.has(familyId)) {
        socket.emit('location:invalidated', locationNotifications.locationSignal(familyId));
        void socket.leave(room);
        socket.data.familyIds.delete(familyId);
      }
    }
  });
  locationNotifications.on('authSessionRevoked', ({ userId, sessionId }) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId === userId && socket.data.sessionId === sessionId) {
        socket.emit('session:revoked', { reason: 'session_revoked' });
        socket.disconnect(true);
      }
    }
  });
  locationNotifications.on('authUserRevoked', ({ userId }) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId === userId) {
        socket.emit('session:revoked', { reason: 'session_revoked' });
        socket.disconnect(true);
      }
    }
  });

  return io;

  async function revalidateSocket(socket: LocationSocket): Promise<void> {
    if (!(await validateSocketIdentity(socket))) {
      socket.disconnect(true);
      return;
    }
    for (const familyId of socket.data.familyIds) {
      if (!(await hasCurrentFamilyAuthorization(socket, familyId))) {
        await socket.leave(familyRoom(familyId));
        socket.data.familyIds.delete(familyId);
      }
    }
  }

  async function handleSubscribe(
    socket: LocationSocket,
    payload: unknown,
  ): Promise<SocketAcknowledgement> {
    if (!(await validateSocketIdentity(socket))) {
      socket.disconnect(true);
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    const familyId = readFamilyId(payload);
    if (!familyId) return { ok: false, error: 'INVALID_REQUEST' };
    if (!(await hasCurrentFamilyAuthorization(socket, familyId, true))) {
      return { ok: false, error: 'FAMILY_UNAVAILABLE' };
    }
    return { ok: true };
  }
}

async function hasCurrentFamilyAuthorization(
  socket: LocationSocket,
  familyId: string,
  joinRoom = false,
): Promise<boolean> {
  if (!(await validateSocketIdentity(socket))) return false;
  return getDatabase().transaction(async (tx) => {
    const now = new Date();
    const [activeSession] = await tx
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, socket.data.userId),
          eq(refreshTokens.sessionId, socket.data.sessionId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ),
      )
      .for('share')
      .limit(1);
    const [activeUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, socket.data.userId), eq(users.status, 'active')))
      .for('share')
      .limit(1);
    const [family] = await tx
      .select({ id: families.id })
      .from(families)
      .where(eq(families.id, familyId))
      .for('share')
      .limit(1);
    const [membership] = await tx
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.userId, socket.data.userId),
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.status, 'active'),
        ),
      )
      .for('share')
      .limit(1);
    if (!activeSession || !activeUser || !family || !membership) return false;
    if (joinRoom) {
      await socket.join(familyRoom(familyId));
      socket.data.familyIds.add(familyId);
    }
    return true;
  });
}

function readFamilyId(payload: unknown): string | undefined {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('familyId' in payload) ||
    typeof payload.familyId !== 'string' ||
    !familyIdSchema.test(payload.familyId)
  ) {
    return undefined;
  }
  return payload.familyId;
}
