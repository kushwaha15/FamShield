import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, FormFeedback } from '../components/AuthCard';
import { getApiErrorMessage, resetPassword } from '../services/api';

interface ResetRouteState {
  identifier?: string;
  channel?: 'email' | 'phone';
  developmentOtp?: string;
}

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/;

export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = (location.state ?? {}) as ResetRouteState;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const identifier = String(form.get('identifier') ?? '').trim();
    const code = String(form.get('code') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const passwordConfirmation = String(form.get('passwordConfirmation') ?? '');
    if (
      !(identifier.includes('@')
        ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
        : /^\+[1-9]\d{7,14}$/.test(identifier))
    ) {
      setError('Enter a valid email address or international mobile number.');
      return;
    }
    if (password !== passwordConfirmation) {
      setError('Passwords do not match.');
      return;
    }
    if (!passwordPattern.test(password) || new TextEncoder().encode(password).length > 72) {
      setError(
        'Use 12–128 characters with uppercase and lowercase letters, a number, and a symbol.',
      );
      return;
    }

    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await resetPassword({ identifier, code, password, passwordConfirmation });
      setSuccess('Your password has been reset. Sign in with your new password.');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Enter the one-time code and create a new password for your account."
      footer={
        <p className="text-center text-sm text-slate-600">
          Need a new code?{' '}
          <Link className="font-semibold text-brand-blue hover:underline" to="/forgot-password">
            Request reset instructions
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        {routeState.identifier && (
          <FormFeedback kind="info">
            If the account is eligible, reset instructions have been sent to the selected contact.
          </FormFeedback>
        )}
        {error && <FormFeedback kind="error">{error}</FormFeedback>}
        {success && <FormFeedback kind="success">{success}</FormFeedback>}
        <label className="block text-sm font-medium text-slate-700">
          {routeState.channel === 'phone' ? 'Mobile number' : 'Email or mobile number'}
          <input
            autoComplete={routeState.channel === 'phone' ? 'tel' : 'username'}
            className="mt-2 w-full rounded-xl border-slate-300"
            defaultValue={routeState.identifier}
            name="identifier"
            pattern={routeState.channel === 'phone' ? '[+][1-9][0-9]{7,14}' : undefined}
            required
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          One-time code
          <input
            autoComplete="one-time-code"
            className="mt-2 w-full rounded-xl border-slate-300"
            defaultValue={routeState.developmentOtp}
            inputMode="numeric"
            maxLength={6}
            name="code"
            pattern="[0-9]{6}"
            required
          />
        </label>
        {routeState.developmentOtp && (
          <FormFeedback kind="info">
            A development test code was supplied by the API for this environment.
          </FormFeedback>
        )}
        <label className="block text-sm font-medium text-slate-700">
          New password
          <input
            autoComplete="new-password"
            className="mt-2 w-full rounded-xl border-slate-300"
            maxLength={128}
            minLength={12}
            name="password"
            required
            type="password"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Confirm new password
          <input
            autoComplete="new-password"
            className="mt-2 w-full rounded-xl border-slate-300"
            maxLength={128}
            name="passwordConfirmation"
            required
            type="password"
          />
        </label>
        <p className="text-xs leading-5 text-slate-500">
          Use 12–128 characters with uppercase and lowercase letters, a number, and a symbol.
        </p>
        <button
          className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Resetting password…' : 'Reset password'}
        </button>
        {success && (
          <button
            className="w-full rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-brand-navy hover:bg-brand-canvas"
            onClick={() => navigate('/login', { replace: true })}
            type="button"
          >
            Continue to sign in
          </button>
        )}
      </form>
    </AuthCard>
  );
}
