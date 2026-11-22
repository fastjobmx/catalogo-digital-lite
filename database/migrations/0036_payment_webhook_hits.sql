-- 0036: registro de cada aviso (webhook) que llega de la pasarela de pagos, aunque no se pueda aplicar
-- (referencia desconocida, firma inválida, JSON roto, evento repetido…). Sirve para comprobar que Bold
-- sí se comunica con la plataforma. Nunca guarda el cuerpo del aviso ni datos de tarjeta; se borra a los 90 días.
CREATE TABLE IF NOT EXISTS payment_webhook_hits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    result TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    event_type TEXT,
    event_id TEXT,
    reference TEXT,
    store_id INTEGER,
    signed INTEGER NOT NULL DEFAULT 0,
    body_bytes INTEGER NOT NULL DEFAULT 0,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_hits_store ON payment_webhook_hits (store_id, id);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_hits_received ON payment_webhook_hits (received_at);
