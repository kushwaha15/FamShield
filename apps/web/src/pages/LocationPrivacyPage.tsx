import { useEffect, useState } from 'react';
import type {
  LocationSharingConsentHistoryEntry,
  LocationSharingConsentState,
} from '@famshield/shared-types';
import {
  getApiErrorMessage,
  getLocationSharingConsent,
  getLocationSharingConsentHistory,
  grantLocationSharingConsent,
  revokeLocationSharingConsent,
} from '../services/api';

function formatDate(value: string | null): string {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function LocationPrivacyPage() {
  const [consent, setConsent] = useState<LocationSharingConsentState | null>(null);
  const [history, setHistory] = useState<LocationSharingConsentHistoryEntry[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getLocationSharingConsent(), getLocationSharingConsentHistory()])
      .then(([nextConsent, nextHistory]) => {
        if (!active) return;
        setConsent(nextConsent);
        setHistory(nextHistory);
        setSelectedFamilyId((current) =>
          current && nextConsent.scopes.some((scope) => scope.familyId === current)
            ? current
            : (nextConsent.scopes[0]?.familyId ?? ''),
        );
        setError('');
      })
      .catch((requestError: unknown) => {
        if (active) setError(getApiErrorMessage(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  async function handleGrant() {
    if (!consent || !selectedFamilyId || !confirmed) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await grantLocationSharingConsent(selectedFamilyId, consent.policyVersion);
      setMessage(`Consent enabled for ${result.familyName}.`);
      setConfirmed(false);
      setReloadKey((value) => value + 1);
    } catch (requestError) {
      setConfirmed(false);
      setError(getApiErrorMessage(requestError));
      setReloadKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(familyId: string, familyName: string) {
    if (!window.confirm(`Revoke location-sharing consent for ${familyName}?`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await revokeLocationSharingConsent(familyId);
      setMessage(`Consent revoked for ${familyName}.`);
      setReloadKey((value) => value + 1);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
      setReloadKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  const selectedScope = consent?.scopes.find((scope) => scope.familyId === selectedFamilyId);
  const panelClass = 'rounded-card border border-slate-200 bg-white p-5 sm:p-6';
  const buttonClass =
    'rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="space-y-7">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-teal">
          Privacy controls
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-brand-navy">
          Location sharing
        </h1>
        <p className="mt-2 max-w-3xl leading-7 text-slate-600">
          Consent is separate for each family and is always controlled by you.
        </p>
      </header>

      {error && (
        <p
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
          role="status"
        >
          {message}
        </p>
      )}

      {loading ? (
        <p aria-label="Loading consent information" className="py-8 text-slate-600" role="status">
          Loading privacy settings…
        </p>
      ) : (
        <>
          <section aria-labelledby="consent-details" className={panelClass}>
            <h2 className="text-lg font-semibold text-brand-navy" id="consent-details">
              What this consent means
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
              <li>
                If location sharing is built in later, it may share your precise location with
                active members of only the family you choose.
              </li>
              <li>
                This phase does not request device location permissions, collect GPS coordinates, or
                transmit location data.
              </li>
              <li>
                Family owners cannot enable consent for you. You can revoke your consent at any
                time; revocation immediately disables this authorization.
              </li>
            </ul>
          </section>

          <section aria-labelledby="consent-status" className={panelClass}>
            <h2 className="text-lg font-semibold text-brand-navy" id="consent-status">
              Current consent by family
            </h2>
            {!consent?.scopes.length ? (
              <p className="mt-3 text-sm text-slate-600">
                You are not currently an active member of any family. Joining a family will not
                enable location sharing.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {consent.scopes.map((scope) => (
                  <li
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                    key={scope.familyId}
                  >
                    <div>
                      <p className="font-semibold text-brand-navy">{scope.familyName}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {scope.enabled
                          ? `Enabled since ${formatDate(scope.grantedAt ?? null)}`
                          : scope.needsReview
                            ? 'Policy updated — review required'
                            : 'Off'}
                      </p>
                    </div>
                    {scope.enabled || scope.needsReview ? (
                      <button
                        className="rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60"
                        disabled={busy}
                        onClick={() => void handleRevoke(scope.familyId, scope.familyName)}
                        type="button"
                      >
                        {scope.enabled ? 'Revoke' : 'Clear old consent'}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {consent?.scopes.length ? (
            <section aria-labelledby="enable-consent" className={panelClass}>
              <h2 className="text-lg font-semibold text-brand-navy" id="enable-consent">
                Enable sharing for a family
              </h2>
              <label
                className="mt-4 block text-sm font-medium text-slate-700"
                htmlFor="family-scope"
              >
                Family
              </label>
              <select
                className="mt-2 w-full rounded-xl border-slate-300 text-slate-900 focus:border-brand-teal focus:ring-brand-teal"
                id="family-scope"
                onChange={(event) => {
                  setSelectedFamilyId(event.target.value);
                  setConfirmed(false);
                }}
                value={selectedFamilyId}
              >
                {consent.scopes.map((scope) => (
                  <option key={scope.familyId} value={scope.familyId}>
                    {scope.familyName}
                  </option>
                ))}
              </select>
              <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-slate-700">
                <input
                  checked={confirmed}
                  className="mt-1 rounded border-slate-300 text-brand-teal focus:ring-brand-teal"
                  onChange={(event) => setConfirmed(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I understand that this explicitly authorizes future location sharing with active
                  members of {selectedScope?.familyName ?? 'this family'}, and I can revoke it at
                  any time.
                </span>
              </label>
              <button
                className={`${buttonClass} mt-5`}
                disabled={!confirmed || !selectedFamilyId || selectedScope?.enabled || busy}
                onClick={() => void handleGrant()}
                type="button"
              >
                {busy ? 'Saving…' : 'Enable location-sharing consent'}
              </button>
            </section>
          ) : null}

          <section aria-labelledby="consent-history" className={panelClass}>
            <h2 className="text-lg font-semibold text-brand-navy" id="consent-history">
              Consent history
            </h2>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">
                No location-sharing consent changes yet.
              </p>
            ) : (
              <ol className="mt-3 divide-y divide-slate-100">
                {history.map((entry) => {
                  const familyName = consent?.scopes.find(
                    (scope) => scope.familyId === entry.familyId,
                  )?.familyName;
                  return (
                    <li className="py-4 text-sm" key={entry.id}>
                      <p className="font-semibold capitalize text-brand-navy">
                        {entry.status === 'inactive' ? 'Not enabled' : entry.status}
                      </p>
                      <p className="mt-1 text-slate-600">
                        {familyName ?? 'Former or unavailable family'} · Policy{' '}
                        {entry.policyVersion}
                      </p>
                      <p className="mt-1 text-slate-500">
                        {entry.status === 'granted'
                          ? `Granted ${formatDate(entry.grantedAt)}`
                          : entry.status === 'revoked'
                            ? `Revoked ${formatDate(entry.revokedAt)}`
                            : `Recorded ${formatDate(entry.recordedAt)}`}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
