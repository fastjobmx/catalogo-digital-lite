-- 0037: pago del plan de TiendIA Exprés en línea con Bold (cuenta Bold de la plataforma).
-- Cada vez que el comercio abre la pasarela se crea un intento con referencia única. El plan se activa solo
-- cuando Bold confirma el pago (webhook firmado o consulta), por el valor exacto de la contratación.
CREATE TABLE IF NOT EXISTS plan_payment_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES store_plan_requests(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    provider TEXT NOT NULL DEFAULT 'bold',
    reference TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'COP',
    mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
    status TEXT NOT NULL DEFAULT 'creado' CHECK (status IN ('creado', 'en_proceso', 'aprobado', 'rechazado', 'fallido', 'anulado', 'monto_distinto')),
    provider_tx_id TEXT,
    provider_method TEXT,
    last_source TEXT,
    outcome TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plan_payment_attempts_request ON plan_payment_attempts (request_id, id);
CREATE INDEX IF NOT EXISTS idx_plan_payment_attempts_open ON plan_payment_attempts (status, created_at);
