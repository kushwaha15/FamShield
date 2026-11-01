# Authentication database schema

The PostgreSQL schema is defined in `services/api/src/db/schema.ts` and deployed with the
version-controlled SQL migration `services/api/drizzle/0001_authentication.sql`. Tables use UUID
primary keys, foreign keys with account-scoped cascading deletion, check constraints, indexes, and
database-managed update timestamps. Row Level Security is enabled on all four tables; direct
Supabase API-role access is denied. Auth data is accessed only through the backend's private
`DATABASE_URL`.

## User

`fullName`, normalized unique `email`, E.164 unique `phone`, hidden `passwordHash`, email/phone
verification flags, account status (`pending_verification`, `active`, `suspended`), optional HTTPS
profile image URL, `createdAt`, and `updatedAt`.

## RefreshToken

Reference to user, session UUID, unique token HMAC hash, expiry, revocation timestamp, replacement
token hash, optional device information, and timestamps. Expired sessions are purged hourly by the
API maintenance task.

## OTPVerification

Reference to user, purpose (`verify_email`, `verify_phone`, `reset_password`), HMAC hash, expiry,
purge timestamp, attempt count, status, and timestamps. The purge index retains enough history for
the OTP-send rate window; expired history is removed during OTP issuance and hourly maintenance.

## Consent

Reference to user, consent type, granted state, grant/revocation timestamps, version, and
timestamps. Registration records affirmative Terms of Service and Privacy Policy acceptance.
Location sharing remains unimplemented and is never enabled by account registration.

There are no family, location, or emergency database models in Phase 2.
