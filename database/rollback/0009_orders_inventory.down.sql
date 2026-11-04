-- Reverts 0009_orders_inventory.sql. Run the previous Worker version first.
-- The delivery columns stay (SQLite cannot drop them safely in D1); they are ignored by older code.
DROP TRIGGER IF EXISTS trg_order_inventory_movement;
DROP TRIGGER IF EXISTS trg_variant_stock_movement;
DROP TRIGGER IF EXISTS trg_variant_stock_not_negative_insert;
DROP TRIGGER IF EXISTS trg_variant_stock_not_negative;
DROP INDEX IF EXISTS idx_inventory_movements_variant;
DROP INDEX IF EXISTS idx_inventory_movements_store;
DROP TABLE IF EXISTS inventory_movements;
DELETE FROM d1_migrations WHERE name = '0009_orders_inventory.sql';
