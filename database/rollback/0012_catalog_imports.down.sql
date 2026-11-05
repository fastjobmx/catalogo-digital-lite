-- Reverts 0012_catalog_imports.sql. Run the previous Worker version first.
-- Imported products stay; only the import history is removed.
DROP INDEX IF EXISTS idx_import_job_batches_store;
DROP TABLE IF EXISTS import_job_batches;
DROP INDEX IF EXISTS idx_import_jobs_store;
DROP TABLE IF EXISTS import_jobs;
