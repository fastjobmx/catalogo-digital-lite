-- 0029: control centralizado del gasto en IA (aditiva).
-- Solo crea tablas nuevas. No modifica planes, tiendas, créditos ni datos existentes.
-- Con AI_SPEND_GUARD_MODE = 'off' nada de esto se usa; en 'shadow' registra y alerta sin bloquear;
-- en 'enforce' bloquea nuevas llamadas pagadas cuando se alcanza un límite.
-- Número 0029 para no chocar con 0024-0028 de las ramas de WhatsApp y del asistente.
-- Rollback: database/rollback/0029_ai_spend_guard.down.sql

-- Una fila por llamada pagada a Gemini (o intento bloqueado). La reserva se crea ANTES de llamar con el costo
-- máximo posible y se concilia DESPUÉS con el costo real según la tabla oficial de precios. El insert de la
-- reserva comprueba todos los límites en la misma sentencia, así dos solicitudes simultáneas no pueden pasarse.
-- (op_key, attempt) impide duplicar el mismo intento de una operación (webhooks repetidos, trabajos en cola).
-- No guarda contenido de mensajes, fotos ni audios.
CREATE TABLE IF NOT EXISTS ai_spend_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    op_key TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    environment TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('store', 'platform', 'trial', 'test')),
    store_id INTEGER,
    plan_code TEXT,
    feature TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'video')),
    day_key TEXT NOT NULL,
    month_key TEXT NOT NULL,
    reserved_micros INTEGER NOT NULL CHECK (reserved_micros >= 0),
    actual_micros INTEGER,
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'settled', 'released', 'expired')),
    -- ok | http_error | network_error | truncated | expired
    outcome TEXT,
    mode TEXT NOT NULL CHECK (mode IN ('shadow', 'enforce')),
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    thoughts_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    image_tokens INTEGER NOT NULL DEFAULT 0,
    pricing_version TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    settled_at TEXT,
    UNIQUE (op_key, attempt)
);
CREATE INDEX IF NOT EXISTS idx_ai_spend_month ON ai_spend_reservations (environment, month_key, status);
CREATE INDEX IF NOT EXISTS idx_ai_spend_day ON ai_spend_reservations (environment, day_key);
CREATE INDEX IF NOT EXISTS idx_ai_spend_store ON ai_spend_reservations (store_id, month_key);
CREATE INDEX IF NOT EXISTS idx_ai_spend_open ON ai_spend_reservations (status, created_at);

-- Límites editables sin publicar código (auditados en audit_log). Lo que no está aquí sale de los valores
-- por defecto del código (spendGuard.ts). scope: 'global' (ref '*'), 'plan' (ref = código del plan),
-- 'store' (ref = id de la tienda), 'trial' (ref '*'). metric: 'micros' (USD micros) o 'images' (cantidad).
CREATE TABLE IF NOT EXISTS ai_spend_limits (
    scope TEXT NOT NULL CHECK (scope IN ('global', 'plan', 'store', 'trial')),
    scope_ref TEXT NOT NULL,
    period TEXT NOT NULL CHECK (period IN ('day', 'month')),
    metric TEXT NOT NULL CHECK (metric IN ('micros', 'images')),
    limit_value INTEGER NOT NULL CHECK (limit_value >= 0),
    updated_by TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (scope, scope_ref, period, metric)
);

-- Alertas al 50, 80 y 100 %: una sola vez por alcance, periodo y umbral.
CREATE TABLE IF NOT EXISTS ai_spend_alerts (
    scope_key TEXT NOT NULL,
    period_key TEXT NOT NULL,
    threshold INTEGER NOT NULL CHECK (threshold IN (50, 80, 100)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (scope_key, period_key, threshold)
);
