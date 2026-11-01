import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="mx-auto flex min-h-[65vh] max-w-7xl flex-col items-center justify-center px-5 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-teal">404</p>
      <h1 className="mt-3 text-3xl font-semibold text-brand-navy">We can’t find that page</h1>
      <p className="mt-3 max-w-md text-slate-600">
        The link may be incorrect, or the page may have moved.
      </p>
      <Link
        className="mt-7 rounded-full bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-blue"
        to="/"
      >
        Back to FamShield
      </Link>
    </section>
  );
}
