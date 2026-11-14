-- Rollback de 0032_credit_wallet.sql. Los movimientos de créditos se conservan (solo se quitan columnas nuevas).
ALTER TABLE stores DROP COLUMN credit_price_version;
DROP TABLE IF EXISTS ai_credit_cost_versions;
ALTER TABLE ai_credit_requests DROP COLUMN pack_code;
DROP TABLE IF EXISTS ai_credit_packs;
DROP INDEX IF EXISTS idx_ai_credit_lots;
ALTER TABLE ai_credit_ledger DROP COLUMN lot_expires_at;
ALTER TABLE ai_credit_ledger DROP COLUMN source;
