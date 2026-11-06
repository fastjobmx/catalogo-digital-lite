-- Seguimiento de pedidos: estado logístico independiente, datos de despacho y de entrega, y
-- documentos privados (fotografías de guías). Migración solo aditiva: no cambia los estados
-- existentes ('enviado' pasa a mostrarse como "Entregado a transportadora") ni el historial.

-- Estado logístico, separado del estado comercial. NULL = se deriva del estado del pedido.
-- por_cotizar | por_despachar | preparando_envio | en_transportadora | en_transito
-- | entregado_cliente | incidencia | no_aplica
ALTER TABLE orders ADD COLUMN shipping_status TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN tracking_url TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN shipping_notes TEXT DEFAULT NULL;
-- Confirmación de entrega (shipped_at y delivered_at ya existen desde 0009).
ALTER TABLE orders ADD COLUMN delivery_confirmation_method TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN delivery_receiver TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN delivery_notes TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN delivery_reference TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_store_shipping ON orders(store_id, status, shipping_status);

-- Documentos privados de un pedido (guías de envío). El archivo vive en R2 bajo order-docs/,
-- prefijo que la ruta pública de imágenes no sirve; solo se descarga con sesión autorizada.
CREATE TABLE IF NOT EXISTS order_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'guia_envio' CHECK (kind IN ('guia_envio')),
    r2_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    telegram_file_id TEXT DEFAULT NULL,
    source TEXT NOT NULL CHECK (source IN ('telegram', 'panel')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (order_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_order_documents_order ON order_documents(store_id, order_id, id DESC);
