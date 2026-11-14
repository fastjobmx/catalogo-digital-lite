-- 0028: fotos recibidas por el Asistente TiendIA que esperan la descripción del comerciante (capa multimedia).
-- Aditiva: una tabla nueva. Guarda solo el identificador del archivo en el canal (no la imagen) y a qué tienda y
-- usuario pertenece; la restricción única hace que un archivo o un webhook reenviado no se registre dos veces.
CREATE TABLE IF NOT EXISTS assistant_media_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    user_key TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    -- open = espera descripción · used = quedó en un borrador · discarded = descartada o vencida
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'used', 'discarded')),
    operation_id TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (store_id, user_key, file_id)
);
CREATE INDEX IF NOT EXISTS idx_assistant_media_items_open ON assistant_media_items(store_id, user_key, status, created_at);
