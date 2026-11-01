import axios from 'axios';
import type {
  CreatedFamilyInvitation,
  Family,
  FamilyInvitation,
  FamilyMember,
  LocationSharingConsentGrant,
  LocationSharingConsentHistoryEntry,
  LocationSharingConsentState,
  User,
} from '@famshield/shared-types';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api',
  timeout: 5000,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
  },
});

let csrfToken: string | undefined;
let csrfRequest: Promise<void> | undefined;

interface ApiEnvelope<T> {
  data: T;
}

interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

export type AuthUser = User;

export interface DevelopmentOtp {
  email: string;
  phone: string;
}

export interface AuthResult {
  user: AuthUser;
  csrfToken: string;
}

export type FamilySummary = Family;
export type FamilyMemberDetails = FamilyMember;
export type FamilyInvitationDetails = FamilyInvitation;

export interface ActiveSession {
  sessionId: string;
  deviceInfo?: string;
  createdAt: string;
  expiresAt: string;
}

interface MessageResult {
  message: string;
  developmentOtp?: string;
}

export async function getCurrentUser(): Promise<AuthUser> {
  await ensureCsrfToken();
  const response = await apiClient.get<ApiEnvelope<{ user: AuthUser }>>('/users/me');
  return response.data.data.user;
}

async function ensureCsrfToken(): Promise<void> {
  if (csrfToken) return;
  if (!csrfRequest) {
    csrfRequest = apiClient
      .get<ApiEnvelope<{ csrfToken: string }>>('/auth/csrf')
      .then((response) => {
        csrfToken = response.data.data.csrfToken;
      })
      .finally(() => {
        csrfRequest = undefined;
      });
  }
  await csrfRequest;
}

export async function register(input: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  passwordConfirmation: string;
  acceptTerms: true;
  acceptPrivacy: true;
}): Promise<DevelopmentOtp | undefined> {
  await ensureCsrfToken();
  const response = await apiClient.post<ApiEnvelope<{ developmentOtp?: DevelopmentOtp }>>(
    '/auth/register',
    input,
    csrfHeaders(),
  );
  return response.data.data.developmentOtp;
}

export async function verifyEmail(email: string, code: string): Promise<void> {
  await ensureCsrfToken();
  await apiClient.post('/auth/verify-email', { email, code }, csrfHeaders());
}

export async function verifyPhone(phone: string, code: string): Promise<void> {
  await ensureCsrfToken();
  await apiClient.post('/auth/verify-phone', { phone, code }, csrfHeaders());
}

export async function resendOtp(
  identifier: string,
  purpose: 'verify_email' | 'verify_phone',
): Promise<string | undefined> {
  await ensureCsrfToken();
  const response = await apiClient.post<ApiEnvelope<MessageResult>>(
    '/auth/resend-otp',
    { identifier, purpose },
    csrfHeaders(),
  );
  return response.data.data.developmentOtp;
}

export async function login(identifier: string, password: string): Promise<AuthUser> {
  await ensureCsrfToken();
  const response = await apiClient.post<ApiEnvelope<{ user: AuthUser; csrfToken: string }>>(
    '/auth/login',
    { identifier, password, clientType: 'web' },
  );
  csrfToken = response.data.data.csrfToken;
  return response.data.data.user;
}

export async function logout(): Promise<void> {
  await ensureCsrfToken();
  await apiClient.post('/auth/logout', {}, csrfHeaders());
  csrfToken = undefined;
}

export async function logoutEverywhere(): Promise<void> {
  await ensureCsrfToken();
  await apiClient.post('/auth/logout-all', {}, csrfHeaders());
  csrfToken = undefined;
}

export async function updateCurrentUser(input: {
  fullName?: string;
  profileImageUrl?: string | null;
}): Promise<AuthUser> {
  await ensureCsrfToken();
  const response = await apiClient.patch<ApiEnvelope<{ user: AuthUser }>>(
    '/users/me',
    input,
    csrfHeaders(),
  );
  return response.data.data.user;
}

export async function getActiveSessions(): Promise<ActiveSession[]> {
  await ensureCsrfToken();
  const response =
    await apiClient.get<ApiEnvelope<{ sessions: ActiveSession[] }>>('/auth/sessions');
  return response.data.data.sessions;
}

export async function revokeActiveSession(sessionId: string): Promise<void> {
  await ensureCsrfToken();
  await apiClient.delete(`/auth/sessions/${encodeURIComponent(sessionId)}`, csrfHeaders());
}

export async function getFamilies(): Promise<FamilySummary[]> {
  await ensureCsrfToken();
  const response = await apiClient.get<ApiEnvelope<{ families: FamilySummary[] }>>('/families');
  return response.data.data.families;
}

export async function createFamily(name: string): Promise<FamilySummary> {
  await ensureCsrfToken();
  const response = await apiClient.post<ApiEnvelope<{ family: FamilySummary }>>(
    '/families',
    { name },
    csrfHeaders(),
  );
  return response.data.data.family;
}

export async function getFamily(familyId: string): Promise<FamilySummary> {
  await ensureCsrfToken();
  const response = await apiClient.get<ApiEnvelope<{ family: FamilySummary }>>(
    `/families/${encodeURIComponent(familyId)}`,
  );
  return response.data.data.family;
}

export async function getFamilyMembers(familyId: string): Promise<FamilyMemberDetails[]> {
  await ensureCsrfToken();
  const response = await apiClient.get<ApiEnvelope<{ members: FamilyMemberDetails[] }>>(
    `/families/${encodeURIComponent(familyId)}/members`,
  );
  return response.data.data.members;
}

export async function createFamilyInvitation(
  familyId: string,
  contact: { email: string } | { phone: string },
): Promise<CreatedFamilyInvitation> {
  await ensureCsrfToken();
  const response = await apiClient.post<ApiEnvelope<CreatedFamilyInvitation>>(
    `/families/${encodeURIComponent(familyId)}/invitations`,
    contact,
    csrfHeaders(),
  );
  return response.data.data;
}

export async function getFamilyInvitations(familyId: string): Promise<FamilyInvitationDetails[]> {
  await ensureCsrfToken();
  const response = await apiClient.get<ApiEnvelope<{ invitations: FamilyInvitationDetails[] }>>(
    `/families/${encodeURIComponent(familyId)}/invitations`,
  );
  return response.data.data.invitations;
}

export async function getMyInvitations(): Promise<FamilyInvitationDetails[]> {
  await ensureCsrfToken();
  const response =
    await apiClient.get<ApiEnvelope<{ invitations: FamilyInvitationDetails[] }>>('/invitations');
  return response.data.data.invitations;
}

export async function acceptFamilyInvitation(token: string): Promise<FamilySummary> {
  await ensureCsrfToken();
  const response = await apiClient.post<ApiEnvelope<{ family: FamilySummary }>>(
    '/invitations/accept',
    { token },
    csrfHeaders(),
  );
  return response.data.data.family;
}

export async function declineFamilyInvitation(token: string): Promise<void> {
  await ensureCsrfToken();
  await apiClient.post('/invitations/decline', { token }, csrfHeaders());
}

export async function revokeFamilyInvitation(
  familyId: string,
  invitationId: string,
): Promise<void> {
  await ensureCsrfToken();
  await apiClient.delete(
    `/families/${encodeURIComponent(familyId)}/invitations/${encodeURIComponent(invitationId)}`,
    csrfHeaders(),
  );
}

export async function removeFamilyMember(familyId: string, userId: string): Promise<void> {
  await ensureCsrfToken();
  await apiClient.delete(
    `/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(userId)}`,
    csrfHeaders(),
  );
}

export async function leaveFamily(familyId: string): Promise<void> {
  await ensureCsrfToken();
  await apiClient.post(`/families/${encodeURIComponent(familyId)}/leave`, {}, csrfHeaders());
}

export async function transferFamilyOwnership(
  familyId: string,
  targetUserId: string,
): Promise<void> {
  await ensureCsrfToken();
  await apiClient.post(
    `/families/${encodeURIComponent(familyId)}/transfer-ownership`,
    { targetUserId },
    csrfHeaders(),
  );
}

export async function getLocationSharingConsent(): Promise<LocationSharingConsentState> {
  await ensureCsrfToken();
  const response = await apiClient.get<ApiEnvelope<LocationSharingConsentState>>(
    '/consents/location-sharing',
  );
  return response.data.data;
}

export async function getLocationSharingConsentHistory(): Promise<
  LocationSharingConsentHistoryEntry[]
> {
  await ensureCsrfToken();
  const response = await apiClient.get<
    ApiEnvelope<{ history: LocationSharingConsentHistoryEntry[] }>
  >('/consents/location-sharing/history');
  return response.data.data.history;
}

export async function grantLocationSharingConsent(
  familyId: string,
  policyVersion: string,
): Promise<LocationSharingConsentGrant> {
  await ensureCsrfToken();
  const response = await apiClient.post<ApiEnvelope<LocationSharingConsentGrant>>(
    '/consents/location-sharing',
    { familyId, policyVersion, confirmed: true },
    csrfHeaders(),
  );
  return response.data.data;
}

export async function revokeLocationSharingConsent(familyId: string): Promise<void> {
  await ensureCsrfToken();
  await apiClient.delete(
    `/consents/location-sharing/${encodeURIComponent(familyId)}`,
    csrfHeaders(),
  );
}

export async function requestPasswordReset(
  identifier: string,
  channel: 'email' | 'phone',
): Promise<string | undefined> {
  await ensureCsrfToken();
  const response = await apiClient.post<ApiEnvelope<MessageResult>>(
    '/auth/forgot-password',
    { identifier, channel },
    csrfHeaders(),
  );
  return response.data.data.developmentOtp;
}

export async function resetPassword(input: {
  identifier: string;
  code: string;
  password: string;
  passwordConfirmation: string;
}): Promise<void> {
  await ensureCsrfToken();
  await apiClient.post('/auth/reset-password', input, csrfHeaders());
}

export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data.error?.message ?? 'The request could not be completed.';
  }
  return 'The request could not be completed.';
}

export function isUnauthenticated(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

function csrfHeaders(): { headers: { 'X-CSRF-Token'?: string } } {
  return { headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {} };
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      throw error;
    }

    const config = error.config;
    if (!config || config._famshieldRetried || config.url?.includes('/auth/') || !csrfToken) {
      throw error;
    }

    config._famshieldRetried = true;
    try {
      await refreshBrowserSession();
      return await apiClient(config);
    } catch {
      throw error;
    }
  },
);

let refreshRequest: Promise<void> | undefined;

function refreshBrowserSession(): Promise<void> {
  if (!refreshRequest) {
    refreshRequest = apiClient
      .post<ApiEnvelope<{ csrfToken: string }>>('/auth/refresh', {}, csrfHeaders())
      .then((response) => {
        csrfToken = response.data.data.csrfToken;
      })
      .catch((error: unknown) => {
        csrfToken = undefined;
        throw error;
      })
      .finally(() => {
        refreshRequest = undefined;
      });
  }
  return refreshRequest;
}

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    _famshieldRetried?: boolean;
  }
}
