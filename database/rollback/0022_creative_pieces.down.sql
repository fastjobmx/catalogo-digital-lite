-- Rollback de 0022_creative_pieces.sql. Borra las piezas comerciales (los archivos en R2 bajo
-- creative-private/stores/<id>/pieces/ quedan huérfanos y deben borrarse aparte). Exportar antes.
DROP INDEX IF EXISTS idx_creative_pieces_campaign;
DROP INDEX IF EXISTS idx_creative_pieces_hash;
DROP INDEX IF EXISTS idx_creative_pieces_store;
DROP TABLE IF EXISTS creative_pieces;
