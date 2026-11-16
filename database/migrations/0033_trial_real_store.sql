-- 0033: prueba gratuita real. La prueba ya no es una mini tienda aparte: es una tienda normal de la
-- plataforma (mismo registro, mismo panel, mismo catálogo) con derechos temporales. Al contratar un plan
-- se actualizan los derechos de ESA misma tienda; no se copia ni se mueve nada.
-- Migración solo aditiva: no cambia planes, tiendas, pedidos ni datos existentes.
-- Numerada 0033 porque 0024-0032 ya están reservadas por otras ramas.
-- Reversión: database/rollback/0033_trial_real_store.down.sql

-- Fin de la prueba vigente de la tienda (UTC, 'YYYY-MM-DD HH:MM:SS'). NULL = la tienda no está en prueba.
-- Se guarda en la tienda para que la vitrina pública lo sepa sin consultas adicionales.
ALTER TABLE stores ADD COLUMN trial_ends_at TEXT DEFAULT NULL;

-- Derechos del periodo de prueba (plan INACTIVO: no aparece en listados ni en el bot maestro; solo lo
-- asigna el registro de prueba). Sin IA (presupuesto 0) y con 7 productos.
INSERT OR IGNORE INTO plans (code, name, setup_price, monthly_price, annual_price, currency, ai_monthly_budget_micros, max_products,
                             products_unlimited, features_json, is_active, sort_order, ai_monthly_messages, ai_usage_policy, ai_budget_policy)
VALUES ('prueba', 'Prueba gratuita', 0, 0, 0, 'COP', 0, 7, 0, '["catalogo","pedidos_whatsapp","panel"]', 0, 0, 0, 'none', 'enforced');

-- Una fila por tienda creada desde el registro de prueba.
--   pendiente  → registrada, esperando que la persona confirme su correo (enlace de un solo uso)
--   activa     → prueba en curso (started_at … expires_at)
--   vencida    → terminó el plazo: datos conservados, sin productos ni pedidos nuevos
--   convertida → la misma tienda pasó a un plan pagado
CREATE TABLE IF NOT EXISTS store_trials (
    store_id INTEGER PRIMARY KEY REFERENCES stores(id),
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'activa', 'vencida', 'convertida')),
    -- SHA-256 del correo normalizado: una sola prueba por correo, sin guardar la dirección otra vez.
    email_hash TEXT NOT NULL,
    signup_ip_hash TEXT NOT NULL,
    product_limit INTEGER NOT NULL DEFAULT 7 CHECK (product_limit BETWEEN 1 AND 100),
    duration_days INTEGER NOT NULL DEFAULT 7 CHECK (duration_days BETWEEN 1 AND 60),
    started_at TEXT DEFAULT NULL,
    expires_at TEXT DEFAULT NULL,
    -- Retención recuperable propuesta (30 días tras vencer). NADA se borra automáticamente: solo se marca.
    retain_until TEXT DEFAULT NULL,
    extended_days INTEGER NOT NULL DEFAULT 0 CHECK (extended_days >= 0),
    notice_3d_at TEXT DEFAULT NULL,
    notice_1d_at TEXT DEFAULT NULL,
    notice_end_at TEXT DEFAULT NULL,
    converted_at TEXT DEFAULT NULL,
    converted_plan_code TEXT DEFAULT NULL,
    terms_version TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_trials_email ON store_trials(email_hash);
CREATE INDEX IF NOT EXISTS idx_store_trials_status ON store_trials(status, expires_at);

-- Contratación de un plan desde el panel. El plan se habilita SOLO cuando la plataforma verifica el pago
-- (procedimiento manual actual: factura marcada como pagada). La activación es transaccional e idempotente:
-- activation_op identifica la única ejecución que hizo el cambio.
CREATE TABLE IF NOT EXISTS store_plan_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    code TEXT NOT NULL UNIQUE,
    plan_code TEXT NOT NULL REFERENCES plans(code),
    billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('mensual', 'anual')),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'COP',
    invoice_id INTEGER DEFAULT NULL REFERENCES store_invoices(id),
    status TEXT NOT NULL DEFAULT 'pendiente_pago' CHECK (status IN ('pendiente_pago', 'activada', 'cancelada')),
    requested_by TEXT NOT NULL,
    payment_reference TEXT DEFAULT NULL,
    verified_by TEXT DEFAULT NULL,
    activation_op TEXT DEFAULT NULL UNIQUE,
    activated_at TEXT DEFAULT NULL,
    cancelled_reason TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_plan_requests_open ON store_plan_requests(store_id) WHERE status = 'pendiente_pago';
CREATE INDEX IF NOT EXISTS idx_store_plan_requests_status ON store_plan_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_store_plan_requests_invoice ON store_plan_requests(invoice_id);
