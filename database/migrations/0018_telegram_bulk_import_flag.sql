-- Telegram bulk import starts disabled for every existing and future store.
ALTER TABLE stores
    ADD COLUMN telegram_bulk_import_enabled INTEGER NOT NULL DEFAULT 0
        CHECK (telegram_bulk_import_enabled IN (0, 1));
