-- Fase 2 (módulos IA): créditos de IA por tienda. Migración solo aditiva:
-- crea tres tablas nuevas y no modifica ni borra datos existentes.
--
-- ai_credit_ledger   libro de movimientos (solo inserción). Saldo = SUM(amount).
--   recarga    +n  aprobada por el superadministrador
--   ajuste     ±n  corrección del superadministrador, con motivo
--   reserva    -n  bloqueo previo a una acción de IA (vence en 15 minutos)
--   consumo     0  cierra una reserva: la acción terminó bien y el bloqueo queda como gasto
--   liberacion +n  cierra una reserva: la acción falló o venció, se devuelven los créditos
-- Cada reserva tiene como máximo un cierre (índice único sobre reservation_id).
CREATE TABLE IF NOT EXISTS ai_credit_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    kind TEXT NOT NULL CHECK (kind IN ('recarga', 'ajuste', 'reserva', 'consumo', 'liberacion')),
    amount INTEGER NOT NULL,
    feature TEXT DEFAULT NULL,
    reservation_id INTEGER DEFAULT NULL REFERENCES ai_credit_ledger(id),
    idempotency_key TEXT DEFAULT NULL,
    actor TEXT NOT NULL,
    reason TEXT DEFAULT NULL,
    expires_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
        (kind = 'recarga' AND amount > 0) OR
        (kind = 'ajuste' AND amount <> 0) OR
        (kind = 'reserva' AND amount < 0) OR
        (kind = 'consumo' AND amount = 0) OR
        (kind = 'liberacion' AND amount > 0)
    ),
    CHECK ((kind IN ('consumo', 'liberacion')) = (reservation_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_store ON ai_credit_ledger(store_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_credit_ledger_idempotency ON ai_credit_ledger(store_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_credit_ledger_settlement ON ai_credit_ledger(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_open ON ai_credit_ledger(kind, expires_at) WHERE kind = 'reserva';

-- Costo en créditos de cada acción de IA. Se crea vacía a propósito: el valor comercial
-- lo define el superadministrador. Una acción sin fila usa solo el presupuesto mensual actual.
CREATE TABLE IF NOT EXISTS ai_credit_costs (
    feature TEXT PRIMARY KEY,
    credits INTEGER NOT NULL CHECK (credits >= 0),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Solicitudes de recarga hechas por el comercio. No hay cobro en línea: el superadministrador
-- aprueba después de recibir el pago por fuera, y la aprobación crea la recarga en el libro.
CREATE TABLE IF NOT EXISTS ai_credit_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    credits INTEGER NOT NULL CHECK (credits > 0),
    note TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'aprobada', 'rechazada')),
    requested_by TEXT NOT NULL,
    resolved_by TEXT DEFAULT NULL,
    resolution_note TEXT DEFAULT NULL,
    approved_credits INTEGER DEFAULT NULL CHECK (approved_credits IS NULL OR approved_credits > 0),
    ledger_id INTEGER DEFAULT NULL REFERENCES ai_credit_ledger(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_credit_requests_status ON ai_credit_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_credit_requests_store ON ai_credit_requests(store_id, id);
