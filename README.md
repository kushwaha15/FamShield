# FamShield

FamShield is a family safety and location intelligence platform being built around voluntary,
transparent sharing. This repository contains the Phase 1 foundation and Phase 2 authentication
for a responsive website, Flutter Android app, and TypeScript API.

**Privacy boundary:** Phase 2 implements accounts and authentication only. No location collection,
tracking, or family-management feature exists. The app does not request GPS permission. Account
registration records Terms/Privacy acceptance only; it does not grant location consent. Future
location features must use explicit, informed, revocable consent; covert tracking and administrator
bypasses are not acceptable.

## Repository

- `apps/web` — React, Vite, TypeScript, Tailwind CSS, React Router, Axios and React Query
- `apps/mobile` — Flutter welcome and authentication client; credentials use secure storage
- `services/api` — Express/TypeScript API, Drizzle/PostgreSQL persistence, OTP/auth/session services and health endpoint
- `packages/shared-types` — initial TypeScript API contracts
- `docs` — architecture, API, security and setup documentation
- `infrastructure` — local development and deployment foundations

## Quick start

Requirements: Node.js 22.12+ (or 24+), npm 10+, Flutter stable, and a Supabase PostgreSQL project
(or a compatible PostgreSQL database for local development).

1. Copy `.env.example` to `.env`. Set the backend-only PostgreSQL `DATABASE_URL` from Supabase and
   replace both development secrets with independently generated random values. Instructions are
   in [`docs/development/setup-guide.md`](docs/development/setup-guide.md). Keep real secrets out of
   source control.
2. Install JavaScript dependencies: `npm install`.
3. Apply the versioned SQL migration: `npm run db:migrate`.
4. Start the API: `npm run dev:api` (default port 3000).
5. Start the website in another terminal: `npm run dev:web` (default port 5173).
6. Run the Android app: from `apps/mobile`, run
   `flutter run --dart-define=FAMSHIELD_API_URL=http://10.0.2.2:3000/api/` on an Android emulator.

The API refuses to start without valid JWT/token-hash secrets. Development OTP delivery is disabled;
set `AUTH_DEV_OTP_EXPOSE=true` only in local development to see test codes in responses. Production
never exposes OTPs. Configure delivery providers for real email/SMS. Without `DATABASE_URL`, the API
starts in degraded mode, database-backed endpoints are unavailable, and health reports HTTP 503.

## Checks

- `npm run typecheck` — shared contracts, API and web TypeScript checks
- `npm run build` — API and web production builds (also builds shared contracts)
- `npm run lint` — ESLint
- `npm run format:check` — Prettier verification
- `npm run test:api` — API integration tests against an isolated ephemeral PostgreSQL-compatible
  PGlite database
- `cd apps/mobile && flutter analyze` — Flutter static analysis
- `cd apps/mobile && flutter test` — Flutter tests

## Documentation

- [System architecture](docs/architecture/system-architecture.md)
- [Authentication architecture](docs/architecture/authentication.md)
- [Database schema](docs/architecture/database-schema.md)
- [Data flow](docs/architecture/data-flow.md)
- [Security principles](docs/security/security-principles.md)
- [API overview](docs/api/api-overview.md)
- [Development setup](docs/development/setup-guide.md)

## Phase status

**Complete:** Phase 1 foundation plus Phase 2 account registration, dual-channel OTP verification,
login, JWT access tokens, rotating refresh tokens, logout/session revocation, password reset,
authenticated self-profile operations, browser cookie/CSRF handling, Flutter secure token storage,
provider abstractions, API tests, and updated documentation.

**Not implemented (future phases):** family/invitation workflows, location collection/history,
geofencing, SOS delivery, push notifications, Socket.IO, Redis, production deployment, and actual
provider accounts. SMS/email delivery requires configured credentials. Supabase connectivity
requires the operator's database URL and network configuration. No later phase has started.
