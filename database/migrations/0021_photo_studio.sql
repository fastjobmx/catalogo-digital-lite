-- Estudio Creativo IA · Fase 2 (estudio fotográfico y biblioteca). Migración solo aditiva.
-- Reutiliza creative_jobs (0020), ai_credit_ledger, ai_usage_events, products, telegram_product_batch_items y trial_sessions.
-- Rollback: database/rollback/0021_photo_studio.down.sql

-- 1. Biblioteca de recursos: originales (siempre privados) y resultados (privados hasta que se aprueban).
CREATE TABLE IF NOT EXISTS creative_assets (
    id TEXT PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id INTEGER DEFAULT NULL REFERENCES products(id) ON DELETE SET NULL,
    role TEXT NOT NULL CHECK (role IN ('original', 'resultado')),
    -- original: 'activo'. resultado: 'pendiente' (por revisar) → 'aprobado' | 'descartado'.
    status TEXT NOT NULL CHECK (status IN ('activo', 'pendiente', 'aprobado', 'descartado')),
    -- Clave privada en R2 (creative-private/stores/<id>/…). NULL cuando un resultado descartado se borró.
    r2_key TEXT DEFAULT NULL,
    -- Copia pública (/api/assets/stores/<id>/products/estudio-<uuid>.<ext>) creada solo al aprobar.
    public_url TEXT DEFAULT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    width INTEGER DEFAULT NULL,
    height INTEGER DEFAULT NULL,
    sha256 TEXT NOT NULL,
    -- Procesamiento del resultado: nivel A (convencional), B (packshot), C (premium) y operación aplicada.
    level TEXT DEFAULT NULL CHECK (level IS NULL OR level IN ('A', 'B', 'C')),
    operation TEXT DEFAULT NULL,
    model TEXT DEFAULT NULL,
    credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
    -- Costo estimado del proveedor en micro-USD, calculado con los tokens reales de la llamada.
    cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
    source_asset_id TEXT DEFAULT NULL REFERENCES creative_assets(id) ON DELETE SET NULL,
    job_id TEXT DEFAULT NULL,
    -- De dónde vino: 'panel' (subida), 'producto' (foto del catálogo), 'telegram' (borrador), 'navegador' (edición convencional), 'ia'.
    origin TEXT NOT NULL,
    -- Referencia de origen, p. ej. 'telegram:<lote>:<item>'.
    origin_ref TEXT DEFAULT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_creative_assets_store ON creative_assets(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creative_assets_product ON creative_assets(store_id, product_id);
CREATE INDEX IF NOT EXISTS idx_creative_assets_source ON creative_assets(source_asset_id);
-- Un mismo archivo original no se guarda dos veces en la misma tienda.
CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_assets_original_hash ON creative_assets(store_id, sha256) WHERE role = 'original';

-- 2. Lotes: varios trabajos creados juntos comparten batch_id.
ALTER TABLE creative_jobs ADD COLUMN batch_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_creative_jobs_batch ON creative_jobs(store_id, batch_id);

-- 3. Prueba sin registro: mejoras de foto usadas por cada mini tienda (el tope lo fija la plataforma).
ALTER TABLE trial_sessions ADD COLUMN photo_enhance_count INTEGER NOT NULL DEFAULT 0;
