import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { AuthProvider } from '../context/AuthContext';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { LoginPage } from './LoginPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { SignupPage } from './SignupPage';
import { VerifyPage } from './VerifyPage';
import { ProtectedRoute } from '../routes/ProtectedRoute';

const api = vi.hoisted(() => ({
  getApiErrorMessage: vi.fn(),
  getCurrentUser: vi.fn(),
  getActiveSessions: vi.fn(),
  isUnauthenticated: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  logoutEverywhere: vi.fn(),
  revokeActiveSession: vi.fn(),
  register: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendOtp: vi.fn(),
  resetPassword: vi.fn(),
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
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderAuth(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/dashboard" element={<p>Dashboard loaded</p>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/protected" element={<p>Protected content</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getApiErrorMessage.mockReturnValue('The request could not be completed.');
  api.getCurrentUser.mockRejectedValue({ unauthenticated: true });
  api.getActiveSessions.mockResolvedValue([]);
  api.isUnauthenticated.mockImplementation((error: { unauthenticated?: boolean }) =>
    Boolean(error?.unauthenticated),
  );
  api.login.mockResolvedValue(userProfile);
  api.logout.mockResolvedValue(undefined);
  api.logoutEverywhere.mockResolvedValue(undefined);
  api.revokeActiveSession.mockResolvedValue(undefined);
  api.register.mockResolvedValue({ email: '123456', phone: '654321' });
  api.requestPasswordReset.mockResolvedValue(undefined);
  api.resendOtp.mockResolvedValue(undefined);
  api.resetPassword.mockResolvedValue(undefined);
  api.updateCurrentUser.mockResolvedValue(userProfile);
  api.verifyEmail.mockResolvedValue(undefined);
  api.verifyPhone.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('authentication pages', () => {
  it('keeps /auth as a compatibility route to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/auth']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor from a protected route to login', async () => {
    renderAuth('/protected');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('submits web login and navigates to the dashboard without browser token storage', async () => {
    const user = userEvent.setup();
    renderAuth();
    await screen.findByRole('heading', { name: 'Welcome back' });
    await user.type(screen.getByLabelText('Email or mobile number'), 'avery@example.test');
    await user.type(screen.getByLabelText('Password'), 'Strong!Passphrase2026');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Dashboard loaded')).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith('avery@example.test', 'Strong!Passphrase2026');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('loads an existing browser session and routes to the dashboard', async () => {
    api.getCurrentUser.mockResolvedValue(userProfile);
    renderAuth();
    expect(await screen.findByText('Dashboard loaded')).toBeInTheDocument();
  });

  it('validates signup and routes successful registration to email and phone verification', async () => {
    const user = userEvent.setup();
    renderAuth('/signup');
    await user.type(screen.getByLabelText('Full name'), 'Avery Example');
    await user.type(screen.getByLabelText('Email address'), 'avery@example.test');
    await user.type(screen.getByLabelText('Mobile number with country code'), '+14155550123');
    await user.type(
      screen.getByLabelText('Password', { selector: 'input' }),
      'Strong!Passphrase2026',
    );
    await user.type(screen.getByLabelText('Confirm password'), 'Strong!Passphrase2026');
    await user.click(screen.getByLabelText('I accept the Terms of Service.'));
    await user.click(screen.getByLabelText('I acknowledge the Privacy Policy.'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByRole('heading', { name: 'Verify your contacts' }),
    ).toBeInTheDocument();
    expect(api.register).toHaveBeenCalledWith({
      fullName: 'Avery Example',
      email: 'avery@example.test',
      phone: '+14155550123',
      password: 'Strong!Passphrase2026',
      passwordConfirmation: 'Strong!Passphrase2026',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    expect(screen.getByText(/Development-only test codes supplied by the API/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resend email code' }));
    expect(api.resendOtp).toHaveBeenCalledWith('avery@example.test', 'verify_email');
    expect(await screen.findByRole('button', { name: 'Resend email code in 30s' })).toBeDisabled();
  });

  it('verifies both OTP channels and sends resend requests with cooldown feedback', async () => {
    const user = userEvent.setup();
    renderAuth('/signup');
    await user.type(screen.getByLabelText('Full name'), 'Avery Example');
    await user.type(screen.getByLabelText('Email address'), 'avery@example.test');
    await user.type(screen.getByLabelText('Mobile number with country code'), '+14155550123');
    await user.type(
      screen.getByLabelText('Password', { selector: 'input' }),
      'Strong!Passphrase2026',
    );
    await user.type(screen.getByLabelText('Confirm password'), 'Strong!Passphrase2026');
    await user.click(screen.getByLabelText('I accept the Terms of Service.'));
    await user.click(screen.getByLabelText('I acknowledge the Privacy Policy.'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByRole('heading', { name: 'Verify your contacts' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Phone verification code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify mobile number' }));
    expect(
      await screen.findByText('Both contacts are verified. Your account is ready to sign in.'),
    ).toBeInTheDocument();
    expect(api.verifyEmail).toHaveBeenCalledWith('avery@example.test', '123456');
    expect(api.verifyPhone).toHaveBeenCalledWith('+14155550123', '654321');

    fireEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('requests a password reset and completes reset with client-side mismatch validation', async () => {
    const user = userEvent.setup();
    api.requestPasswordReset.mockResolvedValue('456789');
    renderAuth('/forgot-password');
    await user.type(screen.getByLabelText('Email address'), 'avery@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset instructions' }));

    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/reset instructions have been sent/i)).toBeInTheDocument();
    expect(api.requestPasswordReset).toHaveBeenCalledWith('avery@example.test', 'email');
    expect(screen.getByLabelText('One-time code')).toHaveValue('456789');

    await user.type(screen.getByLabelText('New password'), 'Strong!Passphrase2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'Different!Passphrase2026');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(api.resetPassword).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'Strong!Passphrase2026');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    await waitFor(() =>
      expect(api.resetPassword).toHaveBeenCalledWith({
        identifier: 'avery@example.test',
        code: '456789',
        password: 'Strong!Passphrase2026',
        passwordConfirmation: 'Strong!Passphrase2026',
      }),
    );
    expect(
      await screen.findByText('Your password has been reset. Sign in with your new password.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to sign in' })).toBeInTheDocument();
  });

  it('shows backend errors and preserves loading feedback during login', async () => {
    const user = userEvent.setup();
    let rejectLogin: ((error: unknown) => void) | undefined;
    api.login.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectLogin = reject;
        }),
    );
    api.getApiErrorMessage.mockReturnValue('Email, phone, or password is incorrect.');
    renderAuth();
    await screen.findByRole('heading', { name: 'Welcome back' });
    await user.type(screen.getByLabelText('Email or mobile number'), 'avery@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled();
    rejectLogin?.(new Error('Unauthorized'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email, phone, or password is incorrect.',
    );
  });
});
