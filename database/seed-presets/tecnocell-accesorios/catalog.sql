-- Seed de catálogo TecnoCell Accesorios. Solo inserta filas nuevas por clave natural.
-- Seguro para reejecutar: no actualiza ni elimina registros existentes.
BEGIN TRANSACTION;

INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES
('Audio', 'audio', 'Productos de audio de demostración.', 1),
('Energía y carga', 'energia-carga', 'Accesorios de carga de demostración.', 2),
('Relojes inteligentes', 'relojes-inteligentes', 'Wearables de demostración.', 3),
('Accesorios móviles', 'accesorios-moviles', 'Accesorios de uso móvil de demostración.', 4);

INSERT OR IGNORE INTO products (sku, name, description, brand, category_id, price, is_featured, image_urls, metadata) VALUES
('TC-DEMO-001', 'Audífonos inalámbricos', 'Referencia visual de audífonos inalámbricos. Confirmar marca, compatibilidad, autonomía y precio antes de ofrecerlos.', NULL, (SELECT id FROM categories WHERE slug = 'audio'), 69900, 1, '["/seed-images/tecnocell-demo/wireless-earbuds.jpg"]', '{"demo":true,"verifyBeforeSale":true}'),
('TC-DEMO-002', 'Reloj inteligente', 'Imagen ilustrativa de un reloj inteligente en uso. Confirmar marca, compatibilidad, funciones y precio antes de ofrecerlo.', NULL, (SELECT id FROM categories WHERE slug = 'relojes-inteligentes'), 119900, 1, '["/seed-images/tecnocell-demo/smartwatch.jpg"]', '{"demo":true,"verifyBeforeSale":true}'),
('TC-DEMO-003', 'Batería portátil', 'Referencia visual de un teléfono cargándose desde una batería portátil. Confirmar capacidad, puertos, compatibilidad y precio del producto real.', NULL, (SELECT id FROM categories WHERE slug = 'energia-carga'), 89900, 1, '["/seed-images/tecnocell-demo/powerbank.jpg"]', '{"demo":true,"verifyBeforeSale":true}'),
('TC-DEMO-004', 'Accesorio para teléfono', 'Imagen ilustrativa de un teléfono en uso; no representa un modelo o accesorio específico. Reemplazar por la foto del producto real antes de publicar.', NULL, (SELECT id FROM categories WHERE slug = 'accesorios-moviles'), 29900, 0, '["/seed-images/tecnocell-demo/smartphone-mockup.jpg"]', '{"demo":true,"verifyBeforeSale":true}');

INSERT OR IGNORE INTO product_variants (product_id, sku, name, stock, sort_order)
SELECT id, sku || '-U', 'Única', 10, 1 FROM products WHERE sku IN ('TC-DEMO-001','TC-DEMO-002','TC-DEMO-003','TC-DEMO-004');

COMMIT;
