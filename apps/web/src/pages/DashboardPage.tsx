import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function StatusBadge({ verified }: { verified: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        verified ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
      }`}
    >
      {verified ? 'Verified' : 'Not verified'}
    </span>
  );
}

export function DashboardPage() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-teal">
          Account overview
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
          Welcome, {user.fullName}
        </h1>
        <p className="mt-3 max-w-2xl leading-7 text-slate-600">
          Manage your FamShield account, security preferences, and family memberships. Location
          activity is not available here.
        </p>
      </section>

      <section aria-labelledby="account-summary-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-brand-navy" id="account-summary-title">
              Account information
            </h2>
            <p className="mt-1 text-sm text-slate-500">Your profile details from FamShield.</p>
          </div>
          <Link
            className="text-sm font-semibold text-brand-blue hover:underline"
            to="/dashboard/profile"
          >
            Edit profile
          </Link>
          <Link
            className="rounded-card border border-slate-200 bg-white p-5 transition hover:border-brand-teal focus-visible:outline-brand-teal"
            to="/dashboard/families"
          >
            <h3 className="font-semibold text-brand-navy">Family management</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Create a family, manage members, or respond to an invitation.
            </p>
          </Link>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-slate-200 bg-white p-5">
            <dt className="text-sm text-slate-500">Full name</dt>
            <dd className="mt-1 font-semibold text-brand-navy">{user.fullName}</dd>
          </div>
          <div className="rounded-card border border-slate-200 bg-white p-5">
            <dt className="text-sm text-slate-500">Email address</dt>
            <dd className="mt-1 break-all font-semibold text-brand-navy">{user.email}</dd>
            <dd className="mt-2">
              <StatusBadge verified={user.emailVerified} />
            </dd>
          </div>
          <div className="rounded-card border border-slate-200 bg-white p-5">
            <dt className="text-sm text-slate-500">Mobile number</dt>
            <dd className="mt-1 font-semibold text-brand-navy">{user.phone}</dd>
            <dd className="mt-2">
              <StatusBadge verified={user.phoneVerified} />
            </dd>
          </div>
          <div className="rounded-card border border-slate-200 bg-white p-5">
            <dt className="text-sm text-slate-500">Account status</dt>
            <dd className="mt-1 font-semibold capitalize text-brand-navy">
              {user.status.replaceAll('_', ' ')}
            </dd>
            <dd className="mt-2 text-sm text-slate-500">Created {formatDate(user.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="account-actions-title">
        <h2 className="text-xl font-semibold text-brand-navy" id="account-actions-title">
          Account and security
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Link
            className="rounded-card border border-slate-200 bg-white p-5 transition hover:border-brand-teal focus-visible:outline-brand-teal"
            to="/dashboard/profile"
          >
            <h3 className="font-semibold text-brand-navy">Profile</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Update your name and optional profile image URL.
            </p>
          </Link>
          <Link
            className="rounded-card border border-slate-200 bg-white p-5 transition hover:border-brand-teal focus-visible:outline-brand-teal"
            to="/dashboard/security"
          >
            <h3 className="font-semibold text-brand-navy">Security and sessions</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Review active sessions and sign out devices or sessions.
            </p>
          </Link>
        </div>
      </section>
    </div>
  );
}
