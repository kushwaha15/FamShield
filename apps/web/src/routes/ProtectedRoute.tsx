import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthCard, FormFeedback } from '../components/AuthCard';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute() {
  const { status, error, reloadUser } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <AuthCard title="Loading your account" description="Checking your secure FamShield session…">
        <div aria-label="Loading account" className="h-2 animate-pulse rounded bg-brand-mist" />
      </AuthCard>
    );
  }

  if (status === 'error') {
    return (
      <AuthCard
        title="We couldn’t load your account"
        description="Your session could not be checked."
      >
        <FormFeedback kind="error">{error ?? 'Please try again.'}</FormFeedback>
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

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
