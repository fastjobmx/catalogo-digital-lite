-- Reverts 0010_team_marketing_billing.sql. Run the previous Worker version first.
-- Members with the new roles (seller, inventory) are revoked as operators would be
-- unsafe; review them before running this script. Order columns stay (ignored by older code).
DROP INDEX IF EXISTS idx_store_invoices_status;
DROP INDEX IF EXISTS idx_store_invoices_service_period;
DROP TABLE IF EXISTS store_invoices;
DROP INDEX IF EXISTS idx_campaigns_store;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS customer_contacts;
DROP TABLE IF EXISTS coupons;

CREATE TABLE store_memberships_v9 (
    store_id INTEGER NOT NULL REFERENCES stores(id),
    user_id INTEGER NOT NULL REFERENCES platform_users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, user_id)
);
INSERT INTO store_memberships_v9 (store_id, user_id, role, status, created_by, created_at, updated_at)
    SELECT store_id, user_id,
           CASE WHEN role IN ('seller', 'inventory') THEN 'operator' ELSE role END,
           CASE WHEN role IN ('seller', 'inventory') THEN 'revoked' ELSE status END,
           created_by, created_at, updated_at FROM store_memberships;
DROP TABLE store_memberships;
ALTER TABLE store_memberships_v9 RENAME TO store_memberships;
CREATE INDEX IF NOT EXISTS idx_memberships_user ON store_memberships(user_id, status);
DELETE FROM d1_migrations WHERE name = '0010_team_marketing_billing.sql';
