-- Reversión de 0021_photo_studio.sql. Borra la biblioteca del Estudio Creativo (solo los registros: los
-- objetos privados de R2 bajo creative-private/ y las copias aprobadas en stores/<id>/products/estudio/
-- quedan en el bucket; las fotos aprobadas que ya están en productos siguen funcionando).
-- Antes de ejecutarla en producción, exporta creative_assets si quieres conservar el historial.
ALTER TABLE trial_sessions DROP COLUMN photo_enhance_count;
DROP INDEX IF EXISTS idx_creative_jobs_batch;
ALTER TABLE creative_jobs DROP COLUMN batch_id;
DROP INDEX IF EXISTS idx_creative_assets_original_hash;
DROP INDEX IF EXISTS idx_creative_assets_source;
DROP INDEX IF EXISTS idx_creative_assets_product;
DROP INDEX IF EXISTS idx_creative_assets_store;
DROP TABLE IF EXISTS creative_assets;
