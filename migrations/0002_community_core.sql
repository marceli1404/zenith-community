-- Community website monitoring and audit data. Timestamps are epoch milliseconds;
-- booleans are stored as integers (0/1).

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified',
  verification_method TEXT,
  verification_token TEXT NOT NULL,
  verified_at INTEGER,
  status_page_slug TEXT UNIQUE,
  status_page_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_sites_user ON sites(user_id);
CREATE UNIQUE INDEX idx_sites_user_origin ON sites(user_id, normalized_origin);

CREATE TABLE monitors (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  interval_seconds INTEGER NOT NULL,
  next_check_at INTEGER NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  last_status_code INTEGER,
  last_response_ms INTEGER,
  last_ok INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_monitors_due ON monitors(enabled, next_check_at);

CREATE TABLE uptime_checks (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  status_code INTEGER,
  response_ms INTEGER,
  error_code TEXT
);
CREATE INDEX idx_uptime_checks_site_time ON uptime_checks(site_id, checked_at);

CREATE TABLE uptime_hourly (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  bucket_start INTEGER NOT NULL,
  checks INTEGER NOT NULL,
  ok_checks INTEGER NOT NULL,
  avg_response_ms REAL,
  min_response_ms INTEGER,
  max_response_ms INTEGER,
  PRIMARY KEY (site_id, bucket_start)
);

CREATE TABLE uptime_daily (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  bucket_start INTEGER NOT NULL,
  checks INTEGER NOT NULL,
  ok_checks INTEGER NOT NULL,
  avg_response_ms REAL,
  min_response_ms INTEGER,
  max_response_ms INTEGER,
  PRIMARY KEY (site_id, bucket_start)
);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  resolved_at INTEGER,
  reason TEXT,
  initial_status_code INTEGER,
  last_status_code INTEGER,
  notification_sent_at INTEGER,
  recovery_notification_sent_at INTEGER
);
CREATE INDEX idx_incidents_site ON incidents(site_id, started_at);
CREATE UNIQUE INDEX idx_incidents_open ON incidents(site_id) WHERE resolved_at IS NULL;

CREATE TABLE audit_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
  target_origin TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  failed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_audit_jobs_user ON audit_jobs(user_id, queued_at);
CREATE INDEX idx_audit_jobs_status ON audit_jobs(status, priority, queued_at);

CREATE TABLE audit_results (
  id TEXT PRIMARY KEY,
  audit_job_id TEXT NOT NULL UNIQUE REFERENCES audit_jobs(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
  overall_score INTEGER NOT NULL,
  performance_score INTEGER NOT NULL,
  accessibility_score INTEGER NOT NULL,
  seo_score INTEGER NOT NULL,
  security_score INTEGER NOT NULL,
  page_count INTEGER NOT NULL,
  broken_link_count INTEGER NOT NULL DEFAULT 0,
  screenshot_key TEXT,
  mobile_screenshot_key TEXT,
  report_key TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_results_site ON audit_results(site_id, created_at);

CREATE TABLE audit_pages (
  id TEXT PRIMARY KEY,
  audit_result_id TEXT NOT NULL REFERENCES audit_results(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status_code INTEGER,
  response_ms INTEGER,
  title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  h1_count INTEGER,
  bytes INTEGER,
  indexable INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_pages_result ON audit_pages(audit_result_id);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  audit_result_id TEXT NOT NULL REFERENCES audit_results(id) ON DELETE CASCADE,
  page_url TEXT,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_findings_result ON findings(audit_result_id, severity);

CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  downtime INTEGER NOT NULL DEFAULT 1,
  recovery INTEGER NOT NULL DEFAULT 1,
  audit_finished INTEGER NOT NULL DEFAULT 1
);
