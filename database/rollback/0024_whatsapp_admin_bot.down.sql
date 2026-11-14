-- Reversión de 0024: solo elimina las tablas del asistente por WhatsApp.
-- Ejecutar únicamente con el canal desactivado (WHATSAPP_ADMIN_BOT_ENABLED distinto de "true").
DROP TABLE IF EXISTS whatsapp_messages;
DROP TABLE IF EXISTS whatsapp_throttles;
DROP TABLE IF EXISTS whatsapp_link_tokens;
DROP TABLE IF EXISTS whatsapp_identities;
