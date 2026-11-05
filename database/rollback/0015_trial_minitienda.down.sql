-- Reverts 0015_trial_minitienda.sql. Run the previous Worker version first.
-- Deletes activation requests and platform settings; export them first if needed.
DROP INDEX IF EXISTS idx_trial_orders_trial;
DROP TABLE IF EXISTS trial_orders;
DROP INDEX IF EXISTS idx_trial_conversions_status;
DROP TABLE IF EXISTS trial_conversions;
DROP INDEX IF EXISTS idx_trial_sessions_status;
ALTER TABLE trial_sessions DROP COLUMN converted_store_id;
ALTER TABLE trial_sessions DROP COLUMN product_count;
ALTER TABLE trial_sessions DROP COLUMN retain_until;
ALTER TABLE trial_sessions DROP COLUMN status;
DROP TABLE IF EXISTS platform_settings;
