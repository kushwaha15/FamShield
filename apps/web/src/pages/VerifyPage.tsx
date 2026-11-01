import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, FormFeedback } from '../components/AuthCard';
import {
  getApiErrorMessage,
  resendOtp,
  verifyEmail,
  verifyPhone,
  type DevelopmentOtp,
} from '../services/api';

interface VerificationState {
  email?: string;
  phone?: string;
  developmentOtp?: DevelopmentOtp;
}

type Channel = 'email' | 'phone';

export function VerifyPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = (location.state ?? {}) as VerificationState;
  const [email, setEmail] = useState(routeState.email ?? '');
  const [phone, setPhone] = useState(routeState.phone ?? '');
  const [codes, setCodes] = useState({ email: '', phone: '' });
  const [verified, setVerified] = useState({ email: false, phone: false });
  const [developmentOtp, setDevelopmentOtp] = useState(routeState.developmentOtp);
  const [cooldowns, setCooldowns] = useState({ email: 0, phone: 0 });
  const [busy, setBusy] = useState<Channel | 'resend-email' | 'resend-phone' | undefined>();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCooldowns((current) => ({
        email: Math.max(0, current.email - 1),
        phone: Math.max(0, current.phone - 1),
      }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleVerify(channel: Channel, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(channel);
    setError('');
    setSuccess('');
    try {
      if (channel === 'email') await verifyEmail(email.trim(), codes.email);
      else await verifyPhone(phone.trim(), codes.phone);
      setVerified((current) => ({ ...current, [channel]: true }));
      setSuccess(channel === 'email' ? 'Email verified.' : 'Mobile number verified.');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(undefined);
    }
  }

  async function handleResend(channel: Channel) {
    const identifier = channel === 'email' ? email.trim() : phone.trim();
    const purpose = channel === 'email' ? 'verify_email' : 'verify_phone';
    setBusy(channel === 'email' ? 'resend-email' : 'resend-phone');
    setError('');
    setSuccess('');
    try {
      const code = await resendOtp(identifier, purpose);
      if (code) {
        setDevelopmentOtp((current) =>
          current
            ? { ...current, [channel]: code }
            : { email: channel === 'email' ? code : '', phone: channel === 'phone' ? code : '' },
        );
      }
      setCooldowns((current) => ({ ...current, [channel]: 30 }));
      setSuccess('If this contact is eligible, a new verification code has been sent.');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <AuthCard
      title="Verify your contacts"
      description="Enter the separate one-time codes sent to your email and mobile number."
      footer={
        <p className="text-center text-sm text-slate-600">
          Need to register?{' '}
          <Link className="font-semibold text-brand-blue hover:underline" to="/signup">
            Create an account
          </Link>
        </p>
      }
    >
      <div className="space-y-5">
        {!email && !phone && (
          <FormFeedback kind="info">
            Enter the email address and mobile number used during registration.
          </FormFeedback>
        )}
        {error && <FormFeedback kind="error">{error}</FormFeedback>}
        {success && <FormFeedback kind="success">{success}</FormFeedback>}
        {
          <form
            className="space-y-3 rounded-xl border border-slate-200 p-4 sm:p-5"
            onSubmit={(event) => void handleVerify('email', event)}
          >
            <label className="block text-sm font-medium text-slate-700">
              Email address
              <input
                autoComplete="email"
                className="mt-2 w-full rounded-xl border-slate-300"
                disabled={verified.email}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            {verified.email ? (
              <p className="text-sm font-medium text-emerald-700">Email verified</p>
            ) : (
              <>
                <label className="block text-sm font-medium text-slate-700">
                  Email verification code
                  <input
                    autoComplete="one-time-code"
                    className="mt-2 w-full rounded-xl border-slate-300"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setCodes((current) => ({ ...current, email: event.target.value }))
                    }
                    pattern="[0-9]{6}"
                    required
                    value={codes.email}
                  />
                </label>
                <button
                  className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={Boolean(busy)}
                  type="submit"
                >
                  {busy === 'email' ? 'Verifying…' : 'Verify email'}
                </button>
                <button
                  className="w-full py-2 text-sm font-semibold text-brand-blue hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(busy) || cooldowns.email > 0 || !email.trim()}
                  onClick={() => void handleResend('email')}
                  type="button"
                >
                  {busy === 'resend-email'
                    ? 'Sending…'
                    : cooldowns.email > 0
                      ? `Resend email code in ${cooldowns.email}s`
                      : 'Resend email code'}
                </button>
              </>
            )}
          </form>
        }
        {
          <form
            className="space-y-3 rounded-xl border border-slate-200 p-4 sm:p-5"
            onSubmit={(event) => void handleVerify('phone', event)}
          >
            <label className="block text-sm font-medium text-slate-700">
              Mobile number
              <input
                autoComplete="tel"
                className="mt-2 w-full rounded-xl border-slate-300"
                disabled={verified.phone}
                onChange={(event) => setPhone(event.target.value)}
                pattern="[+][1-9][0-9]{7,14}"
                required
                value={phone}
              />
            </label>
            {verified.phone ? (
              <p className="text-sm font-medium text-emerald-700">Mobile number verified</p>
            ) : (
              <>
                <label className="block text-sm font-medium text-slate-700">
                  Phone verification code
                  <input
                    autoComplete="one-time-code"
                    className="mt-2 w-full rounded-xl border-slate-300"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setCodes((current) => ({ ...current, phone: event.target.value }))
                    }
                    pattern="[0-9]{6}"
                    required
                    value={codes.phone}
                  />
                </label>
                <button
                  className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={Boolean(busy)}
                  type="submit"
                >
                  {busy === 'phone' ? 'Verifying…' : 'Verify mobile number'}
                </button>
                <button
                  className="w-full py-2 text-sm font-semibold text-brand-blue hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(busy) || cooldowns.phone > 0 || !phone.trim()}
                  onClick={() => void handleResend('phone')}
                  type="button"
                >
                  {busy === 'resend-phone'
                    ? 'Sending…'
                    : cooldowns.phone > 0
                      ? `Resend phone code in ${cooldowns.phone}s`
                      : 'Resend phone code'}
                </button>
              </>
            )}
          </form>
        }
        {developmentOtp && (
          <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            Development-only test codes supplied by the API:
            <div className="mt-2 font-mono">
              {developmentOtp.email && <p>Email: {developmentOtp.email}</p>}
              {developmentOtp.phone && <p>Phone: {developmentOtp.phone}</p>}
            </div>
          </aside>
        )}
        {verified.email && verified.phone && (
          <div className="space-y-3">
            <FormFeedback kind="success">
              Both contacts are verified. Your account is ready to sign in.
            </FormFeedback>
            <button
              className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue"
              onClick={() => navigate('/login', { replace: true })}
              type="button"
            >
              Continue to sign in
            </button>
          </div>
        )}
      </div>
    </AuthCard>
  );
}
