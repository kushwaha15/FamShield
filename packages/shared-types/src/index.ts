export type UserId = string;
export type FamilyId = string;

export interface User {
  id: UserId;
  fullName: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  status: 'pending_verification' | 'active' | 'suspended';
  profileImageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterRequest {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  passwordConfirmation: string;
  acceptTerms: true;
  acceptPrivacy: true;
}

export interface LoginRequest {
  identifier: string;
  password: string;
  clientType?: 'web' | 'mobile';
  deviceInfo?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export interface AuthenticatedUserResponse {
  user: User;
  accessToken?: string;
  refreshToken?: string;
  sessionId?: string;
  csrfToken?: string;
}

export interface Family {
  id: FamilyId;
  name: string;
  createdBy: UserId;
  createdAt: string;
  updatedAt: string;
  role?: FamilyMemberRole;
}

export type FamilyMemberRole = 'owner' | 'member';
export type FamilyMemberStatus = 'active' | 'left' | 'removed';

export interface FamilyMember {
  familyId: FamilyId;
  userId: UserId;
  role: FamilyMemberRole;
  status: FamilyMemberStatus;
  fullName: string;
  profileImageUrl?: string;
  joinedAt: string;
}

export type FamilyInvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

export interface FamilyInvitation {
  id: string;
  familyId?: FamilyId;
  inviteeEmail?: string;
  inviteePhone?: string;
  status?: FamilyInvitationStatus;
  family?: Pick<Family, 'id' | 'name'>;
  inviterName?: string;
  expiresAt: string;
  createdAt?: string;
}

export interface CreatedFamilyInvitation {
  invitation: FamilyInvitation;
  token: string;
}

export interface LocationConsent {
  familyId: FamilyId;
  familyName: string;
  enabled: boolean;
  needsReview?: boolean;
  grantedAt?: string;
  grantedPolicyVersion?: string;
}

export interface LocationSharingConsentState {
  policyVersion: string;
  scopes: LocationConsent[];
}

export interface LocationSharingConsentHistoryEntry {
  id: string;
  familyId: FamilyId | null;
  status: 'granted' | 'revoked' | 'inactive';
  grantedAt: string | null;
  revokedAt: string | null;
  policyVersion: string;
  recordedAt: string;
}

export interface LocationSharingConsentGrant {
  familyId: FamilyId;
  familyName: string;
  enabled: true;
  grantedAt: string;
  policyVersion: string;
}

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  sequence: number;
  clientRecordedAt: string;
}

export type LocationSharingSessionStatus = 'sharing' | 'paused' | 'stopped' | 'expired';

export interface LocationSharingSession {
  id: string;
  sessionVersion: string;
  status: LocationSharingSessionStatus;
  startedAt: string;
  expiresAt: string;
}

export interface FamilyLocation {
  userId: UserId;
  fullName: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: string;
  status: 'fresh' | 'stale';
}

export type EmergencyAlertStatus = 'active' | 'acknowledged' | 'resolved';

export interface EmergencyAlert {
  id: string;
  familyId: FamilyId;
  createdBy: UserId;
  status: EmergencyAlertStatus;
  createdAt: string;
}

export interface ApiResponse<T> {
  data: T;
  requestId?: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
  requestId?: string;
}
