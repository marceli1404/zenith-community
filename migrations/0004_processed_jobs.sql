-- Idempotency for queue jobs whose effects must not repeat on delivery retries.
CREATE TABLE processed_jobs (
  key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_processed_jobs_time ON processed_jobs(created_at);
