import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface CapturedRequest {
  url?: string;
  method?: string;
  data?: unknown;
  headers: Record<string, unknown>;
  withCredentials?: boolean;
}

describe('browser authentication API contract', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('uses the existing auth endpoints, cookie credentials, and CSRF header without persisting tokens', async () => {
    const requests: CapturedRequest[] = [];
    const {
      apiClient,
      login,
      register,
      verifyEmail,
      verifyPhone,
      resendOtp,
      requestPasswordReset,
      resetPassword,
      logout,
    } = await import('./api');

    const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
      const body =
        typeof config.data === 'string' ? (JSON.parse(config.data) as unknown) : config.data;
      requests.push({
        url: config.url,
        method: config.method,
        data: body,
        headers: {
          csrfToken: config.headers.get('X-CSRF-Token'),
        },
        withCredentials: config.withCredentials,
      });
      let payload: unknown = { data: { message: 'ok' } };
      if (config.url === '/auth/csrf') payload = { data: { csrfToken: 'csrf-test-token' } };
      if (config.url === '/auth/login') {
        payload = {
          data: { user: { id: 'user-id', fullName: 'Avery' }, csrfToken: 'csrf-login-token' },
        };
      }
      if (config.url === '/auth/register') {
        payload = { data: { developmentOtp: { email: '123456', phone: '654321' } } };
      }
      if (config.url === '/auth/resend-otp' || config.url === '/auth/forgot-password') {
        payload = { data: { message: 'If eligible, sent.', developmentOtp: '123456' } };
      }
      return {
        config,
        data: payload,
        headers: {},
        status: 200,
        statusText: 'OK',
      };
    };
    apiClient.defaults.adapter = adapter;

    const input = {
      fullName: 'Avery Example',
      email: 'avery@example.test',
      phone: '+14155550123',
      password: 'Strong!Passphrase2026',
      passwordConfirmation: 'Strong!Passphrase2026',
      acceptTerms: true as const,
      acceptPrivacy: true as const,
    };
    const codes = await register(input);
    expect(codes).toEqual({ email: '123456', phone: '654321' });
    expect(await login(input.email, input.password)).toEqual({ id: 'user-id', fullName: 'Avery' });
    await verifyEmail(input.email, '123456');
    await verifyPhone(input.phone, '654321');
    expect(await resendOtp(input.email, 'verify_email')).toBe('123456');
    expect(await requestPasswordReset(input.phone, 'phone')).toBe('123456');
    await resetPassword({
      identifier: input.email,
      code: '123456',
      password: input.password,
      passwordConfirmation: input.password,
    });
    await logout();

    const requestsByPath = (path: string) => requests.filter((request) => request.url === path);
    expect(requests.map((request) => request.url)).toContain('/auth/register');
    expect(requests.map((request) => request.url)).toContain('/auth/verify-email');
    expect(requests.map((request) => request.url)).toContain('/auth/verify-phone');
    expect(requests.map((request) => request.url)).toContain('/auth/resend-otp');
    expect(requests.map((request) => request.url)).toContain('/auth/forgot-password');
    expect(requests.map((request) => request.url)).toContain('/auth/reset-password');
    expect(requestsByPath('/auth/login')[0]?.data).toMatchObject({
      identifier: input.email,
      password: input.password,
      clientType: 'web',
    });
    expect(requests.every((request) => request.withCredentials === true)).toBe(true);
    const unsafeRequests = requests.filter(
      (request) =>
        request.method === 'post' && request.url !== '/auth/csrf' && request.url !== '/auth/login',
    );
    expect(
      unsafeRequests.filter((request) => !request.headers.csrfToken).map((request) => request.url),
    ).toEqual([]);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('shares one browser refresh request when parallel API calls receive 401', async () => {
    const { apiClient, getCurrentUser } = await import('./api');
    let profileRequests = 0;
    let refreshRequests = 0;

    const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/csrf') {
        return {
          config,
          data: { data: { csrfToken: 'csrf-before-refresh' } },
          headers: {},
          status: 200,
          statusText: 'OK',
        };
      }
      if (config.url === '/auth/refresh') {
        refreshRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          config,
          data: { data: { csrfToken: 'csrf-after-refresh' } },
          headers: {},
          status: 200,
          statusText: 'OK',
        };
      }
      if (config.url === '/users/me') {
        profileRequests += 1;
        if (profileRequests <= 2) {
          const response = {
            config,
            data: { error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } },
            headers: {},
            status: 401,
            statusText: 'Unauthorized',
          };
          throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response);
        }
        return {
          config,
          data: {
            data: {
              user: {
                id: 'user-id',
                fullName: 'Avery Example',
                email: 'avery@example.test',
                phone: '+14155550123',
                emailVerified: true,
                phoneVerified: true,
                status: 'active',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          },
          headers: {},
          status: 200,
          statusText: 'OK',
        };
      }
      throw new Error('Unexpected API request.');
    };
    apiClient.defaults.adapter = adapter;

    const users = await Promise.all([getCurrentUser(), getCurrentUser()]);
    expect(users).toHaveLength(2);
    expect(users[0]?.email).toBe('avery@example.test');
    expect(refreshRequests).toBe(1);
    expect(profileRequests).toBe(4);
  });

  it('uses the existing profile and active-session endpoints and response shapes', async () => {
    const requests: Array<{ url?: string; method?: string; data?: unknown; csrf?: unknown }> = [];
    const {
      apiClient,
      getActiveSessions,
      logoutEverywhere,
      revokeActiveSession,
      updateCurrentUser,
    } = await import('./api');
    const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
      const body =
        typeof config.data === 'string' ? (JSON.parse(config.data) as unknown) : config.data;
      requests.push({
        url: config.url,
        method: config.method,
        data: body,
        csrf: config.headers.get('X-CSRF-Token'),
      });
      let payload: unknown = { data: { message: 'ok' } };
      if (config.url === '/auth/csrf') {
        payload = { data: { csrfToken: 'csrf-security-token' } };
      } else if (config.url === '/users/me') {
        payload = { data: { user: { id: 'user-id', fullName: 'Avery Updated' } } };
      } else if (config.url === '/auth/sessions') {
        payload = {
          data: {
            sessions: [
              {
                sessionId: '4a71d4fc-1915-4db4-b5a3-88c84e6bb18f',
                deviceInfo: 'FamShield Web',
                createdAt: '2026-02-01T10:00:00.000Z',
                expiresAt: '2026-03-01T10:00:00.000Z',
              },
            ],
          },
        };
      }
      return {
        config,
        data: payload,
        headers: {},
        status: 200,
        statusText: 'OK',
      };
    };
    apiClient.defaults.adapter = adapter;

    await expect(updateCurrentUser({ fullName: 'Avery Updated' })).resolves.toEqual({
      id: 'user-id',
      fullName: 'Avery Updated',
    });
    await expect(getActiveSessions()).resolves.toMatchObject([
      { sessionId: '4a71d4fc-1915-4db4-b5a3-88c84e6bb18f', deviceInfo: 'FamShield Web' },
    ]);
    await revokeActiveSession('4a71d4fc-1915-4db4-b5a3-88c84e6bb18f');
    await logoutEverywhere();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'get /auth/csrf',
      'patch /users/me',
      'get /auth/sessions',
      'delete /auth/sessions/4a71d4fc-1915-4db4-b5a3-88c84e6bb18f',
      'post /auth/logout-all',
    ]);
    expect(requests.find((request) => request.url === '/users/me')?.data).toEqual({
      fullName: 'Avery Updated',
    });
    expect(
      requests
        .filter((request) => request.method !== 'get')
        .every((request) => request.csrf === 'csrf-security-token'),
    ).toBe(true);
  });

  it('uses the authenticated family and invitation contracts with CSRF on mutations', async () => {
    const requests: CapturedRequest[] = [];
    const {
      apiClient,
      getFamilies,
      createFamily,
      getFamily,
      getFamilyMembers,
      createFamilyInvitation,
      getFamilyInvitations,
      getMyInvitations,
      acceptFamilyInvitation,
      declineFamilyInvitation,
      revokeFamilyInvitation,
      removeFamilyMember,
      leaveFamily,
      transferFamilyOwnership,
    } = await import('./api');
    const family = {
      id: 'family-id',
      name: 'Northstar',
      createdBy: 'owner-id',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      role: 'owner',
    };
    const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
      const body =
        typeof config.data === 'string' ? (JSON.parse(config.data) as unknown) : config.data;
      requests.push({
        url: config.url,
        method: config.method,
        data: body,
        headers: { csrfToken: config.headers.get('X-CSRF-Token') },
        withCredentials: config.withCredentials,
      });
      let payload: unknown = { data: { message: 'ok' } };
      if (config.url === '/auth/csrf') {
        payload = { data: { csrfToken: 'csrf-family-token' } };
      } else if (config.url === '/families') {
        payload =
          config.method === 'post' ? { data: { family } } : { data: { families: [family] } };
      } else if (config.url === '/families/family-id') {
        payload = { data: { family } };
      } else if (config.url === '/families/family-id/members') {
        payload = {
          data: {
            members: [
              {
                familyId: 'family-id',
                userId: 'owner-id',
                fullName: 'Avery Example',
                role: 'owner',
                status: 'active',
                joinedAt: '2026-03-01T00:00:00.000Z',
              },
            ],
          },
        };
      } else if (config.url === '/families/family-id/invitations') {
        payload =
          config.method === 'post'
            ? {
                data: {
                  invitation: {
                    id: 'invitation-id',
                    familyId: 'family-id',
                    inviteeEmail: 'member@example.test',
                    expiresAt: '2026-03-08T00:00:00.000Z',
                  },
                  token: 'one-time-invitation-token-1234567890',
                },
              }
            : {
                data: {
                  invitations: [
                    {
                      id: 'invitation-id',
                      inviteeEmail: 'member@example.test',
                      status: 'pending',
                      expiresAt: '2026-03-08T00:00:00.000Z',
                    },
                  ],
                },
              };
      } else if (config.url === '/invitations') {
        payload = {
          data: {
            invitations: [
              {
                id: 'invitation-id',
                family: { id: 'family-id', name: 'Northstar' },
                inviterName: 'Avery Example',
                expiresAt: '2026-03-08T00:00:00.000Z',
              },
            ],
          },
        };
      } else if (config.url === '/invitations/accept') {
        payload = { data: { family: { ...family, role: 'member' } } };
      }
      return {
        config,
        data: payload,
        headers: {},
        status: 200,
        statusText: 'OK',
      };
    };
    apiClient.defaults.adapter = adapter;

    await expect(getFamilies()).resolves.toMatchObject([{ id: 'family-id', role: 'owner' }]);
    await createFamily('Northstar');
    await getFamily('family-id');
    await expect(getFamilyMembers('family-id')).resolves.toHaveLength(1);
    const created = await createFamilyInvitation('family-id', {
      email: 'member@example.test',
    });
    await expect(getFamilyInvitations('family-id')).resolves.toHaveLength(1);
    await expect(getMyInvitations()).resolves.toHaveLength(1);
    await expect(acceptFamilyInvitation(created.token)).resolves.toMatchObject({
      id: 'family-id',
      role: 'member',
    });
    await declineFamilyInvitation(created.token);
    await revokeFamilyInvitation('family-id', 'invitation-id');
    await removeFamilyMember('family-id', 'member-id');
    await leaveFamily('family-id');
    await transferFamilyOwnership('family-id', 'member-id');

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'get /auth/csrf',
      'get /families',
      'post /families',
      'get /families/family-id',
      'get /families/family-id/members',
      'post /families/family-id/invitations',
      'get /families/family-id/invitations',
      'get /invitations',
      'post /invitations/accept',
      'post /invitations/decline',
      'delete /families/family-id/invitations/invitation-id',
      'delete /families/family-id/members/member-id',
      'post /families/family-id/leave',
      'post /families/family-id/transfer-ownership',
    ]);
    expect(
      requests
        .filter((request) => request.method !== 'get')
        .every((request) => request.headers.csrfToken === 'csrf-family-token'),
    ).toBe(true);
    expect(requests.every((request) => request.withCredentials === true)).toBe(true);
    expect(requests.find((request) => request.url === '/invitations/accept')?.data).toEqual({
      token: created.token,
    });
  });

  it('uses authenticated family-scoped consent endpoints and explicit CSRF-protected grants', async () => {
    const requests: CapturedRequest[] = [];
    const {
      apiClient,
      getLocationSharingConsent,
      getLocationSharingConsentHistory,
      grantLocationSharingConsent,
      revokeLocationSharingConsent,
    } = await import('./api');
    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const body =
        typeof config.data === 'string' ? (JSON.parse(config.data) as unknown) : config.data;
      requests.push({
        url: config.url,
        method: config.method,
        data: body,
        headers: { csrfToken: config.headers.get('X-CSRF-Token') },
        withCredentials: config.withCredentials,
      });
      const payload =
        config.url === '/auth/csrf'
          ? { data: { csrfToken: 'csrf-consent-token' } }
          : config.url === '/consents/location-sharing'
            ? {
                data: {
                  policyVersion: 'location-sharing-v1',
                  scopes: [
                    {
                      familyId: 'family-id',
                      familyName: 'Northstar',
                      enabled: false,
                    },
                  ],
                },
              }
            : config.url === '/consents/location-sharing/history'
              ? { data: { history: [] } }
              : { data: { message: 'ok' } };
      return {
        config,
        data: payload,
        headers: {},
        status: 200,
        statusText: 'OK',
      };
    };

    await expect(getLocationSharingConsent()).resolves.toMatchObject({
      policyVersion: 'location-sharing-v1',
      scopes: [{ familyId: 'family-id', enabled: false }],
    });
    await expect(getLocationSharingConsentHistory()).resolves.toEqual([]);
    await grantLocationSharingConsent('family-id', 'location-sharing-v1');
    await revokeLocationSharingConsent('family-id');

    expect(
      requests.find(
        (request) => request.url === '/consents/location-sharing' && request.method === 'post',
      )?.data,
    ).toEqual({
      familyId: 'family-id',
      policyVersion: 'location-sharing-v1',
      confirmed: true,
    });
    expect(
      requests
        .filter((request) => request.method !== 'get')
        .every((request) => request.headers.csrfToken === 'csrf-consent-token'),
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url === '/consents/location-sharing/family-id' && request.method === 'delete',
      ),
    ).toBe(true);
    expect(requests.every((request) => request.withCredentials === true)).toBe(true);
  });
});
