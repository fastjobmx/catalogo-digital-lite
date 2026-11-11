-- Rollback de 0023_ai_message_quota.sql. Borra el libro de mensajes y los avisos (exportar antes si se
-- quiere conservar el historial), quita los tres planes nuevos SOLO si ninguna tienda los usa y elimina
-- las columnas agregadas. No toca los planes ni las tiendas existentes.
DROP INDEX IF EXISTS idx_ai_message_ledger_recent;
DROP INDEX IF EXISTS idx_ai_message_ledger_cycle;
DROP TABLE IF EXISTS ai_message_alerts;
DROP TABLE IF EXISTS ai_message_ledger;
DELETE FROM plans WHERE code IN ('emprendedor', 'negocio', 'mayorista')
    AND NOT EXISTS (SELECT 1 FROM stores WHERE stores.plan_code = plans.code);
ALTER TABLE stores DROP COLUMN ai_monthly_messages_override;
ALTER TABLE stores DROP COLUMN ai_cycle_anchor_day;
ALTER TABLE plans DROP COLUMN ai_usage_policy;
ALTER TABLE plans DROP COLUMN ai_monthly_messages;
ALTER TABLE plans DROP COLUMN annual_price;
