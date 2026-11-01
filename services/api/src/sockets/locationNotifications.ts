import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface LocationSignal {
  familyId: string;
  eventId: string;
  revision: number;
  occurredAt: string;
}

interface LocationNotificationEvents {
  changed: LocationSignal & { sharerUserId: string };
  invalidated: LocationSignal;
  membershipRemoved: { familyId: string; userId: string };
  authSessionRevoked: { userId: string; sessionId: string };
  authUserRevoked: { userId: string };
}

type Listener<T> = (payload: T) => void;

class NotificationBus {
  private readonly emitter = new EventEmitter();
  private revision = 0;

  on<K extends keyof LocationNotificationEvents>(
    event: K,
    listener: Listener<LocationNotificationEvents[K]>,
  ): void {
    this.emitter.on(event, listener);
  }

  emit<K extends keyof LocationNotificationEvents>(
    event: K,
    payload: LocationNotificationEvents[K],
  ): void {
    this.emitter.emit(event, payload);
  }

  locationSignal(familyId: string): LocationSignal {
    this.revision += 1;
    return {
      familyId,
      eventId: randomUUID(),
      revision: this.revision,
      occurredAt: new Date().toISOString(),
    };
  }
}

export const locationNotifications = new NotificationBus();

export function publishLocationChanged(familyId: string, sharerUserId: string): void {
  locationNotifications.emit('changed', {
    ...locationNotifications.locationSignal(familyId),
    sharerUserId,
  });
}

export function publishLocationInvalidated(familyId: string): void {
  locationNotifications.emit('invalidated', locationNotifications.locationSignal(familyId));
}

export function publishFamilyMembershipRemoved(familyId: string, userId: string): void {
  locationNotifications.emit('membershipRemoved', { familyId, userId });
}

export function publishAuthSessionRevoked(userId: string, sessionId: string): void {
  locationNotifications.emit('authSessionRevoked', { userId, sessionId });
}

export function publishAuthUserRevoked(userId: string): void {
  locationNotifications.emit('authUserRevoked', { userId });
}
