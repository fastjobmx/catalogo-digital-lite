-- Seed de catálogo Patitas Felices. Solo inserta filas nuevas por clave natural.
-- Seguro para reejecutar: no actualiza ni elimina registros existentes.
BEGIN TRANSACTION;

INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES
('Perros', 'perros', 'Productos de demostración para perros.', 1),
('Gatos', 'gatos', 'Productos de demostración para gatos.', 2),
('Cuidado y snacks', 'cuidado-snacks', 'Snacks y básicos de cuidado. Verificar ficha real antes de venta.', 3);

INSERT OR IGNORE INTO products (sku, name, description, brand, category_id, price, is_featured, image_urls, metadata) VALUES
('PF-DEMO-001', 'Snacks para perro', 'Producto ilustrativo para la demo. La imagen muestra snacks en un tazón; confirmar marca, ingredientes, peso y precio antes de ofrecerlo.', NULL, (SELECT id FROM categories WHERE slug = 'cuidado-snacks'), 18900, 1, '["/seed-images/patitas/pet-bowl.jpg"]', '{"demo":true,"verifyBeforeSale":true}'),
('PF-DEMO-002', 'Rascador para gato', 'Producto ilustrativo para la demo. La foto muestra un gato junto a un rascador; confirmar modelo, materiales y precio antes de ofrecerlo.', NULL, (SELECT id FROM categories WHERE slug = 'gatos'), 79900, 1, '["/seed-images/patitas/cat-scratcher.jpg"]', '{"demo":true,"verifyBeforeSale":true}'),
('PF-DEMO-004', 'Premios para mascotas', 'Foto de referencia de snacks para mascotas. No representa una marca, composición o tamaño específicos.', NULL, (SELECT id FROM categories WHERE slug = 'cuidado-snacks'), 12900, 0, '["/seed-images/patitas/treats.jpg"]', '{"demo":true,"verifyBeforeSale":true}');

INSERT OR IGNORE INTO product_variants (product_id, sku, name, stock, sort_order)
SELECT id, sku || '-U', 'Única', 12, 1 FROM products WHERE sku IN ('PF-DEMO-001','PF-DEMO-002','PF-DEMO-004');

COMMIT;
