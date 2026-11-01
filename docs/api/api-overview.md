# API overview

Base path: `/api`. Authentication and profile endpoints are documented in the OpenAPI 3.1
specification at `docs/api/openapi.yaml`.

## Health

`GET /api/health` returns service identity, timestamp, and PostgreSQL readiness. It returns HTTP 200
when the configured database is connected, or HTTP 503 with a degraded status when PostgreSQL is not
configured or connected. It does not disclose environment variables or connection details.

Example:

```json
{
  "data": {
    "status": "degraded",
    "service": "famshield-api",
    "database": "disconnected",
    "timestamp": "2026-01-01T00:00:00.000Z"
  }
}
```

## Shared contracts

Registration accepts `fullName`, `email`, E.164 `phone`, `password`,
`passwordConfirmation`, `acceptTerms: true`, and `acceptPrivacy: true`. Passwords must be at least
12 characters, include uppercase and lowercase letters, a number, and a symbol, and fit bcrypt's
72-byte limit. The response is generic (`202`) to reduce account enumeration.

Email and phone verification use separate six-digit OTPs. OTPs expire, allow five attempts, and are
rate-limited. Accounts cannot sign in until both contacts are verified.

`POST /api/auth/login` takes `identifier` (email or E.164 phone), `password`, and optional
`clientType` (`web` or `mobile`):

- `web`: response includes the public `user`; access/refresh tokens are HttpOnly cookies and are
  never returned in JavaScript-readable JSON. Send `X-CSRF-Token` for state-changing requests.
- `mobile`: response includes `user`, `accessToken`, `refreshToken`, and `sessionId`. Store tokens
  using platform secure storage, never ordinary preferences.

Refresh requests rotate one-time refresh tokens. Mobile sends the current token in JSON; web uses
cookies. Replaying a rotated token revokes that session. `logout-all` and password reset revoke all
sessions. Authentication errors have the stable shape `{ "error": { "code": "...", "message":
"..." }, "requestId": "..." }`.

`GET /api/auth/csrf` issues the browser CSRF token. `POST /api/auth/resend-otp` requests a new
verification code. Authenticated users can list and revoke their own sessions with
`GET /api/auth/sessions` and `DELETE /api/auth/sessions/{sessionId}`. Web cookie mutations require
the CSRF header.

`GET/PATCH/DELETE /api/users/me` is restricted to the authenticated user's own profile. No
family/location endpoints or unrestricted location access are implemented.
