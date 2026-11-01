import { useEffect, useState, type FormEvent } from 'react';
import {
  getApiErrorMessage,
  getCurrentUser,
  isUnauthenticated,
  login,
  logout,
  register,
  verifyEmail,
  verifyPhone,
  type AuthUser,
  type DevelopmentOtp,
} from '../services/api';

type AuthView = 'login' | 'register' | 'verify';

export function AuthPage() {
  const [view, setView] = useState<AuthView>('login');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [user, setUser] = useState<AuthUser>();
  const [developmentOtp, setDevelopmentOtp] = useState<DevelopmentOtp>();
  const [verified, setVerified] = useState({ email: false, phone: false });
  const [registration, setRegistration] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    passwordConfirmation: '',
  });
  const [verification, setVerification] = useState({ email: '', phone: '' });

  useEffect(() => {
    let active = true;
    void getCurrentUser()
      .then((currentUser) => {
        if (active) setUser(currentUser);
      })
      .catch((error: unknown) => {
        if (active && !isUnauthenticated(error)) {
          setMessage(getApiErrorMessage(error));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      const signedInUser = await login(
        String(form.get('identifier') ?? ''),
        String(form.get('password') ?? ''),
      );
      setUser(signedInUser);
    } catch (error) {
      setMessage(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('acceptTerms') !== 'on' || form.get('acceptPrivacy') !== 'on') {
      setMessage('Accept the Terms of Service and acknowledge the Privacy Policy to continue.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const otp = await register({
        ...registration,
        acceptTerms: true,
        acceptPrivacy: true,
      });
      setDevelopmentOtp(otp);
      setVerified({ email: false, phone: false });
      setView('verify');
      setMessage(
        'If your details are eligible, codes were sent to your email and phone. Verify both to activate your account.',
      );
    } catch (error) {
      setMessage(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleEmailVerification() {
    setBusy(true);
    setMessage('');
    try {
      await verifyEmail(registration.email, verification.email);
      setVerified((current) => ({ ...current, email: true }));
      setMessage('Email verified. Verify your mobile number to finish.');
    } catch (error) {
      setMessage(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handlePhoneVerification() {
    setBusy(true);
    setMessage('');
    try {
      await verifyPhone(registration.phone, verification.phone);
      setVerified((current) => ({ ...current, phone: true }));
      setMessage('Mobile number verified.');
    } catch (error) {
      setMessage(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setMessage('');
    try {
      await logout();
      setUser(undefined);
    } catch (error) {
      setMessage(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <section className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <div className="rounded-card border border-slate-200 bg-white p-8 shadow-soft">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-teal">
            Signed in
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-brand-navy">Welcome, {user.fullName}</h1>
          <p className="mt-3 text-slate-600">
            {user.email} · {user.phone}
          </p>
          <p className="mt-6 text-sm text-slate-500">
            Your web session uses HttpOnly cookies. Authentication tokens are not stored in browser
            local storage.
          </p>
          {message && <p className="mt-4 text-sm text-red-700">{message}</p>}
          <button
            className="mt-7 rounded-full bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-blue disabled:opacity-60"
            disabled={busy}
            onClick={() => void handleLogout()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-xl px-5 py-14 sm:px-8">
      <div className="rounded-card border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-teal">
          FamShield account
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-brand-navy">
          {view === 'verify'
            ? 'Verify your contacts'
            : view === 'register'
              ? 'Create your account'
              : 'Welcome back'}
        </h1>
        <p className="mt-3 leading-6 text-slate-600">
          {view === 'verify'
            ? 'Enter the separate one-time codes sent to your email and mobile number.'
            : 'Your account is yours. Verification is required before sign-in is enabled.'}
        </p>

        {message && (
          <p
            aria-live="polite"
            className="mt-5 rounded-xl bg-brand-mist px-4 py-3 text-sm text-brand-navy"
          >
            {message}
          </p>
        )}

        {view === 'login' && (
          <form className="mt-7 space-y-5" onSubmit={(event) => void handleLogin(event)}>
            <label className="block text-sm font-medium text-slate-700">
              Email or mobile number
              <input
                autoComplete="username"
                className="mt-2 w-full rounded-xl border-slate-300"
                name="identifier"
                placeholder="you@example.com or +14155550123"
                required
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                autoComplete="current-password"
                className="mt-2 w-full rounded-xl border-slate-300"
                name="password"
                required
                type="password"
              />
            </label>
            <button
              className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              className="w-full py-2 text-sm font-semibold text-brand-blue hover:underline"
              onClick={() => {
                setMessage('');
                setView('register');
              }}
              type="button"
            >
              Create a FamShield account
            </button>
          </form>
        )}

        {view === 'register' && (
          <form className="mt-7 space-y-4" onSubmit={(event) => void handleRegistration(event)}>
            <label className="block text-sm font-medium text-slate-700">
              Full name
              <input
                autoComplete="name"
                className="mt-2 w-full rounded-xl border-slate-300"
                maxLength={100}
                minLength={2}
                onChange={(event) =>
                  setRegistration({ ...registration, fullName: event.target.value })
                }
                required
                value={registration.fullName}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Email address
              <input
                autoComplete="email"
                className="mt-2 w-full rounded-xl border-slate-300"
                onChange={(event) =>
                  setRegistration({ ...registration, email: event.target.value })
                }
                required
                type="email"
                value={registration.email}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Mobile number with country code
              <input
                autoComplete="tel"
                className="mt-2 w-full rounded-xl border-slate-300"
                onChange={(event) =>
                  setRegistration({ ...registration, phone: event.target.value })
                }
                placeholder="+14155550123"
                required
                value={registration.phone}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                autoComplete="new-password"
                className="mt-2 w-full rounded-xl border-slate-300"
                minLength={12}
                onChange={(event) =>
                  setRegistration({ ...registration, password: event.target.value })
                }
                required
                type="password"
                value={registration.password}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Confirm password
              <input
                autoComplete="new-password"
                className="mt-2 w-full rounded-xl border-slate-300"
                onChange={(event) =>
                  setRegistration({
                    ...registration,
                    passwordConfirmation: event.target.value,
                  })
                }
                required
                type="password"
                value={registration.passwordConfirmation}
              />
            </label>
            <label className="flex items-start gap-3 text-sm leading-5 text-slate-600">
              <input
                className="mt-1 rounded border-slate-300 text-brand-teal"
                name="acceptTerms"
                required
                type="checkbox"
              />
              <span>I accept the Terms of Service.</span>
            </label>
            <label className="flex items-start gap-3 text-sm leading-5 text-slate-600">
              <input
                className="mt-1 rounded border-slate-300 text-brand-teal"
                name="acceptPrivacy"
                required
                type="checkbox"
              />
              <span>I acknowledge the Privacy Policy.</span>
            </label>
            <p className="text-xs leading-5 text-slate-500">
              Use at least 12 characters with uppercase and lowercase letters, a number, and a
              symbol. Email and phone verification are both required.
            </p>
            <button
              className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {busy ? 'Creating account…' : 'Create account'}
            </button>
            <button
              className="w-full py-2 text-sm font-semibold text-brand-blue hover:underline"
              onClick={() => {
                setMessage('');
                setView('login');
              }}
              type="button"
            >
              I already have an account
            </button>
          </form>
        )}

        {view === 'verify' && (
          <div className="mt-7 space-y-5">
            <p className="text-sm text-slate-600">
              Email: <span className="font-medium text-brand-navy">{registration.email}</span>
            </p>
            {!verified.email ? (
              <>
                <label className="block text-sm font-medium text-slate-700">
                  Email verification code
                  <input
                    autoComplete="one-time-code"
                    className="mt-2 w-full rounded-xl border-slate-300"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setVerification({ ...verification, email: event.target.value })
                    }
                    pattern="[0-9]{6}"
                    required
                    value={verification.email}
                  />
                </label>
                <button
                  className="w-full rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-brand-navy disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void handleEmailVerification()}
                  type="button"
                >
                  Verify email
                </button>
              </>
            ) : (
              <p className="text-sm font-medium text-brand-teal">Email verified</p>
            )}
            {!verified.phone ? (
              <>
                <label className="block text-sm font-medium text-slate-700">
                  Phone verification code
                  <input
                    autoComplete="one-time-code"
                    className="mt-2 w-full rounded-xl border-slate-300"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setVerification({ ...verification, phone: event.target.value })
                    }
                    pattern="[0-9]{6}"
                    required
                    value={verification.phone}
                  />
                </label>
                <button
                  className="w-full rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-brand-navy disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void handlePhoneVerification()}
                  type="button"
                >
                  Verify mobile number
                </button>
              </>
            ) : (
              <p className="text-sm font-medium text-brand-teal">Mobile number verified</p>
            )}
            {developmentOtp && (
              <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                Development-only test codes — never returned in production:
                <div className="mt-2 font-mono">
                  Email: {developmentOtp.email} · Phone: {developmentOtp.phone}
                </div>
              </aside>
            )}
            {verified.email && verified.phone && (
              <button
                className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue disabled:opacity-60"
                disabled={busy}
                onClick={() => {
                  setMessage('Both contacts are verified. You can now sign in.');
                  setView('login');
                }}
                type="button"
              >
                Continue to sign in
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
