-- Rollback de 0030_ai_plan_usage.sql. Antes: AI_SPEND_GUARD_MODE = 'off' o Worker sin el motor de consultas.
DROP INDEX IF EXISTS idx_ai_spend_recent;
DROP INDEX IF EXISTS idx_ai_spend_fingerprint;
DROP INDEX IF EXISTS idx_ai_spend_session;
DROP INDEX IF EXISTS idx_ai_spend_cycle;
ALTER TABLE ai_spend_reservations DROP COLUMN request_fingerprint;
ALTER TABLE ai_spend_reservations DROP COLUMN billing_source;
ALTER TABLE ai_spend_reservations DROP COLUMN cycle_key;
ALTER TABLE ai_spend_reservations DROP COLUMN session_id;
ALTER TABLE ai_spend_reservations DROP COLUMN units;
DROP TABLE IF EXISTS ai_unit_weights;
DROP INDEX IF EXISTS idx_ai_sessions_open;
DROP TABLE IF EXISTS ai_sessions;
-- Vuelve la cuota de mensajes de 0023 a los planes nuevos.
UPDATE plans SET ai_monthly_messages = 500, ai_usage_policy = 'quota' WHERE code = 'emprendedor';
UPDATE plans SET ai_usage_policy = 'monitored' WHERE code IN ('negocio', 'mayorista');
ALTER TABLE stores DROP COLUMN ai_monthly_units_override;
ALTER TABLE stores DROP COLUMN ai_session_units_override;
ALTER TABLE plans DROP COLUMN ai_monthly_credits;
ALTER TABLE plans DROP COLUMN ai_monthly_budget_cop;
ALTER TABLE plans DROP COLUMN ai_monthly_units;
ALTER TABLE plans DROP COLUMN ai_session_units;
