-- 0026: WAHA como proveedor alternativo de WhatsApp y lotes de fotos agrupados por IA.
-- Aditiva: tablas nuevas y una columna nueva con valor 'meta' para todas las filas existentes.
-- No toca productos, inventario, pedidos, comerciantes, imágenes, Telegram ni la auditoría.

-- Proveedor de cada mensaje (meta = Cloud API oficial, waha = WhatsApp HTTP API).
ALTER TABLE whatsapp_messages ADD COLUMN provider TEXT NOT NULL DEFAULT 'meta';
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_provider ON whatsapp_messages(provider, created_at);

-- Conexiones de WhatsApp de la plataforma (una por proveedor y sesión). El número del bot es un
-- dato de la conexión, nunca la identidad de un comercio: cambiar de número no borra nada.
CREATE TABLE IF NOT EXISTS whatsapp_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL CHECK (provider IN ('meta', 'waha')),
    session_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    phone_ending TEXT DEFAULT NULL,
    last_status_at INTEGER DEFAULT NULL,
    last_message_at INTEGER DEFAULT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (provider, session_name)
);

-- Lote de fotos que un comerciante reenvía al asistente. Se agrupa por productos con IA y se
-- revisa producto por producto; solo se publica lo que el comerciante confirma.
CREATE TABLE IF NOT EXISTS whatsapp_photo_batches (
    id TEXT PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    identity_id INTEGER NOT NULL REFERENCES whatsapp_identities(id),
    chat_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'collecting'
        CHECK (status IN ('collecting', 'grouping', 'grouped', 'reviewing', 'completed', 'cancelled', 'failed')),
    photo_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    analyzed_count INTEGER NOT NULL DEFAULT 0,
    groups_json TEXT DEFAULT NULL,
    current_group INTEGER DEFAULT NULL,
    published_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    receiving_notice_sent INTEGER NOT NULL DEFAULT 0,
    lock_until INTEGER DEFAULT NULL,
    error_code TEXT DEFAULT NULL,
    last_photo_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at INTEGER DEFAULT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_photo_batches_open
    ON whatsapp_photo_batches(chat_id) WHERE status IN ('collecting', 'grouping', 'grouped', 'reviewing');
CREATE INDEX IF NOT EXISTS idx_whatsapp_photo_batches_store ON whatsapp_photo_batches(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_photo_batches_status ON whatsapp_photo_batches(status, last_photo_at);

-- Cada foto del lote. La imagen vive en R2 bajo whatsapp-batches/<lote>/ hasta que el lote termina.
CREATE TABLE IF NOT EXISTS whatsapp_photo_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL REFERENCES whatsapp_photo_batches(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    message_id TEXT NOT NULL UNIQUE,
    album_id TEXT DEFAULT NULL,
    content_hash TEXT NOT NULL,
    temp_key TEXT DEFAULT NULL,
    content_type TEXT DEFAULT NULL,
    extension TEXT DEFAULT NULL,
    byte_length INTEGER DEFAULT NULL,
    width INTEGER DEFAULT NULL,
    height INTEGER DEFAULT NULL,
    caption TEXT DEFAULT NULL,
    forwarded INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL,
    group_index INTEGER DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'duplicate', 'rejected', 'not_product', 'used')),
    error_code TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_photo_items_batch ON whatsapp_photo_items(batch_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_photo_items_hash ON whatsapp_photo_items(batch_id, content_hash) WHERE status <> 'duplicate';
