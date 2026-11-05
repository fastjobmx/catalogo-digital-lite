-- Reverts 0013_catalog_trials.sql. Run the previous Worker version first.
-- Trial photos live under trials/ in R2; remove that prefix separately if needed.
DROP TABLE IF EXISTS trial_rate_limits;
DROP INDEX IF EXISTS idx_trial_sessions_ip;
DROP INDEX IF EXISTS idx_trial_sessions_expires;
DROP TABLE IF EXISTS trial_sessions;
