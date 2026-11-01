import { Link, Outlet } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';

export function SiteLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200/80 bg-white">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8"
        >
          <Link aria-label="FamShield home" to="/">
            <BrandMark />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              className="rounded-full px-4 py-2.5 text-sm font-semibold text-brand-navy transition hover:bg-brand-canvas"
              to="/login"
            >
              Sign in
            </Link>
            <Link
              className="rounded-full bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-blue"
              to="/signup"
            >
              Get started
            </Link>
          </div>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-7 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} FamShield</span>
          <span>Safety built on trust, choice, and consent.</span>
        </div>
      </footer>
    </div>
  );
}
