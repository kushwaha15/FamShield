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

`GET/PATCH/DELETE /api/users/me` is restricted to the authenticated user's own profile.

## Family management

Family endpoints require an authenticated account. For browser cookie sessions, every state-changing
request also requires `X-CSRF-Token`. Family-scoped reads require active membership; creating,
revoking, removing, or transferring membership requires the active owner role. Unavailable family
IDs are returned as `404` to avoid disclosing another family's existence.

- `POST /api/families` creates the family and caller's owner membership in one transaction.
- `GET /api/families` lists the caller's active family memberships; `GET /api/families/{familyId}`
  and `GET /api/families/{familyId}/members` provide authorized details.
- `POST /api/families/{familyId}/invitations` accepts exactly one normalized `email` or E.164
  `phone`. Its response contains invitation metadata and a high-entropy token once. The database
  stores only a SHA-256 token hash; invitation list responses never include tokens or hashes.
- `GET /api/families/{familyId}/invitations` lists an owner's pending invitations;
  `DELETE /api/families/{familyId}/invitations/{invitationId}` revokes one.
- `GET /api/invitations` lists unexpired invitations that match the caller's verified email or
  phone. To accept or decline, submit the token from the original invitation link to
  `POST /api/invitations/accept` or `/api/invitations/decline`.
- `DELETE /api/families/{familyId}/members/{userId}` removes a member (owner only);
  `POST /api/families/{familyId}/leave` lets a member leave.
- `POST /api/families/{familyId}/transfer-ownership` requires `targetUserId` for an active member.
  Owners cannot leave or be removed before transferring ownership.

Invitations expire after seven days by default; the API operator can configure
`FAMILY_INVITATION_TTL_DAYS` from 1 to 30. Invitations are single-use, revocable, contact-matched,
and transactionally accepted. Membership does not create location consent or enable location sharing.

## Location-sharing consent

Consent is controlled by the authenticated user and scoped independently to each active family.
`GET /api/consents/location-sharing` lists the caller's active family memberships and consent state.
`POST /api/consents/location-sharing` requires `{ "familyId": "...", "policyVersion":
"location-sharing-v1", "confirmed": true }`; the server verifies active membership and the current
policy version. `DELETE /api/consents/location-sharing/{familyId}` revokes only the caller's
consent. `GET /api/consents/location-sharing/history` returns only that caller's consent audit
records. The policy version must be advanced whenever the consent information changes so users
must explicitly acknowledge the revised policy.

The existing `consents` table is extended with a family scope. Consent grants remain in the audit
history; revocation changes the active row's status and timestamp, while a later grant creates a new
row. Existing unscoped location grants are revoked by migration 0003 because their intended family
audience cannot be recovered safely. Leaving or being removed from a family revokes the member's
active consent within the membership transaction. Owners cannot consent for another member. This
phase manages consent only: it does not request GPS permissions, collect/transmit coordinates, or
implement maps, realtime tracking, SOS, or geofencing.

## Location-sharing backend foundation

Location session and position endpoints require authentication and active membership in the
requested family. A member can start only their own session and only while their current
family-scoped consent is valid. Starting a session does not collect device location; callers submit
position updates explicitly. The server derives the sharing user from the authenticated session and
accepts a monotonically increasing session sequence to reject replayed or out-of-order updates.
The client timestamp must also be within five minutes of server time and strictly later than the
previous accepted timestamp; server receipt time remains authoritative for freshness.

- `POST /api/families/{familyId}/location-sharing/sessions` starts the caller's session.
- `POST /api/families/{familyId}/location-sharing/sessions/{sessionId}/pause` pauses and deletes its
  current position; `/resume` resumes only with current consent; `/stop` stops and deletes it.
- `PUT /api/families/{familyId}/location-sharing/sessions/{sessionId}/position` submits the latest
  position with `latitude`, `longitude`, `accuracyMeters`, `sequence`, and ISO
  `clientRecordedAt`. The response includes the position `expiresAt` and the session's refreshed
  `sessionExpiresAt`, which clients use to stop or renew their local session timer. It does not
  accept a user ID, family ID, or consent flag in the body.
- `GET /api/families/{familyId}/locations` returns only active members whose sessions, current
  consent, membership, and unexpired latest position are valid. Viewers need active membership but
  do not need to share their own location.

Coordinates are rounded to four decimal places before storage; only one latest position is retained
per member and family. Positions expire after ten minutes and are reported stale after two minutes.
Sessions expire after thirty minutes without a fresh position. Stop, pause, consent revocation, and
family leave/removal delete the current position transactionally. A periodic server cleanup expires
invalid sessions and deletes expired positions. This foundation does not collect GPS data or add
location history, background tracking, background location permission, or maps. The Android client
collects only after active consent and an explicit start action, and pauses collection when the app
becomes inactive.

## Realtime location notifications

The API exposes Socket.IO on the same HTTPS endpoint and HTTP listener as the REST API. Web clients
authenticate with the existing `fs_access` HttpOnly cookie and send the matching `fs_csrf` value in
the Socket.IO handshake's `auth.csrfToken`. The request `Origin` must exactly match a configured
`CORS_ORIGINS` entry. Flutter/mobile clients send the existing access token in the handshake
`auth.accessToken` field; tokens must never be placed in a URL. The server verifies both the JWT and
its active refresh-token session. It periodically revalidates long-lived connections and disconnects
revoked or expired sessions.

Clients request a family room with `location:subscribe` and `{ "familyId": "..." }`; a successful
acknowledgement is `{ "ok": true }`. Active family membership is required for every subscription.
The server constructs room names itself. A member can subscribe to view consenting sharers without
granting their own location-sharing consent. Unsubscribe uses the same family ID payload.

The server emits only metadata:

```json
{
  "familyId": "family UUID",
  "eventId": "event UUID",
  "revision": 1,
  "occurredAt": "2026-01-01T00:00:00.000Z"
}
```

`location:changed` means an authorized member's current location may have changed.
`location:invalidated` means a location may have been removed or become unavailable. Neither event
contains coordinates, a location object, a user ID, or credentials. Events are emitted after
location, consent, or membership changes commit. Before delivery, the server rechecks the recipient's
session and membership; `location:changed` additionally rechecks the sharer's active membership,
consent, and sharing session. Membership removal evicts that member's sockets from the family room.
Clients must retrieve coordinates using `GET /api/families/{familyId}/locations`, which independently
enforces authorization. After reconnecting, clients must refetch; these initial notifications are
in-process and are not durably queued.

Cookie-authenticated connections require an allowed `Origin` and CSRF proof at handshake. Socket
payloads do not accept authorization flags or user IDs. The server currently uses a single-instance
in-memory adapter; Redis and cross-instance delivery are intentionally not configured.
