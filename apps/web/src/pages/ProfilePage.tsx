import { useEffect, useState, type FormEvent } from 'react';
import { AuthCard, FormFeedback } from '../components/AuthCard';
import { useAuth } from '../context/AuthContext';
import { getApiErrorMessage } from '../services/api';

export function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [profileImageUrl, setProfileImageUrl] = useState(user?.profileImageUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setFullName(user?.fullName ?? '');
    setProfileImageUrl(user?.profileImageUrl ?? '');
  }, [user?.fullName, user?.profileImageUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = fullName.trim();
    const imageUrl = profileImageUrl.trim();
    if (name.length < 2 || name.length > 100) {
      setError('Name must be between 2 and 100 characters.');
      return;
    }
    if (imageUrl) {
      try {
        if (new URL(imageUrl).protocol !== 'https:' || imageUrl.length > 2048) {
          setError('Profile image URL must be a valid HTTPS URL under 2048 characters.');
          return;
        }
      } catch {
        setError('Enter a valid HTTPS profile image URL, or leave it blank.');
        return;
      }
    }

    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await updateProfile({
        fullName: name,
        profileImageUrl: imageUrl || null,
      });
      setSuccess('Your profile has been updated.');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <AuthCard
      title="Your profile"
      description="Edit only the profile fields supported by FamShield."
    >
      <form className="space-y-5" noValidate onSubmit={(event) => void handleSubmit(event)}>
        {error && <FormFeedback kind="error">{error}</FormFeedback>}
        {success && <FormFeedback kind="success">{success}</FormFeedback>}
        <label className="block text-sm font-medium text-slate-700">
          Full name
          <input
            autoComplete="name"
            className="mt-2 w-full rounded-xl border-slate-300"
            maxLength={100}
            minLength={2}
            onChange={(event) => setFullName(event.target.value)}
            required
            value={fullName}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Email address
          <input
            className="mt-2 w-full rounded-xl border-slate-200 bg-slate-50 text-slate-500"
            readOnly
            value={user.email}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Email changes are not supported here.
          </span>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Mobile number
          <input
            className="mt-2 w-full rounded-xl border-slate-200 bg-slate-50 text-slate-500"
            readOnly
            value={user.phone}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Mobile number changes are not supported here.
          </span>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Profile image URL (optional)
          <input
            autoComplete="url"
            className="mt-2 w-full rounded-xl border-slate-300"
            maxLength={2048}
            onChange={(event) => setProfileImageUrl(event.target.value)}
            placeholder="https://example.com/image.jpg"
            type="url"
            value={profileImageUrl}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Use an HTTPS URL. Leave blank to remove the current image.
          </span>
        </label>
        <button
          className="w-full rounded-full bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Saving profile…' : 'Save changes'}
        </button>
      </form>
    </AuthCard>
  );
}
