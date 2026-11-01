import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { FormFeedback } from '../components/AuthCard';
import { useAuth } from '../context/AuthContext';
import { getApiErrorMessage } from '../services/api';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-2 text-sm font-semibold transition ${
    isActive
      ? 'bg-brand-mist text-brand-navy'
      : 'text-slate-600 hover:bg-brand-canvas hover:text-brand-navy'
  }`;

export function DashboardLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSignOut() {
    setBusy(true);
    setError('');
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-brand-canvas">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-4">
            <Link aria-label="FamShield dashboard" to="/dashboard">
              <BrandMark />
            </Link>
            <span className="max-w-[12rem] truncate text-sm font-medium text-slate-600 lg:hidden">
              {user?.fullName}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Account navigation" className="flex flex-wrap items-center gap-1">
              <NavLink className={navLinkClass} end to="/dashboard">
                Overview
              </NavLink>
              <NavLink className={navLinkClass} to="/dashboard/profile">
                Profile
              </NavLink>
              <NavLink className={navLinkClass} to="/dashboard/security">
                Security
              </NavLink>
              <NavLink className={navLinkClass} to="/dashboard/families">
                Families
              </NavLink>
              <NavLink className={navLinkClass} to="/dashboard/privacy">
                Location sharing
              </NavLink>
            </nav>
            <div className="flex items-center gap-3">
              <span className="hidden max-w-48 truncate text-sm text-slate-600 lg:inline">
                {user?.fullName}
              </span>
              <button
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-brand-navy transition hover:bg-brand-canvas disabled:opacity-60"
                disabled={busy}
                onClick={() => void handleSignOut()}
                type="button"
              >
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
          {error && <FormFeedback kind="error">{error}</FormFeedback>}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-6 text-sm text-slate-500 sm:px-8">
          Family membership never enables location sharing. Location features are not part of this
          dashboard.
        </div>
      </footer>
    </div>
  );
}
