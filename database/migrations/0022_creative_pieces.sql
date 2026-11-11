-- Estudio Creativo IA · Fase 3 (fábrica de creativos y video comercial). Migración solo aditiva.
-- Reutiliza creative_jobs (0020), creative_assets (0021), products, campaigns (0010) y ai_credit_ledger.
-- Rollback: database/rollback/0022_creative_pieces.down.sql

-- Piezas comerciales: imagen, carrusel o video hechos con productos y fotos reales de la tienda.
-- No es una segunda biblioteca de productos: cada pieza apunta a productos existentes y guarda solo sus archivos finales.
CREATE TABLE IF NOT EXISTS creative_pieces (
    id TEXT PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('imagen', 'carrusel', 'video')),
    -- convencional: composición determinista en el navegador (sin IA). video_ia: video generativo.
    mode TEXT NOT NULL CHECK (mode IN ('convencional', 'video_ia')),
    template TEXT NOT NULL,
    format TEXT NOT NULL,
    -- JSON: [productId, ...] (productos de la tienda usados en la pieza).
    product_ids_json TEXT NOT NULL DEFAULT '[]',
    -- JSON: textos comerciales (titular, descripción, beneficios, CTA, hashtags, versiones por canal).
    copy_json TEXT NOT NULL DEFAULT '{}',
    -- JSON: configuración completa del render (calidad, duración, datos verificados usados, origen de las fotos).
    spec_json TEXT NOT NULL DEFAULT '{}',
    -- Huella de la configuración: la misma configuración no se genera dos veces si ya existe una pieza reutilizable.
    spec_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'aprobado', 'rechazado')),
    -- JSON: [{ key, contentType, bytes, width, height, durationMs }] en creative-private/stores/<id>/pieces/…
    files_json TEXT NOT NULL DEFAULT '[]',
    model TEXT DEFAULT NULL,
    credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
    cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
    job_id TEXT DEFAULT NULL,
    campaign_id INTEGER DEFAULT NULL REFERENCES campaigns(id) ON DELETE SET NULL,
    idempotency_key TEXT NOT NULL,
    created_by TEXT NOT NULL,
    reviewed_by TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (store_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_creative_pieces_store ON creative_pieces(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creative_pieces_hash ON creative_pieces(store_id, spec_hash);
CREATE INDEX IF NOT EXISTS idx_creative_pieces_campaign ON creative_pieces(store_id, campaign_id);
