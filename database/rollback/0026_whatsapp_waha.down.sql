-- Reversión de 0026: retira WAHA y los lotes de fotos de WhatsApp.
-- Ejecutar solo con WAHA_ENABLED distinto de 'true' y con el código anterior a 0026 desplegado.
-- Los productos ya publicados desde un lote NO se borran (viven en products / R2 como cualquier otro).
-- Antes: borrar en R2 el prefijo whatsapp-batches/ (fotos temporales de lotes sin terminar).
DROP TABLE IF EXISTS whatsapp_photo_items;
DROP TABLE IF EXISTS whatsapp_photo_batches;
DROP TABLE IF EXISTS whatsapp_channels;
DROP INDEX IF EXISTS idx_whatsapp_messages_provider;
ALTER TABLE whatsapp_messages DROP COLUMN provider;
DELETE FROM d1_migrations WHERE name = '0026_whatsapp_waha.sql';
