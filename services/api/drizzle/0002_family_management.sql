CREATE TABLE families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL
    CHECK (char_length(btrim(name)) BETWEEN 2 AND 100),
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX families_created_by_idx ON families (created_by);

CREATE TABLE family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role varchar(16) NOT NULL CHECK (role IN ('owner', 'member')),
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'left', 'removed')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND left_at IS NULL) OR
    (status <> 'active' AND left_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX family_members_active_unique
  ON family_members (family_id, user_id) WHERE status = 'active';
CREATE UNIQUE INDEX family_members_active_owner_unique
  ON family_members (family_id) WHERE status = 'active' AND role = 'owner';
CREATE INDEX family_members_user_active_idx
  ON family_members (user_id, status, family_id);
CREATE INDEX family_members_family_active_idx
  ON family_members (family_id, status, joined_at);

CREATE FUNCTION famshield_require_family_owner() RETURNS trigger AS $$
DECLARE
  affected_family_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'families' THEN
    affected_family_id := NEW.id;
  ELSE
    affected_family_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.family_id ELSE NEW.family_id END;
  END IF;
  IF EXISTS (SELECT 1 FROM families WHERE id = affected_family_id)
     AND NOT EXISTS (
       SELECT 1 FROM family_members
       WHERE family_id = affected_family_id
         AND role = 'owner'
         AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'A family must have exactly one active owner'
      USING ERRCODE = '23514', CONSTRAINT = 'family_members_owner_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER family_members_owner_required
  AFTER INSERT OR UPDATE OR DELETE ON family_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION famshield_require_family_owner();
CREATE CONSTRAINT TRIGGER families_owner_required
  AFTER INSERT ON families
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION famshield_require_family_owner();

CREATE TABLE family_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  inviter_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  invitee_email varchar(254),
  invitee_phone varchar(16),
  token_hash varchar(64) NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  declined_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (invitee_email IS NOT NULL AND invitee_phone IS NULL) OR
    (invitee_email IS NULL AND invitee_phone IS NOT NULL)
  ),
  CHECK (
    invitee_email IS NULL OR (
      invitee_email = lower(btrim(invitee_email))
      AND invitee_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  CHECK (invitee_phone IS NULL OR invitee_phone ~ '^\+[1-9][0-9]{7,14}$'),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL) OR
    (status <> 'accepted' AND accepted_at IS NULL)
  ),
  CHECK (
    (status = 'declined' AND declined_at IS NOT NULL) OR
    (status <> 'declined' AND declined_at IS NULL)
  ),
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL) OR
    (status <> 'revoked' AND revoked_at IS NULL)
  )
);
CREATE UNIQUE INDEX family_invitations_pending_email_unique
  ON family_invitations (family_id, invitee_email)
  WHERE status = 'pending' AND invitee_email IS NOT NULL;
CREATE UNIQUE INDEX family_invitations_pending_phone_unique
  ON family_invitations (family_id, invitee_phone)
  WHERE status = 'pending' AND invitee_phone IS NOT NULL;
CREATE INDEX family_invitations_lookup_email_idx
  ON family_invitations (invitee_email, status, expires_at);
CREATE INDEX family_invitations_lookup_phone_idx
  ON family_invitations (invitee_phone, status, expires_at);
CREATE INDEX family_invitations_family_status_idx
  ON family_invitations (family_id, status, expires_at);

CREATE TRIGGER families_set_updated_at BEFORE UPDATE ON families
  FOR EACH ROW EXECUTE FUNCTION famshield_set_updated_at();
CREATE TRIGGER family_members_set_updated_at BEFORE UPDATE ON family_members
  FOR EACH ROW EXECUTE FUNCTION famshield_set_updated_at();
CREATE TRIGGER family_invitations_set_updated_at BEFORE UPDATE ON family_invitations
  FOR EACH ROW EXECUTE FUNCTION famshield_set_updated_at();

ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY families_backend_only ON families
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY family_members_backend_only ON family_members
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY family_invitations_backend_only ON family_invitations
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

REVOKE ALL ON families, family_members, family_invitations FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON families, family_members, family_invitations FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;
