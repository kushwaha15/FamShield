# Authentication architecture

## Account and verification lifecycle

Registration validates name, normalized email, E.164 phone, password confirmation, and affirmative
Terms/Privacy acceptance. The password is bcrypt-hashed before storage. The new account remains
`pending_verification` until both independent email and phone OTPs are verified. Sensitive
authenticated endpoints require an active account.

OTP values are generated with a cryptographically secure random number generator, stored only as
HMAC-SHA-256 hashes using `AUTH_TOKEN_PEPPER`, expire after the configured short lifetime, allow
five attempts, and are limited by per-user cooldown/window plus per-IP route limits. Development OTP
response exposure requires `AUTH_DEV_OTP_EXPOSE=true`; startup rejects this setting in production.
Application logs never contain codes or destinations.

The delivery interface isolates SMS and email transport. Development mode sends nothing and only
exposes codes behind the explicit development flag. SMS may use a generic provider HTTP endpoint or
Twilio; email may use a generic provider HTTP endpoint. Production startup requires real provider
configuration. Provider payload shapes are documented in the setup guide; no external provider
account is provisioned by this repository.

## Session lifecycle

Access tokens are signed HS256 JWTs with a 15-minute lifetime, issuer, audience, user ID, and session
ID. The API checks that the account and session are still active for each authenticated request.
Refresh tokens are 48 bytes of cryptographic randomness; only an HMAC hash is stored. Rotation
atomically revokes the presented token and creates a replacement. Reuse of a previously rotated
token revokes the remaining tokens for that session. Password reset and logout-all revoke every
refresh token for the account.

- **Web:** access and refresh tokens are set only in HttpOnly, SameSite=Strict cookies. Mutating
  requests with browser cookies require a double-submit CSRF token. Tokens are not put in
  `localStorage` or exposed in JavaScript response bodies.
- **Flutter:** access and refresh tokens are stored using `flutter_secure_storage`; Dio attaches the
  access token and serializes concurrent refresh attempts.

Session listing/revocation is user-scoped. `/users/me` never accepts a caller-selected user ID.
Registration only records terms/privacy acceptance; it does not grant location consent or family
access.
