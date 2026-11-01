import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const api = vi.hoisted(() => ({
  getActiveSessions: vi.fn(),
  getApiErrorMessage: vi.fn(),
  getCurrentUser: vi.fn(),
  getFamilies: vi.fn(),
  getFamily: vi.fn(),
  getFamilyInvitations: vi.fn(),
  getFamilyMembers: vi.fn(),
  getMyInvitations: vi.fn(),
  getLocationSharingConsent: vi.fn(),
  getLocationSharingConsentHistory: vi.fn(),
  grantLocationSharingConsent: vi.fn(),
  revokeLocationSharingConsent: vi.fn(),
  createFamily: vi.fn(),
  createFamilyInvitation: vi.fn(),
  acceptFamilyInvitation: vi.fn(),
  declineFamilyInvitation: vi.fn(),
  leaveFamily: vi.fn(),
  removeFamilyMember: vi.fn(),
  revokeFamilyInvitation: vi.fn(),
  transferFamilyOwnership: vi.fn(),
  isUnauthenticated: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  logoutEverywhere: vi.fn(),
  register: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendOtp: vi.fn(),
  resetPassword: vi.fn(),
  revokeActiveSession: vi.fn(),
  updateCurrentUser: vi.fn(),
  verifyEmail: vi.fn(),
  verifyPhone: vi.fn(),
}));

vi.mock('../services/api', () => api);

const userProfile = {
  id: 'user-id',
  fullName: 'Avery Example',
  email: 'avery@example.test',
  phone: '+14155550123',
  emailVerified: true,
  phoneVerified: true,
  status: 'active' as const,
  profileImageUrl: 'https://images.example.test/avery.png',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const session = {
  sessionId: '4a71d4fc-1915-4db4-b5a3-88c84e6bb18f',
  deviceInfo: 'FamShield Web / Browser',
  createdAt: '2026-02-01T10:00:00.000Z',
  expiresAt: '2026-03-01T10:00:00.000Z',
};

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getApiErrorMessage.mockReturnValue('The request could not be completed.');
  api.getCurrentUser.mockResolvedValue(userProfile);
  api.getFamilies.mockResolvedValue([]);
  api.getFamily.mockResolvedValue(undefined);
  api.getFamilyInvitations.mockResolvedValue([]);
  api.getFamilyMembers.mockResolvedValue([]);
  api.getMyInvitations.mockResolvedValue([]);
  api.getLocationSharingConsent.mockResolvedValue({
    policyVersion: 'location-sharing-v1',
    scopes: [],
  });
  api.getLocationSharingConsentHistory.mockResolvedValue([]);
  api.grantLocationSharingConsent.mockResolvedValue(undefined);
  api.revokeLocationSharingConsent.mockResolvedValue(undefined);
  api.createFamily.mockResolvedValue(undefined);
  api.createFamilyInvitation.mockResolvedValue(undefined);
  api.acceptFamilyInvitation.mockResolvedValue(undefined);
  api.declineFamilyInvitation.mockResolvedValue(undefined);
  api.leaveFamily.mockResolvedValue(undefined);
  api.removeFamilyMember.mockResolvedValue(undefined);
  api.revokeFamilyInvitation.mockResolvedValue(undefined);
  api.transferFamilyOwnership.mockResolvedValue(undefined);
  api.getActiveSessions.mockResolvedValue([session]);
  api.isUnauthenticated.mockImplementation((error: { unauthenticated?: boolean }) =>
    Boolean(error?.unauthenticated),
  );
  api.login.mockResolvedValue(userProfile);
  api.logout.mockResolvedValue(undefined);
  api.logoutEverywhere.mockResolvedValue(undefined);
  api.register.mockResolvedValue(undefined);
  api.requestPasswordReset.mockResolvedValue(undefined);
  api.resendOtp.mockResolvedValue(undefined);
  api.resetPassword.mockResolvedValue(undefined);
  api.revokeActiveSession.mockResolvedValue(undefined);
  api.updateCurrentUser.mockImplementation(async (input: Partial<typeof userProfile>) => ({
    ...userProfile,
    ...input,
  }));
  api.verifyEmail.mockResolvedValue(undefined);
  api.verifyPhone.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('authenticated dashboard', () => {
  it('shows startup loading while the current profile is being fetched', async () => {
    let resolveProfile: ((profile: typeof userProfile) => void) | undefined;
    api.getCurrentUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProfile = resolve;
        }),
    );
    renderApp('/dashboard');
    expect(await screen.findByLabelText('Loading account')).toBeInTheDocument();

    await act(async () => {
      resolveProfile?.(userProfile);
    });
    expect(
      await screen.findByRole('heading', { name: 'Welcome, Avery Example' }),
    ).toBeInTheDocument();
  });

  it('shows a recoverable session error when startup profile loading fails', async () => {
    const user = userEvent.setup();
    api.getCurrentUser
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(userProfile);
    renderApp('/dashboard');
    expect(
      await screen.findByRole('heading', { name: 'We couldn’t load your account' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Welcome, Avery Example' }),
    ).toBeInTheDocument();
  });

  it('loads the actual account profile and does not invent family or location activity', async () => {
    renderApp('/dashboard');
    expect(
      await screen.findByRole('heading', { name: 'Welcome, Avery Example' }),
    ).toBeInTheDocument();
    expect(screen.getByText('avery@example.test')).toBeInTheDocument();
    expect(screen.getByText('+14155550123')).toBeInTheDocument();
    expect(screen.getAllByText('Verified')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Family management/ })).toBeInTheDocument();
  });

  it('redirects unauthenticated visitors to login and gives a path back to the dashboard', async () => {
    api.getCurrentUser.mockRejectedValue({ unauthenticated: true });
    renderApp('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Account information' })).not.toBeInTheDocument();
  });

  it('updates supported profile fields and reports success', async () => {
    const user = userEvent.setup();
    renderApp('/dashboard/profile');
    const nameInput = await screen.findByLabelText('Full name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Avery Updated');
    await user.clear(screen.getByLabelText(/Profile image URL/));
    await user.type(
      screen.getByLabelText(/Profile image URL/),
      'https://images.example.test/updated.png',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Your profile has been updated.')).toBeInTheDocument();
    expect(api.updateCurrentUser).toHaveBeenCalledWith({
      fullName: 'Avery Updated',
      profileImageUrl: 'https://images.example.test/updated.png',
    });
  });

  it('shows validation feedback and does not send invalid profile data', async () => {
    const user = userEvent.setup();
    renderApp('/dashboard/profile');
    const nameInput = await screen.findByLabelText('Full name');
    await user.clear(nameInput);
    expect(nameInput).toHaveValue('');
    await user.type(nameInput, 'A');
    expect(nameInput).toHaveValue('A');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Name must be between 2 and 100 characters.',
    );
    expect(api.updateCurrentUser).not.toHaveBeenCalled();
  });

  it('lists real sessions and asks before revoking a session', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp('/dashboard/security');
    expect(await screen.findByText('FamShield Web / Browser')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke session' }));

    expect(confirm).toHaveBeenCalledWith(
      'Sign out FamShield Web / Browser? This action cannot be undone.',
    );
    expect(api.revokeActiveSession).toHaveBeenCalledWith(session.sessionId);
    expect(await screen.findByText('The selected session was revoked.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('FamShield Web / Browser')).not.toBeInTheDocument(),
    );
  });

  it('does not revoke a session when confirmation is declined', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderApp('/dashboard/security');
    await screen.findByText('FamShield Web / Browser');
    await user.click(screen.getByRole('button', { name: 'Revoke session' }));
    expect(api.revokeActiveSession).not.toHaveBeenCalled();
  });

  it('confirms logout everywhere and signs out through the existing API', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp('/dashboard/security');
    await screen.findByText('FamShield Web / Browser');
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    expect(confirm).toHaveBeenCalledWith('Sign out all active sessions, including this browser?');
    expect(api.logoutEverywhere).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('signs out the current session from dashboard navigation', async () => {
    const user = userEvent.setup();
    renderApp('/dashboard');
    await screen.findByRole('heading', { name: 'Welcome, Avery Example' });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(api.logout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('renders family empty state and creates a family using the API', async () => {
    const user = userEvent.setup();
    api.createFamily.mockResolvedValue({
      id: 'family-1',
      name: 'Northstar',
      createdBy: userProfile.id,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      role: 'owner',
    });
    renderApp('/dashboard/families');
    expect(await screen.findByText('You haven’t joined a family yet.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Family name'), 'Northstar');
    await user.click(screen.getByRole('button', { name: 'Create family' }));

    expect(api.createFamily).toHaveBeenCalledWith('Northstar');
    expect(await screen.findByText('Your family has been created.')).toBeInTheDocument();
  });

  it('creates a single-use invitation link and requires confirmation to revoke invitations', async () => {
    const user = userEvent.setup();
    const family = {
      id: 'family-1',
      name: 'Northstar',
      createdBy: userProfile.id,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      role: 'owner' as const,
    };
    api.getFamilies.mockResolvedValue([family]);
    api.getFamilyMembers.mockResolvedValue([
      {
        familyId: family.id,
        userId: userProfile.id,
        fullName: userProfile.fullName,
        role: 'owner',
        status: 'active',
        joinedAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    api.createFamilyInvitation.mockResolvedValue({
      invitation: {
        id: 'invitation-1',
        familyId: family.id,
        inviteeEmail: 'member@example.test',
        expiresAt: '2026-03-08T00:00:00.000Z',
      },
      token: 'safe-random-invitation-token-safe',
    });
    api.getFamilyInvitations.mockResolvedValue([
      {
        id: 'invitation-1',
        familyId: family.id,
        inviteeEmail: 'member@example.test',
        status: 'pending',
        expiresAt: '2026-03-08T00:00:00.000Z',
      },
    ]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp('/dashboard/families');
    await screen.findByRole('heading', { name: 'Northstar' });
    await user.type(screen.getByLabelText('Email address'), 'member@example.test');
    await user.click(screen.getByRole('button', { name: 'Create invitation' }));

    const invitationLink = await screen.findByLabelText('Copyable invitation link');
    expect((invitationLink as HTMLInputElement).value).toContain(
      '#token=safe-random-invitation-token-safe',
    );
    expect(await screen.findByText('member@example.test')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(confirm).toHaveBeenCalled();
    expect(api.revokeFamilyInvitation).toHaveBeenCalledWith(family.id, 'invitation-1');
  });

  it('accepts and declines invitations only when a one-time link token is present', async () => {
    const user = userEvent.setup();
    api.acceptFamilyInvitation.mockResolvedValue({
      id: 'family-2',
      name: 'Cedar Family',
      createdBy: 'owner-id',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      role: 'member',
    });
    renderApp('/dashboard/families#token=secure-invitation-token-123456789');
    await screen.findByRole('heading', { name: 'You have an invitation link' });
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));

    expect(api.acceptFamilyInvitation).toHaveBeenCalledWith('secure-invitation-token-123456789');
    expect(await screen.findByText('You joined Cedar Family.')).toBeInTheDocument();

    api.declineFamilyInvitation.mockResolvedValue(undefined);
    renderApp('/dashboard/families#token=another-secure-invitation-token-123456');
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(api.declineFamilyInvitation).toHaveBeenCalledWith(
      'another-secure-invitation-token-123456',
    );
    expect(await screen.findByText('The invitation was declined.')).toBeInTheDocument();
  });

  it('confirms member removal and ownership transfer actions', async () => {
    const user = userEvent.setup();
    const family = {
      id: 'family-1',
      name: 'Northstar',
      createdBy: userProfile.id,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      role: 'owner' as const,
    };
    api.getFamilies.mockResolvedValue([family]);
    api.getFamilyMembers.mockResolvedValue([
      {
        familyId: family.id,
        userId: userProfile.id,
        fullName: 'Avery Example',
        role: 'owner',
        status: 'active',
        joinedAt: '2026-03-01T00:00:00.000Z',
      },
      {
        familyId: family.id,
        userId: 'member-id',
        fullName: 'Jordan Example',
        role: 'member',
        status: 'active',
        joinedAt: '2026-03-02T00:00:00.000Z',
      },
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp('/dashboard/families');
    await screen.findByRole('heading', { name: 'Northstar' });
    await screen.findByRole('button', { name: 'Remove member' });
    await user.click(screen.getByRole('button', { name: 'Remove member' }));
    expect(api.removeFamilyMember).toHaveBeenCalledWith(family.id, 'member-id');

    await screen.findByRole('button', { name: 'Remove member' });
    await user.selectOptions(screen.getByLabelText('New family owner'), 'member-id');
    await user.click(screen.getByRole('button', { name: 'Transfer ownership' }));
    expect(api.transferFamilyOwnership).toHaveBeenCalledWith(family.id, 'member-id');
    expect(
      await screen.findByText('Ownership was transferred to Jordan Example.'),
    ).toBeInTheDocument();
  });

  it('requires an unchecked explicit confirmation before granting family-scoped consent', async () => {
    const user = userEvent.setup();
    api.getLocationSharingConsent.mockResolvedValue({
      policyVersion: 'location-sharing-v1',
      scopes: [
        {
          familyId: 'family-privacy',
          familyName: 'Northstar',
          enabled: false,
        },
      ],
    });
    renderApp('/dashboard/privacy');

    expect(
      await screen.findByRole('heading', { name: 'Current consent by family' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This phase does not request device location permissions/),
    ).toBeInTheDocument();
    const confirmation = screen.getByRole('checkbox');
    expect(confirmation).not.toBeChecked();
    const enableButton = screen.getByRole('button', {
      name: 'Enable location-sharing consent',
    });
    expect(enableButton).toBeDisabled();

    await user.click(confirmation);
    await user.click(enableButton);
    expect(api.grantLocationSharingConsent).toHaveBeenCalledWith(
      'family-privacy',
      'location-sharing-v1',
    );
  });

  it('confirms revocation and displays the consent history', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.getLocationSharingConsent.mockResolvedValue({
      policyVersion: 'location-sharing-v1',
      scopes: [
        {
          familyId: 'family-privacy',
          familyName: 'Northstar',
          enabled: true,
          grantedAt: '2026-10-01T10:00:00.000Z',
          grantedPolicyVersion: 'location-sharing-v1',
        },
      ],
    });
    api.getLocationSharingConsentHistory.mockResolvedValue([
      {
        id: 'consent-1',
        familyId: 'family-privacy',
        status: 'granted',
        grantedAt: '2026-10-01T10:00:00.000Z',
        revokedAt: null,
        policyVersion: 'location-sharing-v1',
        recordedAt: '2026-10-01T10:00:00.000Z',
      },
    ]);
    renderApp('/dashboard/privacy');

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(api.revokeLocationSharingConsent).toHaveBeenCalledWith('family-privacy');
    expect(await screen.findByText('Consent history')).toBeInTheDocument();
    expect(await screen.findByText('granted', { exact: true })).toBeInTheDocument();
  });

  it('shows a recoverable error when consent status cannot be loaded', async () => {
    api.getLocationSharingConsent.mockRejectedValue(new Error('offline'));
    renderApp('/dashboard/privacy');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request could not be completed.',
    );
  });

  it('shows a loading state while consent and history are fetched', async () => {
    let resolveConsent: ((value: { policyVersion: string; scopes: [] }) => void) | undefined;
    api.getLocationSharingConsent.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConsent = resolve;
        }),
    );
    renderApp('/dashboard/privacy');
    expect(await screen.findByLabelText('Loading consent information')).toBeInTheDocument();

    await act(async () => {
      resolveConsent?.({ policyVersion: 'location-sharing-v1', scopes: [] });
    });
    expect(await screen.findByText(/You are not currently an active member/)).toBeInTheDocument();
  });
});
