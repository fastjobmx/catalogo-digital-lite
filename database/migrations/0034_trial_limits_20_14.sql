-- 0034: prueba gratis con 20 productos y 14 días (decisión del propietario, 2026-11-15).
-- Solo cambia el plan inactivo «prueba» y las pruebas que aún no han vencido: nunca reduce un límite.
-- Rollback: database/rollback/0034_trial_limits_20_14.down.sql
UPDATE plans SET max_products = 20 WHERE code = 'prueba' AND max_products < 20;
-- Pruebas pendientes (aún sin empezar): reciben las nuevas condiciones completas.
UPDATE store_trials SET product_limit = 20, duration_days = 14 WHERE status = 'pendiente' AND product_limit < 20;
-- Pruebas en curso: más productos desde ya, y las que empezaron con 7 días reciben los 14 días de la oferta nueva.
UPDATE store_trials SET product_limit = 20 WHERE status = 'activa' AND product_limit < 20;
UPDATE store_trials SET expires_at = datetime(expires_at, '+' || (14 - duration_days) || ' days'), duration_days = 14
  WHERE status = 'activa' AND duration_days < 14 AND expires_at IS NOT NULL;
UPDATE stores SET trial_ends_at = (SELECT t.expires_at FROM store_trials t WHERE t.store_id = stores.id)
  WHERE id IN (SELECT store_id FROM store_trials WHERE status = 'activa') AND trial_ends_at IS NOT NULL;
