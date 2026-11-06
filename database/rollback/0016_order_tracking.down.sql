-- Reverts 0016_order_tracking.sql. Deploy the previous Worker version first.
-- Deletes the guide-photo records (export them and the R2 objects under order-docs/ first if needed).
DROP INDEX IF EXISTS idx_order_documents_order;
DROP TABLE IF EXISTS order_documents;
DROP INDEX IF EXISTS idx_orders_store_shipping;
ALTER TABLE orders DROP COLUMN delivery_reference;
ALTER TABLE orders DROP COLUMN delivery_notes;
ALTER TABLE orders DROP COLUMN delivery_receiver;
ALTER TABLE orders DROP COLUMN delivery_confirmation_method;
ALTER TABLE orders DROP COLUMN shipping_notes;
ALTER TABLE orders DROP COLUMN tracking_url;
ALTER TABLE orders DROP COLUMN shipping_status;
