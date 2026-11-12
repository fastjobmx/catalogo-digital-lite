-- 0025: consumo de IA del asistente por WhatsApp, separado del de Telegram.
-- Aditiva: una tabla nueva y una columna nueva con valor NULL para todas las filas existentes.
-- Las cuotas y presupuestos actuales (ai_message_ledger, ai_usage_monthly) no cambian.

-- Interacciones con IA que entraron por WhatsApp. Solo observación: nunca bloquean ni alertan al comercio.
CREATE TABLE IF NOT EXISTS whatsapp_ai_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    cycle_key TEXT NOT NULL,
    event_key TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'voice')),
    feature TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'consumed', 'released')),
    fingerprint TEXT DEFAULT NULL,
    audio_seconds INTEGER NOT NULL DEFAULT 0,
    ai_cost_micros INTEGER NOT NULL DEFAULT 0,
    transcription_cost_micros INTEGER NOT NULL DEFAULT 0,
    calls INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    consumed_at TEXT DEFAULT NULL,
    UNIQUE (store_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_ledger_cycle ON whatsapp_ai_ledger(store_id, cycle_key, status);

-- Canal de cada llamada de IA: NULL = panel/Telegram (todo lo anterior), 'whatsapp' = asistente por WhatsApp.
-- Las llamadas de WhatsApp no suman al presupuesto mensual ni a las fotos/descripciones incluidas del plan.
ALTER TABLE ai_usage_events ADD COLUMN channel TEXT DEFAULT NULL;
