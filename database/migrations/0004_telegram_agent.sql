-- Telegram/Gemini agent: durable throttling and one-time confirmation records.
-- Additive only. Existing processed_updates and pending_actions are preserved.
CREATE TABLE IF NOT EXISTS telegram_rate_limits (
    chat_id TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

CREATE TABLE IF NOT EXISTS telegram_operations (
    operation_id TEXT PRIMARY KEY,
    update_id INTEGER NOT NULL UNIQUE,
    chat_id TEXT NOT NULL,
    action TEXT NOT NULL,
    params_json TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'applying', 'applied', 'cancelled', 'expired', 'stale')),
    execution_token TEXT,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_operations_pending
    ON telegram_operations(chat_id, status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_one_open_operation
    ON telegram_operations(chat_id)
    WHERE status IN ('pending', 'applying');
