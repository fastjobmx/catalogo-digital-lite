-- Rollback de 0031_store_ai_keys.sql. Borra las claves cifradas de los comercios y su historial.
DROP INDEX IF EXISTS idx_store_ai_key_events;
DROP TABLE IF EXISTS store_ai_key_events;
DROP TABLE IF EXISTS store_ai_keys;
