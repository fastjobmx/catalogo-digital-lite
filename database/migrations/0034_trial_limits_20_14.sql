-- 0034: prueba gratis con 20 productos y 14 días (decisión del propietario, 2026-11-15).
-- Solo cambia el plan inactivo «prueba» y las pruebas que aún no han vencido: nunca reduce un límite.
-- Rollback: database/rollback/0034_trial_limits_20_14.down.sql
UPDATE plans SET max_products = 20 WHERE code = 'prueba' AND max_products < 20;
-- Pruebas pendientes (aún sin empezar): reciben las nuevas condiciones completas.
UPDATE store_trials SET product_limit = 20, duration_days = 14 WHERE status = 'pendiente' AND product_limit < 20;
-- Pruebas en curso: más productos desde ya; sus días no cambian (la plataforma puede ampliarlas).
UPDATE store_trials SET product_limit = 20 WHERE status = 'activa' AND product_limit < 20;
