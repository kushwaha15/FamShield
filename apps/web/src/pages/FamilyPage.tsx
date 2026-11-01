import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { FamilyInvitationDetails, FamilyMemberDetails, FamilySummary } from '../services/api';
import {
  acceptFamilyInvitation,
  createFamily,
  createFamilyInvitation,
  declineFamilyInvitation,
  getApiErrorMessage,
  getFamilies,
  getFamilyInvitations,
  getFamilyMembers,
  getMyInvitations,
  leaveFamily,
  removeFamilyMember,
  revokeFamilyInvitation,
  transferFamilyOwnership,
} from '../services/api';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function FamilyPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const invitationToken = new URLSearchParams(location.hash.slice(1)).get('token');
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [members, setMembers] = useState<FamilyMemberDetails[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<FamilyInvitationDetails[]>([]);
  const [myInvitations, setMyInvitations] = useState<FamilyInvitationDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [contact, setContact] = useState('');
  const [contactType, setContactType] = useState<'email' | 'phone'>('email');
  const [transferTarget, setTransferTarget] = useState('');
  const [createdLink, setCreatedLink] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const selectedFamily = families.find((family) => family.id === selectedId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getFamilies(), getMyInvitations()])
      .then(([nextFamilies, nextInvitations]) => {
        if (!active) return;
        setFamilies(nextFamilies);
        setMyInvitations(nextInvitations);
        setSelectedId((current) =>
          current && nextFamilies.some((family) => family.id === current)
            ? current
            : (nextFamilies[0]?.id ?? ''),
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

  useEffect(() => {
    if (!selectedId) {
      setMembers([]);
      setPendingInvitations([]);
      return;
    }
    let active = true;
    setDetailsLoading(true);
    const family = families.find((item) => item.id === selectedId);
    const requests: [Promise<FamilyMemberDetails[]>, Promise<FamilyInvitationDetails[]>] = [
      getFamilyMembers(selectedId),
      family?.role === 'owner' ? getFamilyInvitations(selectedId) : Promise.resolve([]),
    ];
    Promise.all(requests)
      .then(([nextMembers, nextInvitations]) => {
        if (!active) return;
        setMembers(nextMembers);
        setPendingInvitations(nextInvitations);
        setTransferTarget(nextMembers.find((member) => member.role === 'member')?.userId ?? '');
      })
      .catch((requestError: unknown) => {
        if (active) setError(getApiErrorMessage(requestError));
      })
      .finally(() => {
        if (active) setDetailsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [families, selectedId, reloadKey]);

  async function refresh() {
    setReloadKey((value) => value + 1);
  }

  async function handleCreateFamily(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const family = await createFamily(familyName.trim());
      setFamilyName('');
      setFamilies((current) => [family, ...current]);
      setSelectedId(family.id);
      setSuccess('Your family has been created.');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFamily) return;
    setBusy(true);
    setError('');
    setSuccess('');
    setCreatedLink('');
    try {
      const result = await createFamilyInvitation(
        selectedFamily.id,
        contactType === 'email' ? { email: contact.trim() } : { phone: contact.trim() },
      );
      const url = new URL('/dashboard/families', window.location.origin);
      url.hash = new URLSearchParams({ token: result.token }).toString();
      setCreatedLink(url.toString());
      setContact('');
      setSuccess('Invitation created. Copy this link now; it will not be shown again.');
      await refresh();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyLink() {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopyMessage('Invitation link copied.');
    } catch {
      setCopyMessage('Copy was unavailable. Select and copy the link manually.');
    }
  }

  async function handleAcceptInvitation() {
    if (!invitationToken) return;
    setBusy(true);
    setError('');
    try {
      const family = await acceptFamilyInvitation(invitationToken);
      setSuccess(`You joined ${family.name}.`);
      setSelectedId(family.id);
      navigate('/dashboard/families', { replace: true });
      setReloadKey((value) => value + 1);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeclineInvitation() {
    if (!invitationToken) return;
    setBusy(true);
    setError('');
    try {
      await declineFamilyInvitation(invitationToken);
      setSuccess('The invitation was declined.');
      navigate('/dashboard/families', { replace: true });
      setReloadKey((value) => value + 1);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(invitationId: string) {
    if (
      !selectedFamily ||
      !window.confirm('Revoke this invitation? The invitation link will stop working.')
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await revokeFamilyInvitation(selectedFamily.id, invitationId);
      setSuccess('The invitation was revoked.');
      await refresh();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(member: FamilyMemberDetails) {
    if (
      !selectedFamily ||
      !window.confirm(`Remove ${member.fullName} from ${selectedFamily.name}?`)
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await removeFamilyMember(selectedFamily.id, member.userId);
      setSuccess(`${member.fullName} was removed from the family.`);
      await refresh();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    if (
      !selectedFamily ||
      !window.confirm(`Leave ${selectedFamily.name}? You will need a new invitation to rejoin.`)
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await leaveFamily(selectedFamily.id);
      setSuccess('You left the family.');
      setSelectedId('');
      await refresh();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function handleTransferOwnership() {
    if (!selectedFamily || !transferTarget) return;
    const target = members.find((member) => member.userId === transferTarget);
    if (
      !target ||
      !window.confirm(
        `Transfer ownership of ${selectedFamily.name} to ${target.fullName}? You will become a member.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await transferFamilyOwnership(selectedFamily.id, transferTarget);
      setSuccess(`Ownership was transferred to ${target.fullName}.`);
      await refresh();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  const owner = selectedFamily?.role === 'owner';
  const actionClass =
    'rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue disabled:cursor-not-allowed disabled:opacity-60';
  const panelClass = 'rounded-card border border-slate-200 bg-white p-5 sm:p-6';

  return (
    <div className="space-y-7">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-teal">
          Family management
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-brand-navy">
          Your families
        </h1>
        <p className="mt-2 max-w-2xl leading-7 text-slate-600">
          Manage membership and invitations. Joining a family never enables location sharing.
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
      {success && (
        <p
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
          role="status"
        >
          {success}
        </p>
      )}

      {invitationToken && (
        <section aria-labelledby="invitation-link-title" className={panelClass}>
          <h2 className="text-lg font-semibold text-brand-navy" id="invitation-link-title">
            You have an invitation link
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Accepting joins the family but does not enable location sharing. The invitation must
            match your verified email address or phone number.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className={actionClass}
              disabled={busy}
              onClick={() => void handleAcceptInvitation()}
              type="button"
            >
              {busy ? 'Working…' : 'Accept invitation'}
            </button>
            <button
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60"
              disabled={busy}
              onClick={() => void handleDeclineInvitation()}
              type="button"
            >
              Decline
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p aria-label="Loading families" className="py-8 text-slate-600" role="status">
          Loading families…
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2fr)]">
          <aside className="space-y-5">
            <section aria-labelledby="family-list-title" className={panelClass}>
              <h2 className="text-lg font-semibold text-brand-navy" id="family-list-title">
                Family groups
              </h2>
              {families.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">You haven’t joined a family yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {families.map((family) => (
                    <li key={family.id}>
                      <button
                        aria-current={family.id === selectedId ? 'true' : undefined}
                        className={`w-full rounded-xl px-4 py-3 text-left ${
                          family.id === selectedId
                            ? 'bg-brand-mist text-brand-navy'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                        onClick={() => setSelectedId(family.id)}
                        type="button"
                      >
                        <span className="block font-semibold">{family.name}</span>
                        <span className="mt-1 block text-xs capitalize text-slate-500">
                          {family.role}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="create-family-title" className={panelClass}>
              <h2 className="text-lg font-semibold text-brand-navy" id="create-family-title">
                Create a family
              </h2>
              <form className="mt-4 space-y-3" onSubmit={(event) => void handleCreateFamily(event)}>
                <label className="block text-sm font-medium text-slate-700" htmlFor="family-name">
                  Family name
                </label>
                <input
                  autoComplete="off"
                  className="w-full rounded-xl border-slate-300"
                  id="family-name"
                  maxLength={100}
                  minLength={2}
                  onChange={(event) => setFamilyName(event.target.value)}
                  required
                  value={familyName}
                />
                <button className={actionClass} disabled={busy} type="submit">
                  Create family
                </button>
              </form>
            </section>
          </aside>

          <div className="space-y-5">
            {myInvitations.length > 0 && (
              <section aria-labelledby="received-invitations-title" className={panelClass}>
                <h2
                  className="text-lg font-semibold text-brand-navy"
                  id="received-invitations-title"
                >
                  Invitations for you
                </h2>
                <ul className="mt-3 space-y-3">
                  {myInvitations.map((invitation) => (
                    <li className="border-t border-slate-100 pt-3" key={invitation.id}>
                      <p className="font-medium text-brand-navy">{invitation.family?.name}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        Invited by {invitation.inviterName}; expires{' '}
                        {formatDate(invitation.expiresAt)}. Open the original invitation link to
                        accept or decline.
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!selectedFamily ? (
              <section className={panelClass}>
                <h2 className="text-lg font-semibold text-brand-navy">No family selected</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Create a family or accept an invitation link to get started.
                </p>
              </section>
            ) : detailsLoading ? (
              <p aria-label="Loading family details" className="py-8 text-slate-600" role="status">
                Loading family details…
              </p>
            ) : (
              <>
                <section aria-labelledby="family-details-title" className={panelClass}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2
                        className="text-xl font-semibold text-brand-navy"
                        id="family-details-title"
                      >
                        {selectedFamily.name}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {members.length} active {members.length === 1 ? 'member' : 'members'} ·{' '}
                        {owner ? 'Owner' : 'Member'}
                      </p>
                    </div>
                    {!owner && (
                      <button
                        className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-brand-navy"
                        disabled={busy}
                        onClick={() => void handleLeave()}
                        type="button"
                      >
                        Leave family
                      </button>
                    )}
                  </div>
                  <ul aria-label="Active family members" className="mt-5 divide-y divide-slate-100">
                    {members.map((member) => (
                      <li
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                        key={member.userId}
                      >
                        <div>
                          <p className="font-medium text-brand-navy">{member.fullName}</p>
                          <p className="text-sm capitalize text-slate-500">
                            {member.role} · joined {formatDate(member.joinedAt)}
                          </p>
                        </div>
                        {owner && member.role === 'member' && (
                          <button
                            className="text-sm font-semibold text-red-700 hover:underline"
                            disabled={busy}
                            onClick={() => void handleRemoveMember(member)}
                            type="button"
                          >
                            Remove member
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>

                {owner && (
                  <>
                    <section aria-labelledby="invite-member-title" className={panelClass}>
                      <h2
                        className="text-lg font-semibold text-brand-navy"
                        id="invite-member-title"
                      >
                        Invite a member
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        A one-time invitation link is displayed once. Share it only with the
                        intended person.
                      </p>
                      <form
                        className="mt-4 space-y-3"
                        onSubmit={(event) => void handleCreateInvitation(event)}
                      >
                        <label
                          className="block text-sm font-medium text-slate-700"
                          htmlFor="invite-contact-type"
                        >
                          Invite using
                        </label>
                        <select
                          className="w-full rounded-xl border-slate-300 sm:max-w-xs"
                          id="invite-contact-type"
                          onChange={(event) =>
                            setContactType(event.target.value as 'email' | 'phone')
                          }
                          value={contactType}
                        >
                          <option value="email">Verified email address</option>
                          <option value="phone">Verified phone number</option>
                        </select>
                        <label
                          className="block text-sm font-medium text-slate-700"
                          htmlFor="invite-contact"
                        >
                          {contactType === 'email'
                            ? 'Email address'
                            : 'Phone number in E.164 format'}
                        </label>
                        <input
                          autoComplete="off"
                          className="w-full rounded-xl border-slate-300"
                          id="invite-contact"
                          onChange={(event) => setContact(event.target.value)}
                          required
                          type={contactType === 'email' ? 'email' : 'tel'}
                          value={contact}
                        />
                        <button className={actionClass} disabled={busy} type="submit">
                          Create invitation
                        </button>
                      </form>
                      {createdLink && (
                        <div className="mt-4 space-y-2">
                          <label
                            className="block text-sm font-medium text-slate-700"
                            htmlFor="created-invitation-link"
                          >
                            Copyable invitation link
                          </label>
                          <input
                            className="w-full rounded-xl border-slate-300 text-sm"
                            id="created-invitation-link"
                            readOnly
                            value={createdLink}
                          />
                          <button
                            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold"
                            onClick={() => void handleCopyLink()}
                            type="button"
                          >
                            Copy link
                          </button>
                          {copyMessage && <p role="status">{copyMessage}</p>}
                        </div>
                      )}
                    </section>

                    <section aria-labelledby="pending-invitations-title" className={panelClass}>
                      <h2
                        className="text-lg font-semibold text-brand-navy"
                        id="pending-invitations-title"
                      >
                        Pending invitations
                      </h2>
                      {pendingInvitations.length === 0 ? (
                        <p className="mt-2 text-sm text-slate-600">No pending invitations.</p>
                      ) : (
                        <ul className="mt-3 divide-y divide-slate-100">
                          {pendingInvitations.map((invitation) => (
                            <li
                              className="flex flex-wrap items-center justify-between gap-3 py-3"
                              key={invitation.id}
                            >
                              <div>
                                <p className="font-medium text-brand-navy">
                                  {invitation.inviteeEmail ?? invitation.inviteePhone}
                                </p>
                                <p className="text-sm text-slate-500">
                                  Expires {formatDate(invitation.expiresAt)}
                                </p>
                              </div>
                              <button
                                className="text-sm font-semibold text-red-700 hover:underline"
                                disabled={busy}
                                onClick={() => void handleRevoke(invitation.id)}
                                type="button"
                              >
                                Revoke
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    {members.some((member) => member.role === 'member') && (
                      <section aria-labelledby="transfer-ownership-title" className={panelClass}>
                        <h2
                          className="text-lg font-semibold text-brand-navy"
                          id="transfer-ownership-title"
                        >
                          Transfer ownership
                        </h2>
                        <p className="mt-1 text-sm text-slate-600">
                          The selected active member will become the owner; you will remain a
                          member.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <label className="sr-only" htmlFor="ownership-target">
                            New family owner
                          </label>
                          <select
                            className="min-w-52 rounded-xl border-slate-300"
                            id="ownership-target"
                            onChange={(event) => setTransferTarget(event.target.value)}
                            value={transferTarget}
                          >
                            {members
                              .filter((member) => member.role === 'member')
                              .map((member) => (
                                <option key={member.userId} value={member.userId}>
                                  {member.fullName}
                                </option>
                              ))}
                          </select>
                          <button
                            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold"
                            disabled={busy || !transferTarget}
                            onClick={() => void handleTransferOwnership()}
                            type="button"
                          >
                            Transfer ownership
                          </button>
                        </div>
                      </section>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
