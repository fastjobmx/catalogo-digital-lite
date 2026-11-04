-- Fase 2: entregas de pedidos y libro de movimientos de inventario.
-- Solo agrega columnas, tablas, índices y disparadores; no modifica datos existentes.

ALTER TABLE orders ADD COLUMN carrier TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN tracking_number TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN shipped_at TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN delivered_at TEXT DEFAULT NULL;

-- Every stock change leaves a row: who, why and how much (signed delta).
CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    variant_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('entrada', 'salida', 'ajuste', 'pedido', 'devolucion_pedido')),
    quantity INTEGER NOT NULL,
    stock_before INTEGER NOT NULL,
    stock_after INTEGER NOT NULL,
    reason TEXT DEFAULT NULL,
    reference TEXT DEFAULT NULL,
    performed_by TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_store ON inventory_movements(store_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant ON inventory_movements(variant_id, id DESC);

-- Inventory can never become negative, whatever path changes it.
CREATE TRIGGER IF NOT EXISTS trg_variant_stock_not_negative
BEFORE UPDATE OF stock ON product_variants
WHEN NEW.stock < 0
BEGIN
  SELECT RAISE(ABORT, 'negative stock');
END;

CREATE TRIGGER IF NOT EXISTS trg_variant_stock_not_negative_insert
BEFORE INSERT ON product_variants
WHEN NEW.stock < 0
BEGIN
  SELECT RAISE(ABORT, 'negative stock');
END;

CREATE TRIGGER IF NOT EXISTS trg_variant_stock_movement
AFTER UPDATE OF stock ON product_variants
WHEN NEW.stock <> OLD.stock
BEGIN
  INSERT INTO inventory_movements (store_id, product_id, variant_id, sku, kind, quantity, stock_before, stock_after)
  SELECT p.store_id, NEW.product_id, NEW.id, NEW.sku,
         CASE WHEN NEW.stock > OLD.stock THEN 'entrada' ELSE 'salida' END,
         NEW.stock - OLD.stock, OLD.stock, NEW.stock
  FROM products p WHERE p.id = NEW.product_id;
END;

-- Order reservations and releases label the movement the stock trigger just wrote.
CREATE TRIGGER IF NOT EXISTS trg_order_inventory_movement
AFTER INSERT ON order_inventory_operations
BEGIN
  UPDATE inventory_movements
  SET kind = CASE WHEN NEW.operation = 'reserve' THEN 'pedido' ELSE 'devolucion_pedido' END,
      reason = CASE WHEN NEW.operation = 'reserve' THEN 'Pedido confirmado' ELSE 'Pedido cancelado' END,
      reference = 'order:' || NEW.order_id,
      performed_by = COALESCE(performed_by, 'pedido')
  WHERE id = (SELECT MAX(id) FROM inventory_movements WHERE variant_id = NEW.variant_id AND reference IS NULL);
END;
