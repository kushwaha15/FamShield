# Deployment foundation

## Separate Render staging API

Create a separate Render Web Service for staging. Do not reuse the production service, its
environment group, database URL, or authentication secrets. Keep staging and production
`DATABASE_URL`, `JWT_ACCESS_SECRET`, `AUTH_TOKEN_PEPPER`, provider credentials, and client origins
separate. Use the FamShield-Staging Supabase project only for the staging service.

Configure the service from the repository root with:

- Build command: `npm ci && npm run build --workspace @famshield/shared-types && npm run build --workspace @famshield/api`
- Start command: `npm run start --workspace @famshield/api`
- Health-check path: `/api/health`

The API uses Render's `PORT` environment variable when supplied and otherwise falls back to
`API_PORT` (default `3000`). It binds to `0.0.0.0`. In production, the API rejects SSL-related
query parameters in `DATABASE_URL`; configure TLS through the runtime instead.

For the staging Supabase CA, add a Render Secret File named `prod-ca-2021.crt` with the verified
staging CA certificate contents. Render makes the file available at
`/etc/secrets/prod-ca-2021.crt`. Set the staging service environment variable
`NODE_EXTRA_CA_CERTS=/etc/secrets/prod-ca-2021.crt`. Node reads this variable at process startup;
restart/redeploy after changing it. The API's PostgreSQL connection keeps
`rejectUnauthorized: true`. Never set a TLS bypass option.

Set the staging service's environment variables independently from production. `CORS_ORIGINS`
must contain only HTTPS origin(s) for the staging client. Generate unique staging
`JWT_ACCESS_SECRET` and `AUTH_TOKEN_PEPPER` values; they must differ from each other and from
production. Set `AUTH_DEV_OTP_EXPOSE=false`. Production-mode validation rejects development SMS
and email providers, so configure staging/test delivery providers and their credentials rather
than using the development adapters.

Initially run one API instance. Socket.IO room state and notifications are in memory; multi-instance
deployment requires a shared adapter and coordinated revocation/event delivery.

The current `/api/health` endpoint returns HTTP 200 only when PostgreSQL is connected, otherwise 503. Use this path as the Render health check after configuring the staging database and CA.

Production deployment configuration is otherwise managed separately. Deployments must provide
validated environment variables through a secret manager, terminate HTTPS, restrict network access
to databases, and isolate production data.

Configure PostgreSQL access through the backend-only `DATABASE_URL`. Do not expose it or any
Supabase service-role credential to the web or mobile application.

## Socket.IO / WebSocket proxying

The API serves Socket.IO through the same HTTP listener as its REST endpoints. Production clients
must use HTTPS/WSS. Reverse proxies and load balancers must support WebSocket upgrades and forward
the HTTP/1.1 `Upgrade` and `Connection: upgrade` headers, preserve the configured `Origin`, and route
the Socket.IO path to the API without buffering or rewriting its transport requests. If long-polling
fallback is enabled, proxy both polling and WebSocket requests.

The server heartbeat sends pings every 25 seconds and closes connections after a 20-second ping
timeout. Configure proxy and load-balancer idle timeouts to at least 60 seconds (preferably 75
seconds or more) so they exceed the heartbeat interval and timeout. The application currently
supports a single backend instance with its in-memory room adapter and notification bus. A
multi-instance deployment requires a shared Socket.IO adapter (for example Redis), coordinated
post-commit event delivery, and cross-instance session/membership revocation before scaling out;
Redis is not required or configured for the current single-instance deployment.
