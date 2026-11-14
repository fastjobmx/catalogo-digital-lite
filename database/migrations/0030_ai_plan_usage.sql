-- 0030: consultas inteligentes por sesión de 5 horas y por mes (aditiva).
-- Solo agrega columnas, tablas y los cupos de los tres planes nuevos (INACTIVOS, sin tiendas). No toca los planes
-- anteriores (basico, profesional, premium, legacy): sus columnas nuevas quedan NULL = sin cupo de consultas.
-- Las consultas solo se hacen cumplir con AI_SPEND_GUARD_MODE = 'enforce'; en 'shadow' se cuentan sin bloquear.
-- Rollback: database/rollback/0030_ai_plan_usage.down.sql

ALTER TABLE plans ADD COLUMN ai_session_units INTEGER DEFAULT NULL;
ALTER TABLE plans ADD COLUMN ai_monthly_units INTEGER DEFAULT NULL;
-- Presupuesto interno de IA en COP (tope de costo real de la tienda; se convierte con AI_FX_COP_PER_USD).
ALTER TABLE plans ADD COLUMN ai_monthly_budget_cop INTEGER DEFAULT NULL;
-- Créditos artísticos que el plan asigna cada ciclo (vencen al terminar el ciclo).
ALTER TABLE plans ADD COLUMN ai_monthly_credits INTEGER DEFAULT NULL;

-- Excepciones por tienda (contratos anteriores, acuerdos). NULL = lo del plan.
ALTER TABLE stores ADD COLUMN ai_session_units_override INTEGER DEFAULT NULL;
ALTER TABLE stores ADD COLUMN ai_monthly_units_override INTEGER DEFAULT NULL;

-- Los planes nuevos cuentan consultas (no mensajes): se apaga para ellos la cuota de mensajes de 0023.
UPDATE plans SET ai_session_units = 30, ai_monthly_units = 300, ai_monthly_budget_cop = 6000, ai_monthly_credits = 30,
  ai_monthly_messages = NULL, ai_usage_policy = 'none' WHERE code = 'emprendedor';
UPDATE plans SET ai_session_units = 80, ai_monthly_units = 1000, ai_monthly_budget_cop = 15000, ai_monthly_credits = 80,
  ai_monthly_messages = NULL, ai_usage_policy = 'none' WHERE code = 'negocio';
UPDATE plans SET ai_session_units = 200, ai_monthly_units = 2500, ai_monthly_budget_cop = 35000, ai_monthly_credits = 180,
  ai_monthly_messages = NULL, ai_usage_policy = 'none' WHERE code = 'mayorista';

-- Sesión de 5 horas: empieza con la primera consulta de IA de la tienda.
CREATE TABLE IF NOT EXISTS ai_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    started_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    units_limit INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_open ON ai_sessions (store_id, ends_at);

-- Peso de cada operación en consultas equivalentes (visible para el comerciante). per_item: se multiplica por
-- la cantidad de fotos o documentos de la solicitud.
CREATE TABLE IF NOT EXISTS ai_unit_weights (
    feature TEXT PRIMARY KEY,
    units INTEGER NOT NULL CHECK (units >= 0),
    per_item INTEGER NOT NULL DEFAULT 0 CHECK (per_item IN (0, 1)),
    label TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT 'migracion-0030',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO ai_unit_weights (feature, units, per_item, label) VALUES
    ('interpretacion', 1, 0, 'Mensaje interpretado con IA'),
    ('pregunta', 1, 0, 'Pregunta respondida con IA'),
    ('consejos', 1, 0, 'Consejos con IA'),
    ('identidad_visual', 1, 0, 'Sugerencia de colores con IA'),
    ('creativo_texto', 1, 0, 'Textos comerciales con IA'),
    ('pedidos', 2, 0, 'Consulta o reporte de pedidos con IA'),
    ('voz', 4, 0, 'Nota de voz (hasta 2 minutos)'),
    ('fotos_ia', 4, 0, 'Foto a producto con IA'),
    ('foto_a_producto', 4, 0, 'Foto a producto con IA'),
    ('descripcion', 4, 0, 'Descripción con IA'),
    ('agrupar_fotos', 2, 1, 'Organizar fotos de un lote (por foto)'),
    ('documentos', 4, 1, 'Leer un documento (por archivo)'),
    ('importar_pdf_pagina', 4, 0, 'Leer una página de PDF'),
    ('leer_guia_envio', 4, 0, 'Leer una guía de envío'),
    ('estudio_imagen', 0, 0, 'Imagen premium (usa créditos)'),
    ('foto_packshot', 0, 0, 'Imagen premium (usa créditos)'),
    ('foto_premium', 0, 0, 'Imagen premium (usa créditos)'),
    ('video_ia_segundo', 0, 0, 'Video con IA (usa créditos)');

-- Cada reserva de gasto lleva quién paga, cuántas consultas descuenta y su huella (nunca el contenido).
ALTER TABLE ai_spend_reservations ADD COLUMN units INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_spend_reservations ADD COLUMN session_id INTEGER DEFAULT NULL;
ALTER TABLE ai_spend_reservations ADD COLUMN cycle_key TEXT DEFAULT NULL;
ALTER TABLE ai_spend_reservations ADD COLUMN billing_source TEXT NOT NULL DEFAULT 'plan';
ALTER TABLE ai_spend_reservations ADD COLUMN request_fingerprint TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_spend_cycle ON ai_spend_reservations (store_id, cycle_key);
CREATE INDEX IF NOT EXISTS idx_ai_spend_session ON ai_spend_reservations (session_id);
CREATE INDEX IF NOT EXISTS idx_ai_spend_fingerprint ON ai_spend_reservations (store_id, request_fingerprint, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_spend_recent ON ai_spend_reservations (store_id, created_at);
