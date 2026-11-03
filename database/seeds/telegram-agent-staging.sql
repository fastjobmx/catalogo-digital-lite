-- Inventario completamente ficticio para el entorno local de staging.
-- No contiene información copiada de SneakerHub ni datos de clientes/pedidos.
INSERT OR IGNORE INTO store_config (id, name, business_type, currency, country)
VALUES (1, 'SneakerHub Agent Test', 'calzado', 'COP', 'CO');

INSERT OR IGNORE INTO categories (id, name, slug, description, sort_order, is_active)
VALUES (1, 'Pruebas', 'pruebas', 'Categoría ficticia para pruebas automatizadas', 1, 1);

INSERT OR IGNORE INTO products
  (id, sku, name, description, brand, category_id, price, image_urls, is_active, is_archived)
VALUES
  (1, 'TEST-TRN-001', 'Tenis de prueba', 'Producto ficticio de staging', 'Marca Demo', 1, 100000, '[]', 1, 0);

INSERT OR IGNORE INTO product_variants
  (id, product_id, sku, name, size, color, stock, is_active, sort_order)
VALUES
  (1, 1, 'TEST-TRN-001-38', 'Talla 38', '38', 'Negro', 4, 1, 1),
  (2, 1, 'TEST-TRN-001-39', 'Talla 39', '39', 'Negro', 2, 1, 2);
