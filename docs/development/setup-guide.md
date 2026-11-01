# Development setup

## Prerequisites

- Node.js 22.12+ (or 24+) and npm 10+
- Flutter stable SDK with Android tooling
- A Supabase project with PostgreSQL enabled, or another PostgreSQL 15+ server

## Environment and secrets

From the repository root, copy `.env.example` to `.env`. Generate independent random secrets:

```powershell
node -e "const c=require('node:crypto'); console.log('JWT_ACCESS_SECRET='+c.randomBytes(48).toString('base64url')); console.log('AUTH_TOKEN_PEPPER='+c.randomBytes(48).toString('base64url'))"
```

Replace both placeholder values in `.env`; do not share or commit this file. Keep
`AUTH_DEV_OTP_EXPOSE=true` only in local development. It lets the API return test codes in responses;
codes are never logged. Production startup rejects OTP exposure and development delivery providers.

Configure `DATABASE_URL` with the PostgreSQL connection string from the Supabase dashboard
(Project Settings → Database → Connection string). Use the direct connection or session pooler
appropriate for the hosting network, require SSL, and keep the URL exclusively on the API server.
The API uses `DATABASE_URL` directly through node-postgres/Drizzle; it does not use a Supabase
client SDK, Supabase Auth, `SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY`. Do not put database
credentials in either client application.

The root `.env.example` contains a placeholder Supabase connection URL and development message
adapters. Production must restrict database network access to the API service, use independent
secrets, HTTPS, and configured SMS/email providers.

### Provider configuration

- Development: `SMS_PROVIDER=development`, `EMAIL_PROVIDER=development`. These adapters do not send
  messages. Codes can only be viewed if the non-production `AUTH_DEV_OTP_EXPOSE=true` flag is set.
- Generic SMS provider: set `SMS_PROVIDER=http`, `SMS_HTTP_URL`, and `SMS_HTTP_API_KEY`. The API
  sends JSON `{ "to": "+...", "message": "..." }` with `Authorization: Bearer <key>`.
- Twilio SMS: set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
  `TWILIO_FROM_NUMBER`.
- Generic email provider: set `EMAIL_PROVIDER=http`, `EMAIL_HTTP_URL`, and `EMAIL_HTTP_API_KEY`. The
  API sends JSON `{ "to": "...", "subject": "...", "text": "..." }` with bearer authorization.

Production provider endpoints must use HTTPS. No SMS/email provider account is supplied.

## Install and run

From the repository root:

```powershell
npm install
npm run db:migrate
npm run dev:api
```

In another terminal:

```powershell
npm run dev:web
```

Open the Vite URL (normally `http://localhost:5173`). CORS defaults to that origin.

For Android emulator:

```powershell
Set-Location apps\mobile
flutter pub get
flutter run --dart-define=FAMSHIELD_API_URL=http://10.0.2.2:3000/api/
```

For a physical device, use a reachable development host address via `FAMSHIELD_API_URL`. HTTP
cleartext is enabled only in the Android debug manifest; production must use HTTPS. The main Android
manifest declares network access only and does not request location permissions.

## Test and verify

From the repository root:

```powershell
npm run test --workspace @famshield/web
npm run test:api
npm run typecheck
npm run build
npm run lint
npm run format:check
Set-Location apps\mobile
flutter analyze
flutter test
```

Backend integration tests start a separate ephemeral PGlite PostgreSQL engine and connect to it via
the same node-postgres driver used by the API. The test database is isolated from `DATABASE_URL`;
tests do not connect to Supabase or the local PostgreSQL service. For the live service,
`GET http://localhost:3000/api/health` returns 200 only when PostgreSQL is connected. Without
`DATABASE_URL`, the API starts in degraded mode, but database operations return service unavailable.

The web app provides `/login`, `/signup`, `/verify`, `/forgot-password`, and `/reset-password`, plus
an authenticated `/dashboard` with profile and active-session settings at `/dashboard/profile` and
`/dashboard/security`. Family management is at `/dashboard/families`; per-family consent controls
and history are at `/dashboard/privacy`. Browser sessions use HttpOnly cookies and CSRF headers;
tokens are not stored in browser storage. The Android app includes matching family-management and
location-consent screens. Family membership never enables location sharing. Phase 6 records consent
only; GPS permissions, collection, and transmission remain unimplemented.

The API migration runner applies numbered migrations in order and records each successful migration.
Run `npm run db:migrate` only against a local or disposable development database. Never point it at
the production Supabase database as part of tests or local development. Backend migration tests use
isolated PGlite and do not read `DATABASE_URL` from `.env`.

## Client/server contract

`packages/shared-types` is the canonical TypeScript API contract. Flutter's `AuthUser` model uses
the same JSON field names; the Dio client uses the same auth routes and response envelope. Both
clients call the same backend. Browser clients use HttpOnly cookies and CSRF headers; Flutter
clients store access/refresh tokens using `flutter_secure_storage`.
