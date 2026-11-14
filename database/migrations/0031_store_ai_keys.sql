-- 0031: API propia de Gemini por comercio (aditiva).
-- La clave se guarda CIFRADA (AES-256-GCM con datos asociados a la tienda) con una clave maestra que vive como
-- secreto del Worker (AI_KEYS_MASTER_KEY), nunca en la base. Nunca se devuelve al navegador: solo la pista.
-- Rollback: database/rollback/0031_store_ai_keys.down.sql

CREATE TABLE IF NOT EXISTS store_ai_keys (
    store_id INTEGER PRIMARY KEY REFERENCES stores(id),
    provider TEXT NOT NULL DEFAULT 'gemini' CHECK (provider IN ('gemini')),
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    key_version INTEGER NOT NULL,
    hint TEXT NOT NULL,
    use_assistant INTEGER NOT NULL DEFAULT 1 CHECK (use_assistant IN (0, 1)),
    use_studio INTEGER NOT NULL DEFAULT 0 CHECK (use_studio IN (0, 1)),
    status TEXT NOT NULL CHECK (status IN ('activa', 'invalida', 'sin_cuota', 'sin_permiso')),
    models_ok TEXT NOT NULL DEFAULT '[]',
    fallback_to_platform INTEGER NOT NULL DEFAULT 0 CHECK (fallback_to_platform IN (0, 1)),
    validated_at TEXT,
    last_error_code TEXT,
    last_used_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historial de la API propia: conectar, validar, reemplazar, cambiar usos, desconectar y errores. Sin secretos.
CREATE TABLE IF NOT EXISTS store_ai_key_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    error_code TEXT,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_store_ai_key_events ON store_ai_key_events (store_id, id);
