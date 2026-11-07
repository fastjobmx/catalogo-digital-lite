-- Durable, tenant-scoped photo imports from the shared Telegram assistant.
-- Each Telegram photo message creates one row/product; albums are metadata only.
CREATE TABLE IF NOT EXISTS telegram_product_batches (
    id TEXT PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    chat_id TEXT NOT NULL,
    telegram_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'receiving'
        CHECK (status IN ('receiving', 'analyzing', 'needs_review', 'ready_to_publish', 'publishing', 'partially_published', 'published', 'failed', 'cancelled')),
    max_items INTEGER NOT NULL CHECK (max_items > 0),
    max_bytes INTEGER NOT NULL CHECK (max_bytes > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    UNIQUE(id, store_id)
);
CREATE INDEX IF NOT EXISTS idx_telegram_product_batches_store ON telegram_product_batches(store_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_product_batches_open_chat
    ON telegram_product_batches(chat_id)
    WHERE status IN ('receiving', 'analyzing', 'needs_review', 'ready_to_publish', 'publishing', 'partially_published');

CREATE TABLE IF NOT EXISTS telegram_product_batch_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    telegram_message_id INTEGER NOT NULL,
    update_id INTEGER NOT NULL UNIQUE,
    media_group_id TEXT,
    telegram_file_id TEXT NOT NULL,
    telegram_file_unique_id TEXT,
    position INTEGER NOT NULL,
    temp_key TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    extension TEXT NOT NULL CHECK (extension IN ('jpg', 'png', 'webp')),
    byte_length INTEGER NOT NULL CHECK (byte_length > 0),
    name TEXT,
    description TEXT,
    price INTEGER CHECK (price IS NULL OR price >= 0),
    category_id INTEGER,
    category_name TEXT,
    size TEXT,
    color TEXT,
    stock INTEGER CHECK (stock IS NULL OR stock >= 0),
    sku TEXT,
    status TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (status IN ('needs_review', 'ready_to_publish', 'ignored', 'analyzing', 'publishing', 'published', 'failed')),
    validation_errors TEXT NOT NULL DEFAULT '[]',
    warnings TEXT NOT NULL DEFAULT '[]',
    product_id INTEGER REFERENCES products(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(batch_id, telegram_message_id),
    FOREIGN KEY (batch_id, store_id) REFERENCES telegram_product_batches(id, store_id)
);
CREATE INDEX IF NOT EXISTS idx_telegram_product_batch_items_order ON telegram_product_batch_items(batch_id, position, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_product_batch_items_file
    ON telegram_product_batch_items(batch_id, telegram_file_unique_id)
    WHERE telegram_file_unique_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_product_batch_items_store ON telegram_product_batch_items(store_id, product_id);
