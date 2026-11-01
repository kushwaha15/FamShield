import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCard, FormFeedback } from '../components/AuthCard';
import { getApiErrorMessage, requestPasswordReset } from '../services/api';

type ResetChannel = 'email' | 'phone';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<ResetChannel>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const identifier = String(form.get('identifier') ?? '').trim();
    setBusy(true);
    setError('');
    try {
      const developmentOtp = await requestPasswordReset(identifier, channel);
      navigate('/reset-password', {
        state: { identifier, channel, developmentOtp },
      });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Request password-reset instructions using a verified contact method."
      footer={
        <p className="text-center text-sm text-slate-600">
          Remembered your password?{' '}
          <Link className="font-semibold text-brand-blue hover:underline" to="/login">
            Sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
        {error && <FormFeedback kind="error">{error}</FormFeedback>}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-slate-700">Send instructions to</legend>
          <label className="flex items-center gap-3 text-sm text-slate-700">
            <input
              checked={channel === 'email'}
              className="text-brand-teal"
              name="channel"
              onChange={() => setChannel('email')}
              type="radio"
              value="email"
            />
            Email
          </label>
          <label className="flex items-center gap-3 text-sm text-slate-700">
            <input
              checked={channel === 'phone'}
              className="text-brand-teal"
              name="channel"
              onChange={() => setChannel('phone')}
              type="radio"
              value="phone"
            />
            Mobile number
          </label>
        </fieldset>
        <label className="block text-sm font-medium text-slate-700">
          {channel === 'email' ? 'Email address' : 'Mobile number with country code'}
          <input
            autoComplete={channel === 'email' ? 'email' : 'tel'}
            className="mt-2 w-full rounded-xl border-slate-300"
            name="identifier"
            pattern={channel === 'phone' ? '[+][1-9][0-9]{7,14}' : undefined}
            placeholder={channel === 'email' ? 'you@example.com' : '+14155550123'}
            required
            type={channel === 'email' ? 'email' : 'tel'}
          />
        </label>
        <button
          className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Requesting…' : 'Send reset instructions'}
        </button>
      </form>
    </AuthCard>
  );
}
