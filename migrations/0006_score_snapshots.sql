ALTER TABLE audit_results ADD COLUMN reliability_deduction INTEGER;
ALTER TABLE audit_results ADD COLUMN scoring_version INTEGER NOT NULL DEFAULT 0;
