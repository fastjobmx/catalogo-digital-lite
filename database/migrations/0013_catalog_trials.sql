-- Fase 7 (módulos IA): prueba de catálogo sin registro. Migración solo aditiva.
-- Una prueba es temporal (48 horas), no crea usuarios ni tiendas y se borra sola junto con sus fotos.
CREATE TABLE IF NOT EXISTS trial_sessions (
    id TEXT PRIMARY KEY,
    edit_token_hash TEXT NOT NULL,
    business_name TEXT NOT NULL,
    template TEXT NOT NULL,
    content_json TEXT NOT NULL DEFAULT '{"products":[]}',
    photo_count INTEGER NOT NULL DEFAULT 0 CHECK (photo_count >= 0),
    ip_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trial_sessions_expires ON trial_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_trial_sessions_ip ON trial_sessions(ip_hash, created_at);

-- Límite de uso por IP (guardada solo como hash) y por ventana de una hora.
CREATE TABLE IF NOT EXISTS trial_rate_limits (
    rate_key TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (rate_key, window_start)
);
