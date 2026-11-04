-- Fases 4–6: roles de empleados, marketing con consentimiento y facturación de la plataforma.
-- La única reconstrucción es store_memberships, para ampliar su CHECK de roles:
-- se copian todas las filas tal cual y se recrea el índice.

-- 1. Roles: vendedor y encargado de inventario ----------------------------------
CREATE TABLE store_memberships_v10 (
    store_id INTEGER NOT NULL REFERENCES stores(id),
    user_id INTEGER NOT NULL REFERENCES platform_users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'seller', 'inventory')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, user_id)
);
INSERT INTO store_memberships_v10 (store_id, user_id, role, status, created_by, created_at, updated_at)
    SELECT store_id, user_id, role, status, created_by, created_at, updated_at FROM store_memberships;
DROP TABLE store_memberships;
ALTER TABLE store_memberships_v10 RENAME TO store_memberships;
CREATE INDEX IF NOT EXISTS idx_memberships_user ON store_memberships(user_id, status);

-- 2. Marketing -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    code TEXT NOT NULL COLLATE NOCASE,
    kind TEXT NOT NULL CHECK (kind IN ('porcentaje', 'valor')),
    value INTEGER NOT NULL CHECK (value > 0),
    min_subtotal INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
    starts_at TEXT DEFAULT NULL,
    ends_at TEXT DEFAULT NULL,
    max_uses INTEGER DEFAULT NULL CHECK (max_uses IS NULL OR max_uses > 0),
    uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (store_id, code),
    CHECK (kind <> 'porcentaje' OR value <= 90)
);

ALTER TABLE orders ADD COLUMN coupon_code TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN discount_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN marketing_consent INTEGER NOT NULL DEFAULT 0;

-- Only customers who explicitly accepted promotions; unsubscribing is permanent until new consent.
CREATE TABLE IF NOT EXISTS customer_contacts (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    name TEXT DEFAULT NULL,
    consent INTEGER NOT NULL DEFAULT 0,
    consent_at TEXT DEFAULT NULL,
    unsubscribed_at TEXT DEFAULT NULL,
    source TEXT NOT NULL DEFAULT 'checkout',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, phone)
);

-- Campaigns are prepared and approved by the merchant; the platform never sends them on its own.
CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    coupon_code TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'aprobada', 'cancelada')),
    recipients INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    approved_by TEXT DEFAULT NULL,
    approved_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_campaigns_store ON campaigns(store_id, id DESC);

-- 3. Facturación de la plataforma ----------------------------------------------
CREATE TABLE IF NOT EXISTS store_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    service_id INTEGER DEFAULT NULL,
    period TEXT NOT NULL,
    concept TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'COP',
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'pagada', 'anulada')),
    due_date TEXT DEFAULT NULL,
    paid_at TEXT DEFAULT NULL,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_invoices_service_period ON store_invoices(store_id, service_id, period) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_store_invoices_status ON store_invoices(status, due_date);
