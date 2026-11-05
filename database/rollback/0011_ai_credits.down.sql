-- Reverts 0011_ai_credits.sql. Run the previous Worker version first.
-- WARNING: this deletes the credit history and pending recharge requests; export them before running.
DROP INDEX IF EXISTS idx_ai_credit_requests_store;
DROP INDEX IF EXISTS idx_ai_credit_requests_status;
DROP TABLE IF EXISTS ai_credit_requests;
DROP TABLE IF EXISTS ai_credit_costs;
DROP INDEX IF EXISTS idx_ai_credit_ledger_open;
DROP INDEX IF EXISTS ux_ai_credit_ledger_settlement;
DROP INDEX IF EXISTS ux_ai_credit_ledger_idempotency;
DROP INDEX IF EXISTS idx_ai_credit_ledger_store;
DROP TABLE IF EXISTS ai_credit_ledger;
