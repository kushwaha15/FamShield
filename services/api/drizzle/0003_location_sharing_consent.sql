ALTER TABLE consents
  ADD COLUMN family_id uuid REFERENCES families (id) ON DELETE RESTRICT;

UPDATE consents
SET granted = false,
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE consent_type = 'location_sharing'
  AND granted = true;

ALTER TABLE consents
  ADD CONSTRAINT consents_location_grant_scope_check
  CHECK (
    consent_type <> 'location_sharing'
    OR NOT granted
    OR (family_id IS NOT NULL AND revoked_at IS NULL)
  );

CREATE INDEX consents_location_scope_created_idx
  ON consents (user_id, family_id, created_at DESC)
  WHERE consent_type = 'location_sharing';

CREATE UNIQUE INDEX consents_location_active_unique
  ON consents (user_id, family_id)
  WHERE consent_type = 'location_sharing'
    AND granted = true
    AND family_id IS NOT NULL;
