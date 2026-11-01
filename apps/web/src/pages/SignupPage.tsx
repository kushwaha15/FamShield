import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCard, FormFeedback } from '../components/AuthCard';
import { getApiErrorMessage, register } from '../services/api';

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/;

export function SignupPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get('fullName') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const phone = String(form.get('phone') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const passwordConfirmation = String(form.get('passwordConfirmation') ?? '');

    if (fullName.length < 2 || fullName.length > 100) {
      setError('Enter a name between 2 and 100 characters.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      setError('Enter a valid email address.');
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      setError('Enter a mobile number in international format, such as +14155550123.');
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
    if (form.get('acceptTerms') !== 'on' || form.get('acceptPrivacy') !== 'on') {
      setError('Accept the Terms of Service and acknowledge the Privacy Policy to continue.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const developmentOtp = await register({
        fullName,
        email,
        phone,
        password,
        passwordConfirmation,
        acceptTerms: true,
        acceptPrivacy: true,
      });
      navigate('/verify', {
        state: { email, phone, developmentOtp },
      });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      description="Set up your FamShield account. You must verify both contact methods before signing in."
      footer={
        <p className="text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link className="font-semibold text-brand-blue hover:underline" to="/login">
            Sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-4" noValidate onSubmit={(event) => void handleSubmit(event)}>
        {error && <FormFeedback kind="error">{error}</FormFeedback>}
        <label className="block text-sm font-medium text-slate-700">
          Full name
          <input
            autoComplete="name"
            className="mt-2 w-full rounded-xl border-slate-300"
            maxLength={100}
            minLength={2}
            name="fullName"
            required
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Email address
          <input
            autoComplete="email"
            className="mt-2 w-full rounded-xl border-slate-300"
            maxLength={254}
            name="email"
            required
            type="email"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Mobile number with country code
          <input
            autoComplete="tel"
            className="mt-2 w-full rounded-xl border-slate-300"
            name="phone"
            pattern="[+][1-9][0-9]{7,14}"
            placeholder="+14155550123"
            required
            title="Use an international number such as +14155550123."
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
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
          Confirm password
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
        <button
          className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthCard>
  );
}
