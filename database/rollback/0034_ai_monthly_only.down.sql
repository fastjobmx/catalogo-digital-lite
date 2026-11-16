-- Rollback de 0034_ai_monthly_only.sql. Vuelve a poner las sesiones de 5 horas de 0030 en los planes nuevos.
ALTER TABLE ai_spend_reservations DROP COLUMN route;
ALTER TABLE store_ai_keys DROP COLUMN buyer_data_policy;
ALTER TABLE store_ai_keys DROP COLUMN last_error_detail;
ALTER TABLE store_ai_keys DROP COLUMN image_capability;
ALTER TABLE store_ai_keys DROP COLUMN signals;
ALTER TABLE store_ai_keys DROP COLUMN tier_note;
ALTER TABLE store_ai_keys DROP COLUMN tier_verified_at;
ALTER TABLE store_ai_keys DROP COLUMN tier_verified_by;
ALTER TABLE store_ai_keys DROP COLUMN billing_declared_at;
ALTER TABLE store_ai_keys DROP COLUMN tier;
DROP TABLE IF EXISTS ai_quota_notices;
UPDATE plans SET ai_session_units = 30 WHERE code = 'emprendedor';
UPDATE plans SET ai_session_units = 80 WHERE code = 'negocio';
UPDATE plans SET ai_session_units = 200 WHERE code = 'mayorista';
