-- Rollback de 0034: el plan «prueba» vuelve a 7 productos para los registros nuevos.
-- No reduce el límite de pruebas ya en curso (sus comerciantes podrían tener más de 7 productos).
UPDATE plans SET max_products = 7 WHERE code = 'prueba';
UPDATE store_trials SET product_limit = 7, duration_days = 7 WHERE status = 'pendiente';
