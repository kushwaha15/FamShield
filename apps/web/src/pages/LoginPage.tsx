import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, FormFeedback } from '../components/AuthCard';
import { useAuth } from '../context/AuthContext';
import { getApiErrorMessage } from '../services/api';

export function LoginPage() {
  const { error: sessionError, reloadUser, status, signIn, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const identifier = String(form.get('identifier') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (!identifier || !password) {
      setError('Enter your email or mobile number and password.');
      return;
    }
    if (
      !(identifier.includes('@')
        ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
        : /^\+[1-9]\d{7,14}$/.test(identifier))
    ) {
      setError('Enter a valid email address or international mobile number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(identifier, password);
      const state = location.state as { from?: { pathname?: string } } | null;
      navigate(state?.from?.pathname ?? '/dashboard', { replace: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  if (status === 'loading') {
    return (
      <AuthCard title="Welcome back" description="Checking your secure session…">
        <div aria-label="Loading session" className="h-2 animate-pulse rounded bg-brand-mist" />
      </AuthCard>
    );
  }

  if (status === 'error') {
    return (
      <AuthCard title="Sign in unavailable" description="We couldn’t verify your current session.">
        <FormFeedback kind="error">
          {sessionError ??
            'The service could not check your account. Please refresh and try again.'}
        </FormFeedback>
        <button
          className="mt-5 w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue"
          onClick={() => void reloadUser()}
          type="button"
        >
          Try again
        </button>
      </AuthCard>
    );
  }

  if (status === 'authenticated' && user) return <Navigate to="/dashboard" replace />;

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your account using your verified email address or mobile number."
      footer={
        <p className="text-center text-sm text-slate-600">
          New to FamShield?{' '}
          <Link className="font-semibold text-brand-blue hover:underline" to="/signup">
            Create an account
          </Link>
        </p>
      }
    >
      <form className="space-y-5" noValidate onSubmit={(event) => void handleSubmit(event)}>
        {error && <FormFeedback kind="error">{error}</FormFeedback>}
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
        <div className="text-right">
          <Link
            className="text-sm font-medium text-brand-blue hover:underline"
            to="/forgot-password"
          >
            Forgot password?
          </Link>
        </div>
        <button
          className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  );
}
