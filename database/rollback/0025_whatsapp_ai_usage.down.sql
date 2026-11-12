-- Reversión de 0025: retira el registro separado de IA de WhatsApp.
-- Ejecutar solo con el canal desactivado y con el código anterior a 0025 desplegado.
DROP TABLE IF EXISTS whatsapp_ai_ledger;
ALTER TABLE ai_usage_events DROP COLUMN channel;
DELETE FROM d1_migrations WHERE name = '0025_whatsapp_ai_usage.sql';
