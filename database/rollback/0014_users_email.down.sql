-- Reverts 0014_users_email.sql. Run the previous Worker version first.
-- Deletes the email history and templates; export them first if needed.
DROP INDEX IF EXISTS idx_email_messages_store;
DROP INDEX IF EXISTS idx_email_messages_user;
DROP INDEX IF EXISTS idx_email_messages_created;
DROP TABLE IF EXISTS email_messages;
DROP TABLE IF EXISTS email_templates;
DROP INDEX IF EXISTS idx_email_verification_user;
DROP TABLE IF EXISTS email_verification_tokens;
ALTER TABLE user_access_tokens DROP COLUMN delivered_via;
ALTER TABLE platform_users DROP COLUMN credentials_changed_at;
ALTER TABLE platform_users DROP COLUMN email_verified_at;
