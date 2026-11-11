-- 0023: cuota de mensajes con IA por plan (aditiva).
-- Solo agrega columnas y tablas nuevas y tres planes INACTIVOS. No modifica planes, tiendas, contratos
-- ni datos existentes. Mientras AI_MESSAGE_QUOTA_MODE sea 'off' (valor por defecto) nada de esto se usa.
-- Rollback: database/rollback/0023_ai_message_quota.down.sql

ALTER TABLE plans ADD COLUMN annual_price INTEGER NOT NULL DEFAULT 0;
-- NULL = sin tope numérico (uso conversacional ampliado, con monitoreo).
ALTER TABLE plans ADD COLUMN ai_monthly_messages INTEGER DEFAULT NULL;
-- 'none' (sin control de mensajes), 'quota' (tope por ciclo) o 'monitored' (ampliado, solo monitoreo).
ALTER TABLE plans ADD COLUMN ai_usage_policy TEXT NOT NULL DEFAULT 'none';

-- Ciclo de consumo: día de facturación (1-28) cuando se conoce; NULL = se deduce del servicio activo o,
-- en su defecto, del mes calendario en America/Bogota (provisional).
ALTER TABLE stores ADD COLUMN ai_cycle_anchor_day INTEGER DEFAULT NULL;
-- Cuota particular (derechos vigentes, p. ej. clientes históricos). NULL = la del plan.
ALTER TABLE stores ADD COLUMN ai_monthly_messages_override INTEGER DEFAULT NULL;

-- Planes nuevos, INACTIVOS: no aparecen en el bot maestro ni en la conversión de pruebas hasta que se activen.
-- Los valores de presupuesto de costo y de productos son provisionales y se confirman antes de activarlos.
INSERT OR IGNORE INTO plans (code, name, setup_price, monthly_price, annual_price, currency, ai_monthly_budget_micros, max_products, features_json, is_active, sort_order, ai_monthly_messages, ai_usage_policy) VALUES
    ('emprendedor', 'Emprendedor', 149000, 59900, 599000, 'COP', 2000000, 500, '["catalogo","pedidos_whatsapp","panel","telegram","asistente_ia","voz"]', 0, 4, 500, 'quota'),
    ('negocio', 'Negocio', 199000, 99900, 999000, 'COP', 6000000, 2000, '["catalogo","pedidos_whatsapp","panel","telegram","asistente_ia","fotos_ia","voz","documentos"]', 0, 5, NULL, 'monitored'),
    ('mayorista', 'Mayorista', 299000, 169900, 1699000, 'COP', 10000000, 5000, '["catalogo","pedidos_whatsapp","panel","telegram","asistente_ia","fotos_ia","voz","documentos"]', 0, 6, NULL, 'monitored');

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
