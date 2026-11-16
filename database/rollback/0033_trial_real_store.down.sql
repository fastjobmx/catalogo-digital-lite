-- Reversión de 0033 (prueba gratuita real). Aplicar SOLO después de volver a las versiones anteriores
-- del servidor y del panel. Las tiendas creadas como prueba siguen existiendo como tiendas normales.
-- Antes de borrar, revisar que no haya contrataciones pendientes (store_plan_requests.status = 'pendiente_pago').
DROP INDEX IF EXISTS idx_store_plan_requests_invoice;
DROP INDEX IF EXISTS idx_store_plan_requests_status;
DROP INDEX IF EXISTS idx_store_plan_requests_open;
DROP TABLE IF EXISTS store_plan_requests;
DROP INDEX IF EXISTS idx_store_trials_status;
DROP INDEX IF EXISTS idx_store_trials_email;
DROP TABLE IF EXISTS store_trials;
-- Solo si ninguna tienda usa el plan de prueba (si alguna lo usa, asignarle antes otro plan).
DELETE FROM plans WHERE code = 'prueba' AND NOT EXISTS (SELECT 1 FROM stores WHERE plan_code = 'prueba');
ALTER TABLE stores DROP COLUMN trial_ends_at;
