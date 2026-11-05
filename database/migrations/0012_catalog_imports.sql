-- Fase 3 (módulos IA): importación masiva de productos desde CSV, Excel o PDF.
-- Migración solo aditiva: dos tablas nuevas. El archivo se lee en el navegador; aquí solo
-- se guarda el registro de cada importación y el resultado de cada lote (idempotencia).
CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'xlsx', 'pdf')),
    file_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'completada', 'cancelada')),
    options_json TEXT NOT NULL DEFAULT '{}',
    created_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_store ON import_jobs(store_id, created_at);

-- Un lote se aplica una sola vez: un reintento devuelve el resultado guardado.
CREATE TABLE IF NOT EXISTS import_job_batches (
    job_id TEXT NOT NULL REFERENCES import_jobs(id),
    batch_index INTEGER NOT NULL CHECK (batch_index >= 0),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    result_json TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (job_id, batch_index)
);
CREATE INDEX IF NOT EXISTS idx_import_job_batches_store ON import_job_batches(store_id);
