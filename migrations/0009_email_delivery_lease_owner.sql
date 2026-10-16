-- Fencing token: a worker whose lease expired cannot complete or release a
-- newer worker's claim.
ALTER TABLE processed_jobs ADD COLUMN lease_token TEXT;
