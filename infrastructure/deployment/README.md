# Deployment foundation

Production deployment configuration is intentionally not defined in this phase. Deployments must
provide validated environment variables through a secret manager, terminate HTTPS, restrict
network access to databases, and separate production data from development.

Configure PostgreSQL access through the backend-only `DATABASE_URL`. Do not expose it or any
Supabase service-role credential to the web or mobile application.
