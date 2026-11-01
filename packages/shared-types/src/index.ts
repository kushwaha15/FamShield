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
}

export type FamilyMemberRole = 'owner' | 'member';
export type FamilyMemberStatus = 'invited' | 'active' | 'removed';

export interface FamilyMember {
  familyId: FamilyId;
  userId: UserId;
  role: FamilyMemberRole;
  status: FamilyMemberStatus;
  joinedAt?: string;
}

export interface LocationConsent {
  userId: UserId;
  familyId: FamilyId;
  enabled: boolean;
  grantedAt?: string;
  revokedAt?: string;
}

export interface LocationUpdate {
  userId: UserId;
  familyId: FamilyId;
  latitude: number;
  longitude: number;
  recordedAt: string;
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
