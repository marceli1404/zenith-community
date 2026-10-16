-- Persist the last queue check id so retry/concurrent batches can prove which
-- monitor-state transition owns the uptime row it is about to commit.
ALTER TABLE monitors ADD COLUMN last_check_id TEXT;
