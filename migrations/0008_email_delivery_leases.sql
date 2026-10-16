-- Existing claims are conservatively treated as sent because their outcome is
-- unknowable; this preserves prior duplicate suppression. New claims use an
-- expiring lease so a worker interruption before delivery can recover on retry.
ALTER TABLE processed_jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'
  CHECK (status IN ('processing', 'sent'));
ALTER TABLE processed_jobs ADD COLUMN lease_expires_at INTEGER;
CREATE INDEX idx_processed_jobs_delivery_lease
  ON processed_jobs(status, lease_expires_at);
