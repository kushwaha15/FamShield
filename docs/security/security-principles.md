# Security principles

## Implemented controls

- Never commit secrets; `.env` files are ignored and `.env.example` contains placeholders only.
- Validate API environment configuration at startup and fail explicitly on invalid values.
- Apply Helmet security headers, restrict CORS to configured origins, cap JSON request size, and
  omit query strings and request bodies from request logs.
- Validate API requests with Zod; use typed Drizzle queries and parameterized PostgreSQL statements
  rather than passing request objects into database queries.
- Hash passwords with bcrypt. OTP values and refresh tokens are HMAC-hashed at rest and are never
  included in production responses or application logs.
- Rate-limit API/authentication routes, limit OTP attempts and resends, and use generic registration,
  login, resend, and password-reset responses to reduce account enumeration.
- Rotate refresh tokens, detect replay, revoke sessions on logout/password reset, and require
  verified email and phone before enabling sign-in.
- Use HttpOnly SameSite cookies plus double-submit CSRF checks for browser mutations; mobile tokens
  use platform secure storage. Browser tokens are not stored in `localStorage`.
- Emit security audit events without passwords, codes, tokens, phone numbers, or email addresses.
- Health responses report readiness without exposing environment values, database URLs, or secrets.
- Enable PostgreSQL Row Level Security on account and authentication tables, deny direct Supabase
  API-role access, and scope backend profile/session queries to the authenticated user.
- The API does not log passwords, tokens, or precise GPS coordinates.
- No location collection or privilege bypass is implemented.

## Requirements for future phases

1. Require informed, affirmative, purpose-specific location consent before collection; display
   active sharing and provide immediate pause and revocation.
2. Before adding family access, authorize every sensitive operation against membership and
   purpose-specific consent. Never rely on client-side controls alone.
3. Use HTTPS in production, secure password hashing, short-lived credentials, and protected secret
   storage; never store plaintext passwords.
4. Minimize location precision, retention, access, and logging. Do not expose location data publicly.
5. Use least privilege for operators and services. No administrator tracking bypasses.
6. Separate development, test, and production configuration and data.
7. Review dependency updates, threat models, abuse cases, and privacy impact before release.
8. Configure real SMS/email delivery, Supabase PostgreSQL networking, secret management, observability,
   and operational incident response before production.

## Reporting

Do not include credentials, access tokens, or personal location data in bug reports or logs.
Production launch requires a separate security review and operational incident-response plan.
