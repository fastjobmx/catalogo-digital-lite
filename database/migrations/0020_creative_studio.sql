-- Estudio Creativo IA · Fase 1. Migración solo aditiva: crea dos tablas nuevas y no toca datos existentes.
-- Reutiliza: stores (tenant), store_config (logo y color de Apariencia), ai_credit_ledger (créditos),
-- ai_usage_events / ai_usage_monthly (consumo de IA), audit_log (auditoría) y campaigns (mensajes de marketing).
-- Rollback: database/rollback/0020_creative_studio.down.sql

-- 1. Brand Kit por comercio. Una fila por tienda; todos los campos son opcionales y solo los llena el comercio
--    (nunca se rellenan con datos inventados). revision permite detectar ediciones simultáneas.
CREATE TABLE IF NOT EXISTS brand_kits (
    store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    brand_name TEXT DEFAULT NULL,
    slogan TEXT DEFAULT NULL,
    tone TEXT DEFAULT NULL,
    target_audience TEXT DEFAULT NULL,
    -- URL de un recurso de la propia tienda (/api/assets/stores/<id>/...) o https externo.
    logo_url TEXT DEFAULT NULL,
    -- JSON: ["#RRGGBB", ...] (máx. 6)
    colors_json TEXT NOT NULL DEFAULT '[]',
    -- JSON: claves de la lista de tipografías permitidas por la plataforma (máx. 3)
    fonts_json TEXT NOT NULL DEFAULT '[]',
    -- JSON: claves de estilos visuales de la lista cerrada (máx. 5)
    visual_styles_json TEXT NOT NULL DEFAULT '[]',
    -- JSON: claves de plantillas favoritas (máx. 12). Las plantillas creativas llegarán en una fase posterior.
    favorite_templates_json TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Trabajos creativos (fotos, video, creativos, oportunidades, campañas, analítica). Todos pertenecen a una tienda.
--    La misma clave de idempotencia nunca crea dos trabajos en la misma tienda. Los créditos se reservan en
--    ai_credit_ledger (no se duplican aquí): credit_reservation_id apunta a la reserva.
CREATE TABLE IF NOT EXISTS creative_jobs (
    id TEXT PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('foto', 'video', 'creativo', 'oportunidades', 'campana', 'analitica')),
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'en_proceso', 'completado', 'fallido', 'cancelado')),
    idempotency_key TEXT NOT NULL,
    input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT DEFAULT NULL,
    error_code TEXT DEFAULT NULL,
    provider TEXT DEFAULT NULL,
    model TEXT DEFAULT NULL,
    credit_reservation_id INTEGER DEFAULT NULL REFERENCES ai_credit_ledger(id),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    requested_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT DEFAULT NULL,
    finished_at TEXT DEFAULT NULL,
    -- Retención: después de esta fecha el trabajo terminado se borra (el resultado definitivo vive en la biblioteca).
    expires_at TEXT NOT NULL DEFAULT (datetime('now', '+90 days')),
    UNIQUE (store_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_creative_jobs_store ON creative_jobs(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creative_jobs_status ON creative_jobs(status, created_at);
