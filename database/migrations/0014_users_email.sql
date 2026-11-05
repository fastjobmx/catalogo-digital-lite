-- Usuarios y accesos, recuperación por correo y plantillas de correo. Migración solo aditiva.

-- Correo verificado (la persona abrió un enlace enviado a esa dirección) y cierre de sesiones:
-- las sesiones emitidas antes de credentials_changed_at (segundos Unix) dejan de valer.
ALTER TABLE platform_users ADD COLUMN email_verified_at TEXT DEFAULT NULL;
ALTER TABLE platform_users ADD COLUMN credentials_changed_at INTEGER DEFAULT NULL;

-- Canal por el que se entregó un enlace de activación o restablecimiento ('email', 'telegram' o 'manual').
-- Abrir un enlace que llegó por correo prueba que la persona controla esa dirección.
ALTER TABLE user_access_tokens ADD COLUMN delivered_via TEXT DEFAULT NULL;

-- Enlaces de verificación de correo (solo se guarda su hash). No dan acceso al panel.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES platform_users(id),
    email TEXT NOT NULL COLLATE NOCASE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER DEFAULT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id);

-- Plantillas de correo. Las de sistema (system_key) no se pueden borrar ni desactivar.
CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    system_key TEXT UNIQUE DEFAULT NULL,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    text TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historial de envíos. Nunca guarda el cuerpo, enlaces ni tokens.
CREATE TABLE IF NOT EXISTS email_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER DEFAULT NULL REFERENCES email_templates(id),
    template_key TEXT DEFAULT NULL,
    purpose TEXT NOT NULL,
    store_id INTEGER DEFAULT NULL,
    user_id INTEGER DEFAULT NULL,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('enviando', 'enviado', 'fallido', 'no_configurado')),
    provider TEXT NOT NULL DEFAULT 'none',
    provider_message_id TEXT DEFAULT NULL,
    error_code TEXT DEFAULT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    requested_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_messages_created ON email_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_email_messages_user ON email_messages(user_id, purpose, created_at);
CREATE INDEX IF NOT EXISTS idx_email_messages_store ON email_messages(store_id, created_at);
