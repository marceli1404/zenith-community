CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  available_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at INTEGER,
  lease_token TEXT
);

CREATE INDEX idx_email_outbox_ready
  ON email_outbox (available_at, expires_at, created_at);
