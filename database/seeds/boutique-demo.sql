-- ============================================
-- Catálogo Digital Lite - Boutique Demo Data
-- Tienda ficticia: "Maison Lumière" - Boutique elegante
-- ============================================

-- Limpiar datos previos (opcional, para re-sembrar)
DELETE FROM product_variants;
DELETE FROM products;
DELETE FROM categories;
DELETE FROM store_config;

-- Insertar configuración de la tienda
INSERT INTO store_config (
 id, name, description, slogan, business_type,
 logo_url, favicon_url, cover_image_url,
 primary_color, secondary_color, accent_color, button_color,
 whatsapp_phone, whatsapp_orders, phone, email, address, hours,
 instagram, facebook, tiktok, maps_url,
 currency, country, delivery_methods, pickup_available,
 payment_info, default_whatsapp_message
) VALUES (
 1,
 'Maison Lumière',
 'Boutique de moda y diseño artesanal. Piezas únicas que combinan elegancia atemporal con tendencias contemporáneas. Cada artículo es seleccionado cuidadosamente para mujeres que aprecian la calidad y el estilo sofisticado.',
 'Elegancia atemporal, estilo contemporáneo',
 'Moda y Accesorios',
 NULL, NULL, NULL,
 '#2C1810', '#D4A574', '#8B4513', '#2C1810',
 '+573001234567', '+573001234567', '+573001234567', 'hola@maisonlumiere.co',
 'Carrera 15 #85-20, Bogotá', 'Lun-Sáb 10am-8pm, Dom 11am-6pm',
 'maisonlumiere', 'maisonlumiere', 'maisonlumiere',
 'https://maps.google.com/?q=Bogota+Zona+Rosa',
 'COP', 'CO',
 '["envio", "recogida"]', 1,
 'Transferencia, Nequi, Daviplata, tarjetas de crédito',
 'Hola! Me interesa hacer un pedido desde Maison Lumière:'
);

-- Insertar categorías
INSERT INTO categories (name, slug, description, sort_order, is_active) VALUES
('Vestidos', 'vestidos', 'Vestidos elegantes para toda ocasión', 1, 1),
('Blusas y Tops', 'blusas-tops', 'Blusas sofisticadas y tops versátiles', 2, 1),
('Joyería', 'joyeria', 'Joyería artesanal y piezas únicas', 3, 1),
('Bolsos y Accesorios', 'bolsos-accesorios', 'Bolsos de diseñador y accesorios exclusivos', 4, 1),
('Cuidado Personal', 'cuidado-personal', 'Productos de belleza y cuidado premium', 5, 1),
('Decoración del Hogar', 'decoracion-hogar', 'Piezas decorativas para espacios elegantes', 6, 1);

-- Insertar productos con variantes
-- Producto 1: Vestido de Noche Elegante
INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
VALUES (
 'VEST-001',
 'Vestido de Noche Celeste',
 'Vestido largo de seda con escote en V y espalda descubierta. Perfecto para eventos formales y ocasiones especiales. Confeccionado en Italia con los mejores materiales.',
 'Maison Lumière',
 1,
 890000,
 1200000,
 1,
 '[]',
 1, 0
);

INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order, is_active) VALUES
(1, 'VEST-001-S-NEGRO', 'Vestido Celeste - Negro', 'S', 'Negro', NULL, 3, 1, 1),
(1, 'VEST-001-M-NEGRO', 'Vestido Celeste - Negro', 'M', 'Negro', NULL, 5, 2, 1),
(1, 'VEST-001-L-NEGRO', 'Vestido Celeste - Negro', 'L', 'Negro', NULL, 2, 3, 1),
(1, 'VEST-001-S-AZUL', 'Vestido Celeste - Azul Marino', 'S', 'Azul Marino', NULL, 2, 4, 1),
(1, 'VEST-001-M-AZUL', 'Vestido Celeste - Azul Marino', 'M', 'Azul Marino', NULL, 4, 5, 1),
(1, 'VEST-001-L-AZUL', 'Vestido Celeste - Azul Marino', 'L', 'Azul Marino', NULL, 1, 6, 1);

-- Producto 2: Blusa de Seda
INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
VALUES (
 'BLUS-002',
 'Blusa Aurora de Seda',
 'Blusa de seda 100% natural con mangas abullonadas y cuello alto. Diseño versátil que se adapta tanto a looks formales como casuales.',
 'Maison Lumière',
 2,
 320000,
 450000,
 1,
 '[]',
 1, 0
);

INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order, is_active) VALUES
(2, 'BLUS-002-S-BLANCO', 'Blusa Aurora - Blanco', 'S', 'Blanco', NULL, 4, 1, 1),
(2, 'BLUS-002-M-BLANCO', 'Blusa Aurora - Blanco', 'M', 'Blanco', NULL, 6, 2, 1),
(2, 'BLUS-002-L-BLANCO', 'Blusa Aurora - Blanco', 'L', 'Blanco', NULL, 3, 3, 1),
(2, 'BLUS-002-S-ROSA', 'Blusa Aurora - Rosa Palo', 'S', 'Rosa Palo', NULL, 2, 4, 1),
(2, 'BLUS-002-M-ROSA', 'Blusa Aurora - Rosa Palo', 'M', 'Rosa Palo', NULL, 5, 5, 1),
(2, 'BLUS-002-L-ROSA', 'Blusa Aurora - Rosa Palo', 'L', 'Rosa Palo', NULL, 2, 6, 1);

-- Producto 3: Collar de Perlas
INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
VALUES (
 'JOYA-003',
 'Collar de Perlas Naturales',
 'Collar de perlas cultivadas de agua dulce con broche de oro de 18 quilates. Pieza artesanal única que complementa cualquier atuendo elegante.',
 'Maison Lumière',
 3,
 650000,
 NULL,
 1,
 '[]',
 1, 0
);

INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order, is_active) VALUES
(3, 'JOYA-003-UNICO', 'Collar de Perlas - Único', NULL, 'Blanco Perla', NULL, 8, 1, 1);

-- Producto 4: Bolso de Cuero Italiano
INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
VALUES (
 'BOLS-004',
 'Bolso Toscana de Cuero',
 'Bolso de mano elaborado en cuero italiano genuino con herrajes dorados. Diseño atemporal con capacidad perfecta para el día a día.',
 'Maison Lumière',
 4,
 780000,
 950000,
 1,
 '[]',
 1, 0
);

INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order, is_active) VALUES
(4, 'BOLS-004-NEGRO', 'Bolso Toscana - Negro', NULL, 'Negro', NULL, 4, 1, 1),
(4, 'BOLS-004-CAMEL', 'Bolso Toscana - Camel', NULL, 'Camel', NULL, 3, 2, 1),
(4, 'BOLS-004-MARRON', 'Bolso Toscana - Marrón', NULL, 'Marrón Oscuro', NULL, 2, 3, 1);

-- Producto 5: Crema Hidratante Premium
INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
VALUES (
 'CUID-005',
 'Crema Hidratante Éternelle',
 'Crema facial hidratante con ácido hialurónico y vitamina E. Fórmula ligera de rápida absorción para todo tipo de piel. 50ml.',
 'Maison Lumière',
 5,
 185000,
 NULL,
 0,
 '[]',
 1, 0
);

INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order, is_active) VALUES
(5, 'CUID-005-50ML', 'Crema Éternelle - 50ml', '50ml', NULL, NULL, 15, 1, 1);

-- Producto 6: Jarrón Decorativo
INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
VALUES (
 'DECO-006',
 'Jarrón Cerámico Artesanal',
 'Jarrón de cerámica hecho a mano con acabado mate y detalles en oro. Pieza única de decoración que añade elegancia a cualquier espacio.',
 'Maison Lumière',
 6,
 245000,
 NULL,
 1,
 '[]',
 1, 0
);

INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order, is_active) VALUES
(6, 'DECO-006-BLANCO', 'Jarrón Artesanal - Blanco', NULL, 'Blanco Mate', NULL, 5, 1, 1),
(6, 'DECO-006-GRIS', 'Jarrón Artesanal - Gris', NULL, 'Gris Perla', NULL, 3, 2, 1);

-- Producto 7: Vestido Casual Elegante
INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
VALUES (
 'VEST-007',
 'Vestido Midi Versátil',
 'Vestido midi de algodón premium con corte A. Perfecto para el día a día con un toque de elegancia. Disponible en colores neutros.',
 'Maison Lumière',
 1,
 420000,
 550000,
 1,
 '[]',
 1, 0
);

INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order, is_active) VALUES
(7, 'VEST-007-S-BEIGE', 'Vestido Midi - Beige', 'S', 'Beige', NULL, 4, 1, 1),
(7, 'VEST-007-M-BEIGE', 'Vestido Midi - Beige', 'M', 'Beige', NULL, 6, 2, 1),
(7, 'VEST-007-L-BEIGE', 'Vestido Midi - Beige', 'L', 'Beige', NULL, 3, 3, 1),
(7, 'VEST-007-S-GRIS', 'Vestido Midi - Gris', 'S', 'Gris Claro', NULL, 2, 4, 1),
(7, 'VEST-007-M-GRIS', 'Vestido Midi - Gris', 'M', 'Gris Claro', NULL, 5, 5, 1),
(7, 'VEST-007-L-GRIS', 'Vestido Midi - Gris', 'L', 'Gris Claro', NULL, 2, 6, 1);

-- Producto 8: Pendientes de Oro
INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
VALUES (
 'JOYA-008',
 'Pendientes Sol de Oro',
 'Pendientes de oro de 18 quilates con diseño de sol radiante. Pieza artesanal que añade un toque de lujo a cualquier look.',
 'Maison Lumière',
 3,
 890000,
 NULL,
 1,
 '[]',
 1, 0
);

INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order, is_active) VALUES
(8, 'JOYA-008-UNICO', 'Pendientes Sol - Único', NULL, 'Oro 18k', NULL, 6, 1, 1);

-- Producto 9: Bufanda de Cashmere
INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
VALUES (
 'ACCE-009',
 'Bufanda de Cashmere Puro',
 'Bufanda elaborada en cashmere 100% puro de Mongolia. Suavidad incomparable y calidez excepcional para los días fríos.',
 'Maison Lumière',
 4,
 380000,
 480000,
 0,
 '[]',
 1, 0
);

INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order, is_active) VALUES
(9, 'ACCE-009-GRIS', 'Bufanda Cashmere - Gris', NULL, 'Gris', NULL, 8, 1, 1),
(9, 'ACCE-009-CAMEL', 'Bufanda Cashmere - Camel', NULL, 'Camel', NULL, 5, 2, 1),
(9, 'ACCE-009-NEGRO', 'Bufanda Cashmere - Negro', NULL, 'Negro', NULL, 7, 3, 1);

-- Producto 10: Lámpara de Mesa
INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
VALUES (
 'DECO-010',
 'Lámpara de Mesa Minimalista',
 'Lámpara de mesa con base de mármol y pantalla de lino. Diseño minimalista que ilumina con elegancia cualquier rincón del hogar.',
 'Maison Lumière',
 6,
 520000,
 NULL,
 0,
 '[]',
 1, 0
);

INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order, is_active) VALUES
(10, 'DECO-010-BLANCO', 'Lámpara Minimalista - Blanco', NULL, 'Blanco/Mármol', NULL, 3, 1, 1),
(10, 'DECO-010-GRIS', 'Lámpara Minimalista - Gris', NULL, 'Gris/Mármol', NULL, 2, 2, 1);