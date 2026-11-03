-- ============================================================================
-- Reversión de 0007_multi_tenant_platform.sql
-- ----------------------------------------------------------------------------
-- Solo es válida mientras la instalación tenga ÚNICAMENTE la tienda 1. Si hay
-- otras tiendas o datos fuera de la tienda 1, la guarda aborta la transacción
-- sin modificar nada. Para revertir con varias tiendas use D1 Time Travel
-- (ver docs/DESPLIEGUE_Y_RECUPERACION_3_0.md).
--
-- Debe ejecutarse junto con la reversión del Worker a una versión anterior a
-- la plataforma 3.0, porque el código nuevo requiere estas tablas.
-- ============================================================================

PRAGMA defer_foreign_keys = on;

CREATE TABLE mt_rollback_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO mt_rollback_guard (ok)
SELECT CASE WHEN EXISTS (SELECT 1 FROM stores WHERE id <> 1)
             OR EXISTS (SELECT 1 FROM store_config WHERE id <> 1)
             OR EXISTS (SELECT 1 FROM products WHERE store_id <> 1)
             OR EXISTS (SELECT 1 FROM categories WHERE store_id <> 1)
             OR EXISTS (SELECT 1 FROM orders WHERE store_id <> 1)
        THEN 0 ELSE 1 END;
DROP TABLE mt_rollback_guard;

DROP TRIGGER IF EXISTS trg_order_confirm_requires_stock;
DROP TRIGGER IF EXISTS trg_order_confirm_reserve_stock;
DROP TRIGGER IF EXISTS trg_order_cancel_release_stock;
DROP TRIGGER IF EXISTS trg_orders_created_history;

CREATE TABLE mt_sequence_backup AS
    SELECT name, seq FROM sqlite_sequence
    WHERE name IN ('categories', 'products', 'product_variants', 'order_inventory_operations');

CREATE TABLE categories_v6 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO categories_v6 (id, name, slug, description, sort_order, is_active, created_at, updated_at)
    SELECT id, name, slug, description, sort_order, is_active, created_at, updated_at FROM categories;

CREATE TABLE products_v6 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
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
    FOREIGN KEY (category_id) REFERENCES categories_v6(id) ON DELETE SET NULL
);
INSERT INTO products_v6 (id, sku, name, description, brand, category_id, price, compare_at_price, is_featured,
                         is_active, is_archived, image_urls, metadata, created_at, updated_at)
    SELECT id, sku, name, description, brand, category_id, price, compare_at_price, is_featured,
           is_active, is_archived, image_urls, metadata, created_at, updated_at FROM products;

CREATE TABLE product_variants_v6 (
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
    FOREIGN KEY (product_id) REFERENCES products_v6(id) ON DELETE CASCADE,
    UNIQUE(product_id, sku)
);
INSERT INTO product_variants_v6 (id, product_id, sku, name, size, color, price_override, stock, is_active, sort_order,
                                 created_at, updated_at, image_url)
    SELECT id, product_id, sku, name, size, color, price_override, stock, is_active, sort_order,
           created_at, updated_at, image_url FROM product_variants;

CREATE TABLE order_inventory_operations_v6 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    variant_id INTEGER NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('reserve', 'release')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(order_id, variant_id, operation),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants_v6(id) ON DELETE RESTRICT
);
INSERT INTO order_inventory_operations_v6 (id, order_id, variant_id, operation, quantity, created_at)
    SELECT id, order_id, variant_id, operation, quantity, created_at FROM order_inventory_operations;

DROP TABLE order_inventory_operations;
DROP TABLE product_variants;
DROP TABLE products;
DROP TABLE categories;

ALTER TABLE categories_v6 RENAME TO categories;
ALTER TABLE products_v6 RENAME TO products;
ALTER TABLE product_variants_v6 RENAME TO product_variants;
ALTER TABLE order_inventory_operations_v6 RENAME TO order_inventory_operations;

UPDATE sqlite_sequence
   SET seq = MAX(seq, COALESCE((SELECT b.seq FROM mt_sequence_backup b WHERE b.name = sqlite_sequence.name), 0))
 WHERE name IN ('categories', 'products', 'product_variants', 'order_inventory_operations');
INSERT INTO sqlite_sequence (name, seq)
    SELECT b.name, b.seq FROM mt_sequence_backup b
    WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence s WHERE s.name = b.name);
DROP TABLE mt_sequence_backup;

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active, is_archived);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

DROP INDEX IF EXISTS idx_orders_store_created;
DROP INDEX IF EXISTS idx_orders_store_status;
ALTER TABLE orders DROP COLUMN store_id;
DROP INDEX IF EXISTS idx_audit_store_created;
ALTER TABLE audit_log DROP COLUMN store_id;
ALTER TABLE telegram_operations DROP COLUMN store_id;

DROP TABLE IF EXISTS platform_events;
DROP TABLE IF EXISTS platform_processed_updates;
DROP TABLE IF EXISTS platform_conversations;
DROP TABLE IF EXISTS platform_operations;
DROP TABLE IF EXISTS provisioning_jobs;
DROP TABLE IF EXISTS ai_usage_events;
DROP TABLE IF EXISTS ai_usage_monthly;
DROP TABLE IF EXISTS store_services;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS assistant_messages;
DROP TABLE IF EXISTS telegram_sessions;
DROP TABLE IF EXISTS user_access_tokens;
DROP TABLE IF EXISTS store_memberships;
DROP TABLE IF EXISTS platform_users;
DROP TABLE IF EXISTS store_domains;
DROP TABLE IF EXISTS stores;

-- Disparadores originales de 0006.
CREATE TRIGGER IF NOT EXISTS trg_orders_created_history
AFTER INSERT ON orders
BEGIN
  INSERT INTO order_events (order_id, event_type, to_value, performed_by)
  VALUES (NEW.id, 'created', 'pendiente', 'storefront');
  INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
  VALUES ('order_created', 'order', CAST(NEW.id AS TEXT),
    json_object('displayId', NEW.display_id, 'subtotal', NEW.subtotal, 'items', json_array_length(NEW.items_json)),
    'storefront', 'api');
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
    WHERE v.id IS NULL OR v.stock < requested.quantity
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

DELETE FROM d1_migrations WHERE name = '0007_multi_tenant_platform.sql';
