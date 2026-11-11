-- 0023: cuota de mensajes con IA por plan (aditiva).
-- Solo agrega columnas y tablas nuevas y tres planes INACTIVOS. No modifica planes, tiendas, contratos
-- ni datos existentes. Mientras AI_MESSAGE_QUOTA_MODE sea 'off' (valor por defecto) nada de esto se usa.
-- Rollback: database/rollback/0023_ai_message_quota.down.sql

ALTER TABLE plans ADD COLUMN annual_price INTEGER NOT NULL DEFAULT 0;
-- NULL = sin tope numérico (uso conversacional ampliado, con monitoreo).
ALTER TABLE plans ADD COLUMN ai_monthly_messages INTEGER DEFAULT NULL;
-- 'none' (sin control de mensajes), 'quota' (tope por ciclo) o 'monitored' (ampliado, solo monitoreo).
ALTER TABLE plans ADD COLUMN ai_usage_policy TEXT NOT NULL DEFAULT 'none';

-- Productos ilimitados: 1 = el plan no impone tope de productos. Es la marca que usa el backend; el valor de
-- max_products (NOT NULL y > 0 en la tabla original) queda como marcador sin efecto para esos planes.
ALTER TABLE plans ADD COLUMN products_unlimited INTEGER NOT NULL DEFAULT 0;
-- Incluidos por mes en la oferta comercial (NULL = sin cifra: uso razonable por definir). Hoy solo se OBSERVAN
-- (se muestran y se registran); no bloquean.
ALTER TABLE plans ADD COLUMN ai_photo_monthly INTEGER DEFAULT NULL;
ALTER TABLE plans ADD COLUMN ai_description_monthly INTEGER DEFAULT NULL;
-- 'enforced' (planes existentes): el presupuesto de costo mensual bloquea la IA al agotarse.
-- 'observe': el presupuesto solo alerta y se registra; no interrumpe al comercio.
ALTER TABLE plans ADD COLUMN ai_budget_policy TEXT NOT NULL DEFAULT 'enforced';

-- Ciclo de consumo: día de facturación (1-28) cuando se conoce; NULL = se deduce del servicio activo o,
-- en su defecto, del mes calendario en America/Bogota (provisional).
ALTER TABLE stores ADD COLUMN ai_cycle_anchor_day INTEGER DEFAULT NULL;
-- Cuota particular (derechos vigentes, p. ej. clientes históricos). NULL = la del plan.
ALTER TABLE stores ADD COLUMN ai_monthly_messages_override INTEGER DEFAULT NULL;

-- Planes nuevos, INACTIVOS: no aparecen en el bot maestro ni en la conversión de pruebas hasta que se activen.
-- Oferta comercial: Emprendedor 150 productos, 500 mensajes, 50 fotos IA y 200 descripciones al mes; Negocio 500
-- productos y 150 fotos; Mayorista productos ilimitados y 400 fotos. Negocio y Mayorista: bot de uso ampliado y
-- descripciones con uso razonable por definir (sin cifra). ai_monthly_budget_micros es solo una REFERENCIA DE ALERTA
-- (ai_budget_policy = 'observe'): no interrumpe al comercio. Los valores se confirman antes de activar los planes.
-- Mayorista guarda max_products = 2147483647 solo porque la columna es NOT NULL; lo que manda es products_unlimited.
INSERT OR IGNORE INTO plans (code, name, setup_price, monthly_price, annual_price, currency, ai_monthly_budget_micros, max_products, products_unlimited, features_json, is_active, sort_order, ai_monthly_messages, ai_usage_policy, ai_photo_monthly, ai_description_monthly, ai_budget_policy) VALUES
    ('emprendedor', 'Emprendedor', 149000, 59900, 599000, 'COP', 5000000, 150, 0, '["catalogo","pedidos_whatsapp","panel","telegram","asistente_ia","fotos_ia","voz"]', 0, 4, 500, 'quota', 50, 200, 'observe'),
    ('negocio', 'Negocio', 199000, 99900, 999000, 'COP', 14000000, 500, 0, '["catalogo","pedidos_whatsapp","panel","telegram","asistente_ia","fotos_ia","voz","documentos"]', 0, 5, NULL, 'monitored', 150, NULL, 'observe'),
    ('mayorista', 'Mayorista', 299000, 169900, 1699000, 'COP', 40000000, 2147483647, 1, '["catalogo","pedidos_whatsapp","panel","telegram","asistente_ia","fotos_ia","voz","documentos"]', 0, 6, NULL, 'monitored', 400, NULL, 'observe');

-- Un renglón por interacción con IA. La clave (store_id, event_key) impide contar dos veces el mismo
-- evento de Telegram. No guarda el contenido de los mensajes ni de las notas de voz.
CREATE TABLE IF NOT EXISTS ai_message_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    cycle_key TEXT NOT NULL,
    event_key TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'telegram_text' CHECK (channel IN ('telegram_text', 'telegram_voice')),
    feature TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'consumed', 'released')),
    mode TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'enforce')),
    plan_code TEXT DEFAULT NULL,
    limit_at_time INTEGER DEFAULT NULL,
    fingerprint TEXT DEFAULT NULL,
    audio_seconds INTEGER NOT NULL DEFAULT 0,
    ai_cost_micros INTEGER NOT NULL DEFAULT 0,
    transcription_cost_micros INTEGER NOT NULL DEFAULT 0,
    calls INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    consumed_at TEXT DEFAULT NULL,
    UNIQUE (store_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_message_ledger_cycle ON ai_message_ledger(store_id, cycle_key, status);
CREATE INDEX IF NOT EXISTS idx_ai_message_ledger_recent ON ai_message_ledger(store_id, created_at);

-- Avisos ya enviados por tienda y ciclo (80 % y 100 %): uno solo por umbral.
CREATE TABLE IF NOT EXISTS ai_message_alerts (
    store_id INTEGER NOT NULL REFERENCES stores(id),
    cycle_key TEXT NOT NULL,
    threshold INTEGER NOT NULL CHECK (threshold IN (80, 100)),
    used INTEGER NOT NULL DEFAULT 0,
    quota INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, cycle_key, threshold)
);
