-- ============================================================================
-- 0007 · Plataforma multitienda
-- ----------------------------------------------------------------------------
-- * Registro de tiendas, usuarios, membresías y roles.
-- * Planes, servicios contratados, presupuesto y consumo de IA por tienda.
-- * Aprovisionamiento idempotente, operaciones del bot maestro y eventos.
-- * Catálogo con unicidad por tienda: (store_id, sku) y (store_id, slug).
--
-- Los datos existentes se conservan y se asignan a la tienda 1 (la tienda
-- principal de la instalación). Las tablas de catálogo se reconstruyen en
-- orden hoja → raíz para que ningún DROP dispare acciones ON DELETE.
-- Reversión documentada en database/rollback/0007_multi_tenant_platform.down.sql
-- ============================================================================

PRAGMA defer_foreign_keys = on;

-- 1. Registro de tiendas ------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE
        CHECK (length(slug) BETWEEN 3 AND 40 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT GLOB '-*' AND slug NOT GLOB '*-'),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'suspended', 'cancelled')),
    plan_code TEXT NOT NULL DEFAULT 'basico',
    template TEXT NOT NULL DEFAULT 'moderno',
    business_type TEXT NOT NULL DEFAULT '',
    ai_enabled INTEGER NOT NULL DEFAULT 1 CHECK (ai_enabled IN (0, 1)),
    ai_monthly_budget_micros INTEGER NOT NULL DEFAULT 2000000 CHECK (ai_monthly_budget_micros >= 0),
    ai_warn_percent INTEGER NOT NULL DEFAULT 80 CHECK (ai_warn_percent BETWEEN 1 AND 100),
    suspended_reason TEXT DEFAULT NULL,
    created_by TEXT NOT NULL DEFAULT 'migration',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    activated_at TEXT DEFAULT NULL,
    suspended_at TEXT DEFAULT NULL
);

-- La tienda principal conserva su identificador 1. Su slug se deriva del nombre
-- cuando es seguro; si no, se usa "principal" y puede cambiarse después.
INSERT INTO stores (id, slug, name, status, plan_code, template, business_type, ai_monthly_budget_micros, created_by, activated_at)
SELECT 1,
       CASE WHEN length(candidate) BETWEEN 3 AND 40 AND candidate NOT GLOB '*[^a-z0-9-]*'
                 AND candidate NOT GLOB '-*' AND candidate NOT GLOB '*-' AND candidate NOT GLOB '*--*'
            THEN candidate ELSE 'principal' END,
       store_name, 'active', 'legacy', 'personalizado', business, 5000000, 'migration', datetime('now')
FROM (
    SELECT lower(replace(replace(trim(COALESCE((SELECT name FROM store_config WHERE id = 1), '')), ' ', '-'), '_', '-')) AS candidate,
           COALESCE((SELECT name FROM store_config WHERE id = 1), 'Tienda principal') AS store_name,
           COALESCE((SELECT business_type FROM store_config WHERE id = 1), '') AS business
)
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE id = 1);

CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);

CREATE TABLE IF NOT EXISTS store_domains (
    domain TEXT PRIMARY KEY COLLATE NOCASE,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'verificado', 'activo', 'retirado')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_store_domains_store ON store_domains(store_id);

-- 2. Usuarios, membresías y accesos ------------------------------------------
-- El superadministrador de plataforma se define solo por secretos del Worker
-- (ADMIN_EMAIL / MASTER_ADMIN_TELEGRAM_IDS); nunca por filas de esta tabla.
CREATE TABLE IF NOT EXISTS platform_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT DEFAULT NULL,
    telegram_user_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS store_memberships (
    store_id INTEGER NOT NULL REFERENCES stores(id),
    user_id INTEGER NOT NULL REFERENCES platform_users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON store_memberships(user_id, status);

-- Tokens de un solo uso (activación de cuenta y vinculación de Telegram).
-- Solo se guarda el hash SHA-256; el valor en claro se entrega una vez.
CREATE TABLE IF NOT EXISTS user_access_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES platform_users(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('activation', 'telegram_link', 'password_reset')),
    expires_at INTEGER NOT NULL,
    used_at INTEGER DEFAULT NULL,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_access_tokens_user ON user_access_tokens(user_id, purpose);

-- Contexto conversacional del asistente por usuario de Telegram.
CREATE TABLE IF NOT EXISTS telegram_sessions (
    telegram_user_id TEXT PRIMARY KEY,
    active_store_id INTEGER REFERENCES stores(id),
    context_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS assistant_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    telegram_user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation ON assistant_messages(store_id, telegram_user_id, id DESC);

-- 3. Planes, servicios y consumo de IA ---------------------------------------
CREATE TABLE IF NOT EXISTS plans (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    setup_price INTEGER NOT NULL DEFAULT 0 CHECK (setup_price >= 0),
    monthly_price INTEGER NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
    currency TEXT NOT NULL DEFAULT 'COP',
    ai_monthly_budget_micros INTEGER NOT NULL DEFAULT 0 CHECK (ai_monthly_budget_micros >= 0),
    max_products INTEGER NOT NULL DEFAULT 100 CHECK (max_products > 0),
    features_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- Precios en cero: son valores comerciales que el operador debe definir.
INSERT OR IGNORE INTO plans (code, name, ai_monthly_budget_micros, max_products, features_json, sort_order) VALUES
    ('basico', 'Básico', 1000000, 100, '["catalogo","pedidos_whatsapp","panel","telegram"]', 1),
    ('profesional', 'Profesional', 3000000, 500, '["catalogo","pedidos_whatsapp","panel","telegram","asistente_ia","fotos_ia","voz"]', 2),
    ('premium', 'Premium', 8000000, 2000, '["catalogo","pedidos_whatsapp","panel","telegram","asistente_ia","fotos_ia","voz","documentos","dominio_propio"]', 3),
    ('legacy', 'Instalación existente', 5000000, 2000, '["catalogo","pedidos_whatsapp","panel","telegram","asistente_ia","fotos_ia","voz","documentos"]', 9);

CREATE TABLE IF NOT EXISTS store_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    service_code TEXT NOT NULL CHECK (service_code IN ('instalacion', 'mantenimiento_mensual', 'dominio_propio', 'personalizacion_visual', 'asistente_ia', 'soporte_prioritario', 'otro')),
    billing TEXT NOT NULL DEFAULT 'unico' CHECK (billing IN ('unico', 'mensual', 'anual')),
    price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
    currency TEXT NOT NULL DEFAULT 'COP',
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'activo', 'suspendido', 'cancelado')),
    starts_at TEXT DEFAULT NULL,
    ends_at TEXT DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_store_services_store ON store_services(store_id, status);

CREATE TABLE IF NOT EXISTS ai_usage_monthly (
    store_id INTEGER NOT NULL REFERENCES stores(id),
    period TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    blocked_requests INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_micros INTEGER NOT NULL DEFAULT 0,
    warned_at TEXT DEFAULT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, period)
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    period TEXT NOT NULL,
    feature TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('ok', 'blocked', 'error')),
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_micros INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_store ON ai_usage_events(store_id, period);

-- 4. Aprovisionamiento, bot maestro y eventos --------------------------------
CREATE TABLE IF NOT EXISTS provisioning_jobs (
    id TEXT PRIMARY KEY,
    request_key TEXT NOT NULL UNIQUE,
    store_id INTEGER REFERENCES stores(id),
    slug TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    current_step TEXT DEFAULT NULL,
    steps_json TEXT NOT NULL DEFAULT '[]',
    input_json TEXT NOT NULL,
    result_json TEXT DEFAULT NULL,
    error_code TEXT DEFAULT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_status ON provisioning_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS platform_operations (
    operation_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    params_json TEXT NOT NULL DEFAULT '{}',
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applying', 'applied', 'cancelled', 'expired', 'failed')),
    result_json TEXT DEFAULT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT DEFAULT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_one_open_operation
    ON platform_operations(chat_id) WHERE status IN ('pending', 'applying');

CREATE TABLE IF NOT EXISTS platform_conversations (
    chat_id TEXT PRIMARY KEY,
    flow TEXT NOT NULL,
    step TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    expires_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- El bot maestro y el asistente tienen secuencias update_id independientes.
CREATE TABLE IF NOT EXISTS platform_processed_updates (
    bot TEXT NOT NULL,
    update_id INTEGER NOT NULL,
    processed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (bot, update_id)
);

CREATE TABLE IF NOT EXISTS platform_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER DEFAULT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
    source TEXT NOT NULL,
    code TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_platform_events_created ON platform_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_events_store ON platform_events(store_id, created_at DESC);

-- 5. Columnas de tienda en tablas existentes (aditivo) -----------------------
ALTER TABLE orders ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_orders_store_created ON orders(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_store_status ON orders(store_id, status);

ALTER TABLE audit_log ADD COLUMN store_id INTEGER DEFAULT NULL;
UPDATE audit_log SET store_id = 1 WHERE store_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_store_created ON audit_log(store_id, created_at DESC);

ALTER TABLE telegram_operations ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;

-- 6. Catálogo con unicidad por tienda ----------------------------------------
-- Los disparadores de pedidos referencian tablas que se reconstruyen. Se
-- eliminan y se recrean idénticos (el de auditoría ahora registra store_id).
DROP TRIGGER IF EXISTS trg_order_confirm_requires_stock;
DROP TRIGGER IF EXISTS trg_order_confirm_reserve_stock;
DROP TRIGGER IF EXISTS trg_order_cancel_release_stock;
DROP TRIGGER IF EXISTS trg_orders_created_history;

CREATE TABLE mt_sequence_backup AS
    SELECT name, seq FROM sqlite_sequence
    WHERE name IN ('categories', 'products', 'product_variants', 'order_inventory_operations');

CREATE TABLE categories_v7 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL DEFAULT 1 REFERENCES stores(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (store_id, slug)
);
INSERT INTO categories_v7 (id, store_id, name, slug, description, sort_order, is_active, created_at, updated_at)
    SELECT id, 1, name, slug, description, sort_order, is_active, created_at, updated_at FROM categories;

CREATE TABLE products_v7 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL DEFAULT 1 REFERENCES stores(id),
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    brand TEXT DEFAULT NULL,
    category_id INTEGER DEFAULT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    compare_at_price INTEGER DEFAULT NULL,
    is_featured INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_archived INTEGER NOT NULL DEFAULT 0,
    image_urls TEXT NOT NULL DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories_v7(id) ON DELETE SET NULL,
    UNIQUE (store_id, sku)
);
INSERT INTO products_v7 (id, store_id, sku, name, description, brand, category_id, price, compare_at_price, is_featured,
                         is_active, is_archived, image_urls, metadata, created_at, updated_at)
    SELECT id, 1, sku, name, description, brand, category_id, price, compare_at_price, is_featured,
           is_active, is_archived, image_urls, metadata, created_at, updated_at FROM products;

CREATE TABLE product_variants_v7 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    size TEXT DEFAULT NULL,
    color TEXT DEFAULT NULL,
    price_override INTEGER DEFAULT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    image_url TEXT DEFAULT NULL,
    FOREIGN KEY (product_id) REFERENCES products_v7(id) ON DELETE CASCADE,
    UNIQUE (product_id, sku)
);
INSERT INTO product_variants_v7 (id, product_id, sku, name, size, color, price_override, stock, is_active, sort_order,
                                 created_at, updated_at, image_url)
    SELECT id, product_id, sku, name, size, color, price_override, stock, is_active, sort_order,
           created_at, updated_at, image_url FROM product_variants;

CREATE TABLE order_inventory_operations_v7 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    variant_id INTEGER NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('reserve', 'release')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (order_id, variant_id, operation),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants_v7(id) ON DELETE RESTRICT
);
INSERT INTO order_inventory_operations_v7 (id, order_id, variant_id, operation, quantity, created_at)
    SELECT id, order_id, variant_id, operation, quantity, created_at FROM order_inventory_operations;

-- Hoja → raíz: ninguna tabla eliminada es referenciada por filas restantes.
DROP TABLE order_inventory_operations;
DROP TABLE product_variants;
DROP TABLE products;
DROP TABLE categories;

ALTER TABLE categories_v7 RENAME TO categories;
ALTER TABLE products_v7 RENAME TO products;
ALTER TABLE product_variants_v7 RENAME TO product_variants;
ALTER TABLE order_inventory_operations_v7 RENAME TO order_inventory_operations;

-- Conserva los contadores AUTOINCREMENT para no reutilizar IDs históricos
-- referenciados por instantáneas de pedidos.
UPDATE sqlite_sequence
   SET seq = MAX(seq, COALESCE((SELECT b.seq FROM mt_sequence_backup b WHERE b.name = sqlite_sequence.name), 0))
 WHERE name IN ('categories', 'products', 'product_variants', 'order_inventory_operations');
INSERT INTO sqlite_sequence (name, seq)
    SELECT b.name, b.seq FROM mt_sequence_backup b
    WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence s WHERE s.name = b.name);
DROP TABLE mt_sequence_backup;

CREATE INDEX IF NOT EXISTS idx_categories_store_active ON categories(store_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_store_active ON products(store_id, is_active, is_archived);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);

-- 7. Disparadores de pedidos (misma lógica que 0006) -------------------------
CREATE TRIGGER IF NOT EXISTS trg_orders_created_history
AFTER INSERT ON orders
BEGIN
  INSERT INTO order_events (order_id, event_type, to_value, performed_by)
  VALUES (NEW.id, 'created', 'pendiente', 'storefront');
  INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id)
  VALUES ('order_created', 'order', CAST(NEW.id AS TEXT),
    json_object('displayId', NEW.display_id, 'subtotal', NEW.subtotal, 'items', json_array_length(NEW.items_json)),
    'storefront', 'api', NEW.store_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_order_confirm_requires_stock
BEFORE UPDATE OF status ON orders
WHEN OLD.status = 'pendiente' AND NEW.status = 'confirmado'
  AND OLD.inventory_managed = 1
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM (
      SELECT CAST(json_extract(value, '$.variantId') AS INTEGER) AS variant_id,
             SUM(CAST(json_extract(value, '$.quantity') AS INTEGER)) AS quantity
      FROM json_each(OLD.items_json) GROUP BY CAST(json_extract(value, '$.variantId') AS INTEGER)
    ) requested LEFT JOIN product_variants v ON v.id = requested.variant_id
    LEFT JOIN products p ON p.id = v.product_id
    WHERE v.id IS NULL OR v.stock < requested.quantity OR p.store_id IS NOT OLD.store_id
  ) THEN RAISE(ABORT, 'insufficient order inventory') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_order_confirm_reserve_stock
AFTER UPDATE OF status ON orders
WHEN OLD.status = 'pendiente' AND NEW.status = 'confirmado'
  AND OLD.inventory_managed = 1
BEGIN
  UPDATE product_variants SET stock = stock - (
    SELECT SUM(CAST(json_extract(value, '$.quantity') AS INTEGER)) FROM json_each(NEW.items_json)
    WHERE CAST(json_extract(value, '$.variantId') AS INTEGER) = product_variants.id
  ) WHERE id IN (SELECT CAST(json_extract(value, '$.variantId') AS INTEGER) FROM json_each(NEW.items_json));
  INSERT OR IGNORE INTO order_inventory_operations (order_id, variant_id, operation, quantity)
    SELECT NEW.id, CAST(json_extract(value, '$.variantId') AS INTEGER), 'reserve',
      SUM(CAST(json_extract(value, '$.quantity') AS INTEGER))
    FROM json_each(NEW.items_json) GROUP BY CAST(json_extract(value, '$.variantId') AS INTEGER);
  UPDATE orders SET inventory_reserved_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_order_cancel_release_stock
AFTER UPDATE OF status ON orders
WHEN NEW.status = 'cancelado' AND OLD.status IN ('confirmado', 'preparando')
  AND OLD.inventory_managed = 1
BEGIN
  UPDATE product_variants SET stock = stock + (
    SELECT reserve.quantity FROM order_inventory_operations reserve
    WHERE reserve.order_id = OLD.id AND reserve.variant_id = product_variants.id AND reserve.operation = 'reserve'
      AND NOT EXISTS (SELECT 1 FROM order_inventory_operations release
        WHERE release.order_id = OLD.id AND release.variant_id = product_variants.id AND release.operation = 'release')
  ) WHERE id IN (SELECT variant_id FROM order_inventory_operations WHERE order_id = OLD.id AND operation = 'reserve'
    AND NOT EXISTS (SELECT 1 FROM order_inventory_operations release WHERE release.order_id = OLD.id
      AND release.variant_id = order_inventory_operations.variant_id AND release.operation = 'release'));
  INSERT OR IGNORE INTO order_inventory_operations (order_id, variant_id, operation, quantity)
    SELECT order_id, variant_id, 'release', quantity FROM order_inventory_operations
    WHERE order_id = OLD.id AND operation = 'reserve';
  UPDATE orders SET inventory_reserved_at = NULL WHERE id = OLD.id;
END;
