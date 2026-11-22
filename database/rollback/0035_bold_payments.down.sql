-- Rollback de 0035: quita el pago en línea con Bold. Borra las llaves guardadas y el historial de intentos.
DROP TABLE IF EXISTS payment_webhook_events;
DROP TABLE IF EXISTS payment_attempts;
DROP TABLE IF EXISTS store_payment_gateways;
ALTER TABLE orders DROP COLUMN payment_provider;
