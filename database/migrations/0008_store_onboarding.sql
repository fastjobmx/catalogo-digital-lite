-- Persistent owner onboarding. Progress is isolated by store and Telegram user.
-- Snapshot current stores so they keep their current /start experience.
-- New stores created after the migration have no row in this table.
CREATE TABLE IF NOT EXISTS store_onboarding_legacy_stores (
    store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO store_onboarding_legacy_stores (store_id) SELECT id FROM stores;

CREATE TABLE IF NOT EXISTS store_onboardings (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    telegram_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'deferred', 'completed')),
    step TEXT NOT NULL DEFAULT 'welcome'
        CHECK (step IN ('welcome', 'business', 'logo', 'colors', 'template', 'banner', 'product', 'more_products', 'review')),
    state_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    mutation_token TEXT DEFAULT NULL,
    expires_at INTEGER NOT NULL,
    completed_at INTEGER DEFAULT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (store_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_store_onboardings_expiry
    ON store_onboardings(status, expires_at);

CREATE TABLE IF NOT EXISTS store_activation_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at INTEGER NOT NULL DEFAULT (unixepoch()),
    resolved_at INTEGER DEFAULT NULL,
    resolved_by TEXT DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_activation_one_pending
    ON store_activation_requests(store_id) WHERE status = 'pending';
