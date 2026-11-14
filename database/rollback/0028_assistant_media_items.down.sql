-- Reversión de 0028: retira las fotos en espera de la capa multimedia (apagar antes ASSISTANT_MEDIA_STORE_IDS).
DROP TABLE IF EXISTS assistant_media_items;
DELETE FROM d1_migrations WHERE name = '0028_assistant_media_items.sql';
