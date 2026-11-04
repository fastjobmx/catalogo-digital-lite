-- Reverts 0008_store_onboarding.sql. Removes only onboarding progress and
-- activation requests; store configuration, templates and catalogs are untouched.
-- Run the previous Worker version first (it does not read these tables).
DROP INDEX IF EXISTS idx_store_activation_one_pending;
DROP TABLE IF EXISTS store_activation_requests;
DROP INDEX IF EXISTS idx_store_onboardings_expiry;
DROP TABLE IF EXISTS store_onboardings;
DROP TABLE IF EXISTS store_onboarding_legacy_stores;
DELETE FROM d1_migrations WHERE name = '0008_store_onboarding.sql';
