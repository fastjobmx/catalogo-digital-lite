-- Reversión de 0020_creative_studio.sql. Borra el Brand Kit y los trabajos creativos de todas las tiendas.
-- No afecta créditos: las reservas abiertas vencen solas (releaseExpiredReservations) y se devuelven.
-- Antes de ejecutarla en producción, exporta las tablas si tienen datos que quieras conservar.
DROP INDEX IF EXISTS idx_creative_jobs_status;
DROP INDEX IF EXISTS idx_creative_jobs_store;
DROP TABLE IF EXISTS creative_jobs;
DROP TABLE IF EXISTS brand_kits;
