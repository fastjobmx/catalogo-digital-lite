-- Correo: estado de entrega informado por el proveedor (webhooks), reintentos, lista de supresión
-- y categorías de notificación desactivables. Migración solo aditiva: no cambia datos existentes.

-- Estado de entrega confirmado por el proveedor ('entregado', 'rebotado', 'queja', 'retrasado'). NULL = sin confirmación.
-- "enviado" sigue significando solo que el proveedor aceptó el mensaje.
ALTER TABLE email_messages ADD COLUMN delivery_status TEXT DEFAULT NULL;
ALTER TABLE email_messages ADD COLUMN delivery_updated_at TEXT DEFAULT NULL;
-- Intentos de entrega al proveedor dentro del mismo envío (reintentos de errores transitorios).
ALTER TABLE email_messages ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_email_messages_provider_id ON email_messages(provider_message_id);

-- Eventos recibidos del proveedor. Solo el tipo y su identificador (para no procesarlos dos veces); nunca el contenido.
CREATE TABLE IF NOT EXISTS email_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_event_id TEXT NOT NULL UNIQUE,
    provider_message_id TEXT DEFAULT NULL,
    message_id INTEGER DEFAULT NULL REFERENCES email_messages(id),
    event_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_events_created ON email_events(created_at);

-- Direcciones a las que no se vuelve a enviar: rebote permanente, queja de spam o bloqueo manual.
CREATE TABLE IF NOT EXISTS email_suppressions (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    reason TEXT NOT NULL CHECK (reason IN ('rebote', 'queja', 'manual')),
    source TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Categorías de notificación no esenciales que la plataforma puede pausar. Las de seguridad no figuran aquí:
-- verificación, recuperación, invitación y aviso de cambio de contraseña siempre se envían.
CREATE TABLE IF NOT EXISTS email_category_settings (
    category TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
