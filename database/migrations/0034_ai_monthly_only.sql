-- 0034: cupo mensual único (sin sesiones de 5 horas), avisos de consumo y capacidades de la API propia (aditiva).
-- Decisión comercial del 2026-11-15: cada comercio usa su cupo mensual cuando lo necesite; no hay cupos diarios,
-- semanales ni por sesión. Las tablas y columnas de sesiones de 0030 se conservan sin uso (no se borran datos).
-- Número 0034 para no chocar con 0033 de la rama de la prueba gratis.
-- Rollback: database/rollback/0034_ai_monthly_only.down.sql

UPDATE plans SET ai_session_units = NULL WHERE ai_session_units IS NOT NULL;
UPDATE stores SET ai_session_units_override = NULL WHERE ai_session_units_override IS NOT NULL;

-- Avisos de consumo del cupo mensual (50, 75, 90 y 100 %): una sola vez por tienda, ciclo y umbral.
CREATE TABLE IF NOT EXISTS ai_quota_notices (
    store_id INTEGER NOT NULL REFERENCES stores(id),
    cycle_key TEXT NOT NULL,
    threshold INTEGER NOT NULL CHECK (threshold IN (50, 75, 90, 100)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, cycle_key, threshold)
);

-- API propia: nivel detectado (gratuito o con facturación), si puede generar imágenes y el último límite o error de
-- Google en forma legible (cuota, valor, espera). Nunca la clave.
ALTER TABLE store_ai_keys ADD COLUMN tier TEXT NOT NULL DEFAULT 'desconocido' CHECK (tier IN ('desconocido', 'gratuito', 'facturacion'));
ALTER TABLE store_ai_keys ADD COLUMN image_capability TEXT NOT NULL DEFAULT 'sin_verificar' CHECK (image_capability IN ('sin_verificar', 'disponible', 'no_disponible'));
ALTER TABLE store_ai_keys ADD COLUMN last_error_detail TEXT DEFAULT NULL;
