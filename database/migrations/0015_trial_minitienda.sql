-- Mini tienda de prueba y conversión a cliente. Migración solo aditiva.

-- Ajustes de plataforma editables por el superadministrador sin cambiar código (clave → JSON).
CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Estado de cada prueba: activa (editable hasta expires_at), vencida (solo recuperable hasta
-- retain_until), convertida (pasó a una tienda real) o eliminada (archivos y datos borrados; la fila
-- queda solo para las métricas). product_count y template se guardan para las estadísticas.
ALTER TABLE trial_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'activa';
ALTER TABLE trial_sessions ADD COLUMN retain_until TEXT DEFAULT NULL;
ALTER TABLE trial_sessions ADD COLUMN product_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trial_sessions ADD COLUMN converted_store_id INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_trial_sessions_status ON trial_sessions(status, retain_until);

-- Solicitudes de activación hechas desde una prueba (una por prueba). No hay cobro en línea:
-- la plataforma confirma el plan y convierte la prueba en tienda; la conversión es idempotente.
-- El correo se verifica con la invitación de la cuenta (enlace de activación de un solo uso).
CREATE TABLE IF NOT EXISTS trial_conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trial_id TEXT NOT NULL UNIQUE REFERENCES trial_sessions(id),
    code TEXT NOT NULL UNIQUE,
    plan_choice TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    contact_phone TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'convertida', 'descartada')),
    store_id INTEGER DEFAULT NULL,
    plan_code TEXT DEFAULT NULL,
    result_json TEXT DEFAULT NULL,
    handled_by TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trial_conversions_status ON trial_conversions(status, created_at);

-- Pedidos reales de una tienda de prueba: el cliente envía su pedido por WhatsApp al número del
-- comercio. Se guarda el detalle calculado en el servidor (sin el teléfono del cliente) para que el
-- comercio lo vea y para las métricas. Se borran con la prueba.
CREATE TABLE IF NOT EXISTS trial_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trial_id TEXT NOT NULL REFERENCES trial_sessions(id),
    code TEXT NOT NULL UNIQUE,
    items_json TEXT NOT NULL,
    total INTEGER NOT NULL,
    customer_name TEXT DEFAULT NULL,
    note TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trial_orders_trial ON trial_orders(trial_id, created_at);
