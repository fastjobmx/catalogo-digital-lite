-- Reversión de 0019_email_delivery.sql. Borra eventos de entrega, supresiones y ajustes de categorías.
-- Las columnas agregadas a email_messages se pueden quitar con ALTER TABLE ... DROP COLUMN (SQLite >= 3.35, D1 lo admite).
DROP TABLE IF EXISTS email_category_settings;
DROP TABLE IF EXISTS email_suppressions;
DROP TABLE IF EXISTS email_events;
DROP INDEX IF EXISTS idx_email_messages_provider_id;
ALTER TABLE email_messages DROP COLUMN attempts;
ALTER TABLE email_messages DROP COLUMN delivery_updated_at;
ALTER TABLE email_messages DROP COLUMN delivery_status;
