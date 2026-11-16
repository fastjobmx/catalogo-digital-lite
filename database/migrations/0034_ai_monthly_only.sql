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

-- API propia. Google no ofrece forma de verificar el nivel (gratuito / facturación) con solo la clave: el nivel se
-- muestra en Google AI Studio (Projects → «Billing Tier»). Por eso el estado nunca se infiere:
--   no_verificada          (por defecto)
--   gratuita_confirmada    el propietario confirma que su proyecto está en el nivel gratuito
--   facturacion_verificada la plataforma revisó la evidencia (Billing Tier de AI Studio) y lo dejó registrado
-- billing_declared_at: el propietario declaró facturación y espera revisión. signals: indicios observados (por ejemplo
-- «imagen generada», «límite gratuito observado»), que se muestran como indicios y nunca cambian el estado.
ALTER TABLE store_ai_keys ADD COLUMN tier TEXT NOT NULL DEFAULT 'no_verificada' CHECK (tier IN ('no_verificada', 'gratuita_confirmada', 'facturacion_verificada'));
ALTER TABLE store_ai_keys ADD COLUMN billing_declared_at TEXT DEFAULT NULL;
ALTER TABLE store_ai_keys ADD COLUMN tier_verified_by TEXT DEFAULT NULL;
ALTER TABLE store_ai_keys ADD COLUMN tier_verified_at TEXT DEFAULT NULL;
ALTER TABLE store_ai_keys ADD COLUMN tier_note TEXT DEFAULT NULL;
ALTER TABLE store_ai_keys ADD COLUMN signals TEXT NOT NULL DEFAULT '[]';
-- Capacidad de imágenes observada en llamadas reales (no es una verificación de facturación).
ALTER TABLE store_ai_keys ADD COLUMN image_capability TEXT NOT NULL DEFAULT 'sin_verificar' CHECK (image_capability IN ('sin_verificar', 'disponible', 'no_disponible'));
ALTER TABLE store_ai_keys ADD COLUMN last_error_detail TEXT DEFAULT NULL;
-- Qué hacer con tareas que llevan datos de compradores cuando la clave no tiene facturación verificada:
-- preguntar (por defecto: no se procesan con IA hasta que el propietario elija), plan (usar las consultas del plan
-- con TiendIA) o bloquear (nunca procesarlas con IA).
ALTER TABLE store_ai_keys ADD COLUMN buyer_data_policy TEXT NOT NULL DEFAULT 'preguntar' CHECK (buyer_data_policy IN ('preguntar', 'plan', 'bloquear'));

-- Ruta de cada llamada, para que ningún cambio de proveedor o pagador sea silencioso en el historial:
-- own_key, plan, plan_respaldo (la API propia falló y el propietario autorizó el respaldo), plan_privacidad
-- (datos de compradores con autorización), creditos, plataforma, prueba.
ALTER TABLE ai_spend_reservations ADD COLUMN route TEXT DEFAULT NULL;
