-- Asistente administrativo por WhatsApp (canal adicional; Telegram y el panel no cambian).
-- Solo agrega tablas nuevas. No modifica ni lee tablas existentes al aplicarse.

-- Un WhatsApp vinculado a un usuario de la plataforma. La identidad principal es el identificador
-- de usuario que entrega Meta (BSUID); el teléfono es opcional porque Meta puede omitirlo.
CREATE TABLE IF NOT EXISTS whatsapp_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES platform_users(id),
    business_user_id TEXT DEFAULT NULL,
    phone TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    linked_store_id INTEGER REFERENCES stores(id),
    last_inbound_at INTEGER DEFAULT NULL,
    menu_json TEXT DEFAULT NULL,
    linked_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT DEFAULT NULL,
    revoked_by TEXT DEFAULT NULL,
    CHECK (business_user_id IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_identities_bsuid ON whatsapp_identities(business_user_id) WHERE status = 'active' AND business_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_identities_phone ON whatsapp_identities(phone) WHERE status = 'active' AND phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_identities_user ON whatsapp_identities(user_id) WHERE status = 'active';

-- Códigos de vinculación de un solo uso. Solo se guarda el hash SHA-256.
CREATE TABLE IF NOT EXISTS whatsapp_link_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES platform_users(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    expires_at INTEGER NOT NULL,
    used_at INTEGER DEFAULT NULL,
    used_by_identity INTEGER DEFAULT NULL,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_link_tokens_user ON whatsapp_link_tokens(user_id, used_at);

-- Ventanas de control por remitente: intentos fallidos de vinculación, ráfagas y avisos a desconocidos.
CREATE TABLE IF NOT EXISTS whatsapp_throttles (
    sender_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('link_failures', 'messages', 'unlinked_notice')),
    window_started_at INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sender_key, kind)
);

-- Un renglón por mensaje de WhatsApp (entrante o saliente): idempotencia, trazabilidad y costos.
-- El contenido del mensaje entrante solo vive en payload_json mientras se procesa; después se borra.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_message_id TEXT NOT NULL UNIQUE,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    sender_key TEXT NOT NULL,
    identity_id INTEGER DEFAULT NULL,
    store_id INTEGER DEFAULT NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed', 'sent', 'delivered', 'read', 'error')),
    attempts INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT DEFAULT NULL,
    reply_to INTEGER DEFAULT NULL,
    billable INTEGER DEFAULT NULL,
    pricing_category TEXT DEFAULT NULL,
    pricing_type TEXT DEFAULT NULL,
    estimated_cost_micros INTEGER DEFAULT NULL,
    error_code TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_pending ON whatsapp_messages(direction, status, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_store ON whatsapp_messages(store_id, created_at);
