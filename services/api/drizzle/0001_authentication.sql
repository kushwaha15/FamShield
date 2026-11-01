CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name varchar(100) NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 100),
  email varchar(254) NOT NULL,
  phone varchar(16) NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  password_hash text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  phone_verified boolean NOT NULL DEFAULT false,
  status varchar(32) NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'active', 'suspended')),
  profile_image_url varchar(2048)
    CHECK (profile_image_url IS NULL OR profile_image_url LIKE 'https://%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE UNIQUE INDEX users_phone_unique ON users (phone);
CREATE INDEX users_status_idx ON users (status);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_token_hash varchar(64),
  device_info varchar(256),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refresh_tokens_hash_unique ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_user_session_idx
  ON refresh_tokens (user_id, session_id, revoked_at, expires_at);
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at);

CREATE TABLE otp_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose varchar(32) NOT NULL
    CHECK (purpose IN ('verify_email', 'verify_phone', 'reset_password')),
  otp_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  purge_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'expired', 'locked', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_verifications_user_purpose_status_created_idx
  ON otp_verifications (user_id, purpose, status, created_at DESC);
CREATE INDEX otp_verifications_purge_idx ON otp_verifications (purge_at);

CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  consent_type varchar(32) NOT NULL
    CHECK (consent_type IN ('terms_of_service', 'privacy_policy', 'location_sharing')),
  granted boolean NOT NULL,
  granted_at timestamptz,
  revoked_at timestamptz,
  version varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT granted OR granted_at IS NOT NULL)
);
CREATE INDEX consents_user_type_created_idx ON consents (user_id, consent_type, created_at DESC);

CREATE FUNCTION famshield_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION famshield_set_updated_at();
CREATE TRIGGER refresh_tokens_set_updated_at BEFORE UPDATE ON refresh_tokens
  FOR EACH ROW EXECUTE FUNCTION famshield_set_updated_at();
CREATE TRIGGER otp_verifications_set_updated_at BEFORE UPDATE ON otp_verifications
  FOR EACH ROW EXECUTE FUNCTION famshield_set_updated_at();
CREATE TRIGGER consents_set_updated_at BEFORE UPDATE ON consents
  FOR EACH ROW EXECUTE FUNCTION famshield_set_updated_at();

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_backend_only ON users FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY refresh_tokens_backend_only ON refresh_tokens FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY otp_verifications_backend_only ON otp_verifications FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY consents_backend_only ON consents FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

REVOKE ALL ON users, refresh_tokens, otp_verifications, consents FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON users, refresh_tokens, otp_verifications, consents FROM %I', role_name);
    END IF;
  END LOOP;
END;
$$;
