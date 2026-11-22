-- 0035: pago en línea con el Botón de pagos de Bold (aditiva).
-- Llave de identidad (pública) en claro; llave secreta CIFRADA con la bóveda de la plataforma (AI_KEYS_MASTER_KEY,
-- datos asociados «store:<id>|bold|v<n>»). Nunca se devuelve la llave secreta al navegador: solo su pista.
-- El envío fijo de la tienda se suma al total que cobra Bold.
-- Rollback: database/rollback/0035_bold_payments.down.sql

CREATE TABLE IF NOT EXISTS store_payment_gateways (
    store_id INTEGER NOT NULL REFERENCES stores(id),
    provider TEXT NOT NULL CHECK (provider IN ('bold')),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
    identity_key TEXT NOT NULL,
    secret_ciphertext TEXT NOT NULL,
    secret_iv TEXT NOT NULL,
    secret_key_version INTEGER NOT NULL,
    secret_hint TEXT NOT NULL,
    shipping_fee INTEGER NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, provider)
);

-- Pedido pagado en línea: proveedor elegido al hacer el pedido.
ALTER TABLE orders ADD COLUMN payment_provider TEXT DEFAULT NULL;

-- Cada vez que el comprador abre la pasarela se crea un intento con una referencia única (order-id de Bold).
CREATE TABLE IF NOT EXISTS payment_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    order_id INTEGER NOT NULL REFERENCES orders(id),
    provider TEXT NOT NULL CHECK (provider IN ('bold')),
    reference TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
    status TEXT NOT NULL DEFAULT 'creado'
        CHECK (status IN ('creado', 'en_proceso', 'aprobado', 'rechazado', 'fallido', 'anulado', 'monto_distinto')),
    provider_tx_id TEXT,
    provider_method TEXT,
    last_source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_order ON payment_attempts (order_id, id);

-- Webhooks recibidos (idempotencia: Bold puede reenviar el mismo evento). Sin datos de tarjeta.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    reference TEXT,
    store_id INTEGER,
    result TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (provider, event_id)
);
