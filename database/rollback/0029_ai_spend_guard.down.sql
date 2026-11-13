-- Rollback de 0029_ai_spend_guard.sql. Borra el registro de reservas de gasto, los límites editados y las
-- alertas (exportar antes si se quiere conservar el historial). No toca ninguna otra tabla.
-- Antes de aplicarlo, poner AI_SPEND_GUARD_MODE = 'off' o volver a una versión del Worker sin el control.
DROP INDEX IF EXISTS idx_ai_spend_open;
DROP INDEX IF EXISTS idx_ai_spend_store;
DROP INDEX IF EXISTS idx_ai_spend_day;
DROP INDEX IF EXISTS idx_ai_spend_month;
DROP TABLE IF EXISTS ai_spend_alerts;
DROP TABLE IF EXISTS ai_spend_limits;
DROP TABLE IF EXISTS ai_spend_reservations;
