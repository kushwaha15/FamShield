ALTER TABLE consents
  ADD CONSTRAINT consents_id_user_family_unique UNIQUE (id, user_id, family_id);

CREATE TABLE location_sharing_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  consent_id uuid NOT NULL,
  session_version uuid NOT NULL DEFAULT gen_random_uuid(),
  status varchar(16) NOT NULL DEFAULT 'sharing'
    CHECK (status IN ('sharing', 'paused', 'stopped', 'expired')),
  started_at timestamptz NOT NULL DEFAULT now(),
  paused_at timestamptz,
  resumed_at timestamptz,
  stopped_at timestamptz,
  expired_at timestamptz,
  last_update_at timestamptz,
  last_client_recorded_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_sessions_consent_scope_fk
    FOREIGN KEY (consent_id, user_id, family_id)
    REFERENCES consents (id, user_id, family_id) ON DELETE CASCADE,
  CONSTRAINT location_sessions_id_scope_unique UNIQUE (id, user_id, family_id),
  CONSTRAINT location_sessions_lifecycle_check CHECK (
    (status = 'sharing' AND paused_at IS NULL AND stopped_at IS NULL AND expired_at IS NULL)
    OR (status = 'paused' AND paused_at IS NOT NULL AND stopped_at IS NULL AND expired_at IS NULL)
    OR (status = 'stopped' AND stopped_at IS NOT NULL AND expired_at IS NULL)
    OR (status = 'expired' AND expired_at IS NOT NULL AND stopped_at IS NULL)
  ),
  CONSTRAINT location_sessions_expiry_check CHECK (expires_at > started_at)
);

CREATE UNIQUE INDEX location_sessions_active_user_family_unique
  ON location_sharing_sessions (user_id, family_id)
  WHERE status IN ('sharing', 'paused');
CREATE INDEX location_sessions_family_status_expiry_idx
  ON location_sharing_sessions (family_id, status, expires_at);
CREATE INDEX location_sessions_user_status_idx
  ON location_sharing_sessions (user_id, status, family_id);

CREATE TABLE location_positions (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  latitude numeric(6, 4) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(7, 4) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters numeric(7, 2) NOT NULL CHECK (accuracy_meters BETWEEN 0 AND 1000),
  recorded_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT location_positions_user_family_pk PRIMARY KEY (user_id, family_id),
  CONSTRAINT location_positions_session_unique UNIQUE (session_id),
  CONSTRAINT location_positions_session_scope_fk
    FOREIGN KEY (session_id, user_id, family_id)
    REFERENCES location_sharing_sessions (id, user_id, family_id) ON DELETE CASCADE,
  CONSTRAINT location_positions_expiry_check CHECK (expires_at > recorded_at)
);
CREATE INDEX location_positions_family_expiry_idx
  ON location_positions (family_id, expires_at, recorded_at DESC);

CREATE TRIGGER location_sharing_sessions_set_updated_at BEFORE UPDATE ON location_sharing_sessions
  FOR EACH ROW EXECUTE FUNCTION famshield_set_updated_at();

ALTER TABLE location_sharing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY location_sharing_sessions_backend_only ON location_sharing_sessions
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY location_positions_backend_only ON location_positions
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

REVOKE ALL ON location_sharing_sessions, location_positions FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON location_sharing_sessions, location_positions FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;
