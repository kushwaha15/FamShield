import { useCallback, useEffect, useState } from 'react';
import { AuthCard, FormFeedback } from '../components/AuthCard';
import { useAuth } from '../context/AuthContext';
import {
  getActiveSessions,
  getApiErrorMessage,
  revokeActiveSession,
  type ActiveSession,
} from '../services/api';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function SecurityPage() {
  const { signOutEverywhere } = useAuth();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySession, setBusySession] = useState('');
  const [busyEverywhere, setBusyEverywhere] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSessions(await getActiveSessions());
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function handleRevoke(session: ActiveSession) {
    const label = session.deviceInfo || 'this session';
    if (!window.confirm(`Sign out ${label}? This action cannot be undone.`)) return;
    setBusySession(session.sessionId);
    setError('');
    setSuccess('');
    try {
      await revokeActiveSession(session.sessionId);
      setSessions((current) =>
        current.filter((activeSession) => activeSession.sessionId !== session.sessionId),
      );
      setSuccess('The selected session was revoked.');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusySession('');
    }
  }

  async function handleLogoutEverywhere() {
    if (!window.confirm('Sign out all active sessions, including this browser?')) return;
    setBusyEverywhere(true);
    setError('');
    try {
      await signOutEverywhere();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusyEverywhere(false);
    }
  }

  if (loading) {
    return (
      <AuthCard title="Security and sessions" description="Loading your active sessions…">
        <div
          aria-label="Loading active sessions"
          className="h-2 animate-pulse rounded bg-brand-mist"
        />
      </AuthCard>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-teal">
            Account security
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-brand-navy">
            Active sessions
          </h1>
          <p className="mt-3 max-w-2xl leading-7 text-slate-600">
            Review sessions returned by the account service. Device details are shown only when the
            service has them.
          </p>
        </div>
        <button
          className="rounded-full border border-red-200 px-5 py-3 text-sm font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-60"
          disabled={busyEverywhere}
          onClick={() => void handleLogoutEverywhere()}
          type="button"
        >
          {busyEverywhere ? 'Signing out everywhere…' : 'Sign out everywhere'}
        </button>
      </section>

      {error && <FormFeedback kind="error">{error}</FormFeedback>}
      {success && <FormFeedback kind="success">{success}</FormFeedback>}
      {sessions.length === 0 ? (
        <div className="rounded-card border border-slate-200 bg-white p-6">
          <h2 className="font-semibold text-brand-navy">No active sessions</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The service did not return any active sessions for this account.
          </p>
        </div>
      ) : (
        <ul aria-label="Active sessions" className="space-y-3">
          {sessions.map((session) => (
            <li
              className="flex flex-col gap-4 rounded-card border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
              key={session.sessionId}
            >
              <div className="min-w-0">
                <h2 className="break-all font-semibold text-brand-navy">
                  {session.deviceInfo || 'Device details unavailable'}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Started {formatDate(session.createdAt)}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Expires {formatDate(session.expiresAt)}
                </p>
              </div>
              <button
                className="shrink-0 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-canvas disabled:opacity-60"
                disabled={Boolean(busySession)}
                onClick={() => void handleRevoke(session)}
                type="button"
              >
                {busySession === session.sessionId ? 'Revoking…' : 'Revoke session'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="text-sm font-semibold text-brand-blue hover:underline"
        onClick={() => void loadSessions()}
        type="button"
      >
        Refresh sessions
      </button>
    </div>
  );
}
