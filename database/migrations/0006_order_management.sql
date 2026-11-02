-- Additive order management fields. Existing orders and items_json are preserved.
ALTER TABLE orders ADD COLUMN customer_city TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE orders ADD COLUMN shipping_cost INTEGER DEFAULT NULL;
ALTER TABLE orders ADD COLUMN internal_notes TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN idempotency_key TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN request_fingerprint TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN inventory_reserved_at TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN inventory_managed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN image_url TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  from_value TEXT DEFAULT NULL,
  to_value TEXT DEFAULT NULL,
  note TEXT DEFAULT NULL,
  performed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_inventory_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('reserve', 'release')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(order_id, variant_id, operation),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_created
  ON order_events(order_id, created_at DESC, id DESC);

INSERT INTO order_events (order_id, event_type, to_value, performed_by)
SELECT o.id, 'legacy_import', o.status, 'migration'
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.event_type = 'legacy_import'
);

-- Keep initial history/audit atomic with the order insert without recording buyer PII.
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

-- Inventory is reserved exactly once when an admin confirms an order. If any
-- line is unavailable, the status update aborts atomically. Pre-shipment
-- cancellations restore only the reservation recorded for that order.
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
