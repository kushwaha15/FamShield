import axios from 'axios';
import type { User } from '@famshield/shared-types';

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
  const response = await apiClient.post<ApiEnvelope<{ developmentOtp?: DevelopmentOtp }>>(
    '/auth/register',
    input,
  );
  return response.data.data.developmentOtp;
}

export async function verifyEmail(email: string, code: string): Promise<void> {
  await apiClient.post('/auth/verify-email', { email, code });
}

export async function verifyPhone(phone: string, code: string): Promise<void> {
  await apiClient.post('/auth/verify-phone', { phone, code });
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
      const refreshed = await apiClient.post<ApiEnvelope<{ csrfToken: string }>>(
        '/auth/refresh',
        {},
        csrfHeaders(),
      );
      csrfToken = refreshed.data.data.csrfToken;
      return await apiClient(config);
    } catch {
      csrfToken = undefined;
      throw error;
    }
  },
);

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    _famshieldRetried?: boolean;
  }
}
