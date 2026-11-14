-- 0032: monedero de créditos artísticos (aditiva).
-- Agrega el origen de cada crédito (plan, cortesía, compra, ajuste), paquetes de recarga y una segunda versión de
-- costos en créditos para los planes nuevos. Los movimientos existentes quedan como cortesía, sin vencimiento,
-- y las tiendas actuales siguen con la versión 1 de costos (la de hoy).
-- Rollback: database/rollback/0032_credit_wallet.down.sql

ALTER TABLE ai_credit_ledger ADD COLUMN source TEXT NOT NULL DEFAULT 'cortesia' CHECK (source IN ('plan', 'cortesia', 'compra', 'ajuste'));
-- Vencimiento de los créditos asignados (recargas). Las reservas siguen usando expires_at para su caducidad.
ALTER TABLE ai_credit_ledger ADD COLUMN lot_expires_at TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_credit_lots ON ai_credit_ledger (store_id, kind, lot_expires_at);

CREATE TABLE IF NOT EXISTS ai_credit_packs (
    code TEXT PRIMARY KEY,
    credits INTEGER NOT NULL CHECK (credits > 0),
    price_cop INTEGER NOT NULL CHECK (price_cop > 0),
    valid_months INTEGER NOT NULL DEFAULT 12 CHECK (valid_months > 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO ai_credit_packs (code, credits, price_cop, valid_months, sort_order) VALUES
    ('creditos_100', 100, 12000, 12, 1),
    ('creditos_300', 300, 30000, 12, 2),
    ('creditos_700', 700, 63000, 12, 3);
ALTER TABLE ai_credit_requests ADD COLUMN pack_code TEXT DEFAULT NULL;

-- Costos en créditos por versión. Versión 1 = ai_credit_costs (tiendas actuales). Versión 2 = planes nuevos:
-- solo la generación artística usa créditos; leer fotos, PDF, guías y textos usa consultas del plan.
CREATE TABLE IF NOT EXISTS ai_credit_cost_versions (
    feature TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 2),
    credits INTEGER NOT NULL CHECK (credits >= 0),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    updated_by TEXT NOT NULL DEFAULT 'migracion-0032',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (feature, version)
);
INSERT OR IGNORE INTO ai_credit_cost_versions (feature, version, credits) VALUES
    ('estudio_imagen', 2, 10), ('foto_packshot', 2, 10), ('foto_premium', 2, 10), ('video_ia_segundo', 2, 10),
    ('foto_a_producto', 2, 0), ('importar_pdf_pagina', 2, 0), ('leer_guia_envio', 2, 0), ('creativo_texto', 2, 0);
-- NULL = según el plan (versión 2 para Emprendedor, Negocio y Mayorista; 1 para los demás).
ALTER TABLE stores ADD COLUMN credit_price_version INTEGER DEFAULT NULL;
