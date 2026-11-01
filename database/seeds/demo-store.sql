-- ============================================
-- Catalogo Digital Lite - Datos demo SNEAKERHUB PREMIUM
-- ============================================
-- Seed explicito e idempotente. Se puede volver a ejecutar sin duplicar datos.
-- Solo toca los SKU de demostracion listados abajo: elimina esas referencias y
-- vuelve a insertar el catalogo actual. Cualquier producto real (otro SKU) NO
-- se modifica.
--
-- Fotografias: archivos locales servidos por el frontend desde
-- /seed-images/sneakerhub/. Origen y licencia en docs/ASSETS_DEMO.md.
-- Marcas, referencias y precios son ficticios.

-- ============================================
-- Configuracion de la tienda demo
-- ============================================
INSERT INTO store_config (
  id, name, description, slogan, business_type, primary_color, secondary_color, accent_color,
  button_color, whatsapp_phone, whatsapp_orders, phone, email, address, hours, instagram, facebook,
  tiktok, maps_url, currency, country, delivery_methods, pickup_available, payment_info,
  default_whatsapp_message, theme_config
)
VALUES (
  1,
  'SneakerHub Premium',
  'Sneakers, streetwear y accesorios seleccionados con envio a todo el pais.',
  'Tu estilo, tu ritmo',
  'Calzado y streetwear',
  '#222222', '#D9D0C1', '#8D806D',
  '#222222',
  '+573001234567', NULL, '+573001234567', 'hola@sneakerhub.co', 'Bogota, Colombia',
  'Lun-Sab 9am-7pm', 'sneakerhub.co', 'sneakerhubco', 'sneakerhub.co', 'https://maps.google.com/?q=Bogota',
  'COP', 'CO', '["envio"]', 1, 'Tarjetas, PSE, Nequi y contraentrega',
  'Hola SneakerHub! Quiero informacion sobre un producto:',
  '{"style":{"palette":{"background":"#F7F6F2","surface":"#FFFFFF","text":"#171717","textMuted":"#717171","border":"#E5E3DE","primary":"#222222","secondary":"#D9D0C1","accent":"#8D806D","button":"#222222","buttonText":"#F7F6F2"},"typography":{"fontPrimary":"Inter","fontDisplay":"Manrope","scale":"normal","headingWeight":"bold"},"radius":"square","density":"normal","buttonStyle":"solid","cardStyle":"flat","darkMode":false},"header":{"topbarEnabled":true,"topbarText":"Envio a todo el pais · Cambios gratis en 30 dias","showContact":true,"sticky":true},"hero":{"enabled":true,"eyebrow":"TEMPORADA 2026 — SELECCION EDITORIAL","title":"El par que define\ntu proximo paso","subtitle":"","description":"Sneakers y streetwear elegidos uno a uno. Materiales nobles, siluetas limpias y envios a todo el pais.","ctaPrimaryLabel":"Explorar catalogo","ctaPrimaryHref":"/category/all","ctaSecondaryEnabled":true,"ctaSecondaryLabel":"Ver nuevos lanzamientos","ctaSecondaryHref":"/category/all?sort=newest","imageUrl":"/seed-images/sneakerhub/TERA-16.jpg","imageUrlMobile":null,"align":"left","height":"tall","overlayOpacity":52},"sections":{"order":["hero","categories","featured","promo","newest","offers","benefits","contact","cta"],"enabled":{"hero":true,"categories":true,"featured":true,"promo":true,"offers":true,"newest":true,"benefits":true,"contact":true,"testimonials":false,"cta":true},"featuredLimit":8},"promo":{"enabled":true,"eyebrow":"COLECCION OUTDOOR","title":"Fuera de ruta","text":"Cuero hidrofugado, suela de agarre profundo y un soporte de tobillo que se agradece en el descenso.","ctaLabel":"Ver outdoor","ctaHref":"/category/outdoor","imageUrl":"/seed-images/sneakerhub/TERA-15.jpg"},"featuredSkus":[],"featuredCategorySlugs":[],"benefits":[{"icon":"truck","title":"Envio nacional","text":"Despacho en 24 h y entrega en 2 a 4 dias habiles."},{"icon":"refresh","title":"Cambios sin friccion","text":"30 dias para cambiar la talla, sin preguntas."},{"icon":"shield","title":"Compra protegida","text":"Cada par se revisa antes de salir del almacen."},{"icon":"message-circle","title":"Asesoria real","text":"Te ayudamos a elegir talla y modelo por WhatsApp."}],"testimonials":[],"footer":{"aboutText":"SneakerHub Premium selecciona sneakers, streetwear y accesorios para quienes no negocian comodidad ni estilo.","showPolicies":true,"policiesTitle":"Envios y cambios","policies":"Envios a todo el pais con guia de seguimiento. Cambios y devoluciones dentro de los 30 dias posteriores a la compra presentando el numero de pedido.","copyright":"Todos los derechos reservados."}}'
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  slogan = excluded.slogan,
  business_type = excluded.business_type,
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  accent_color = excluded.accent_color,
  button_color = excluded.button_color,
  whatsapp_phone = excluded.whatsapp_phone,
  phone = excluded.phone,
  email = excluded.email,
  address = excluded.address,
  hours = excluded.hours,
  instagram = excluded.instagram,
  facebook = excluded.facebook,
  tiktok = excluded.tiktok,
  maps_url = excluded.maps_url,
  currency = excluded.currency,
  country = excluded.country,
  delivery_methods = excluded.delivery_methods,
  pickup_available = excluded.pickup_available,
  payment_info = excluded.payment_info,
  default_whatsapp_message = excluded.default_whatsapp_message,
  theme_config = excluded.theme_config,
  updated_at = datetime('now');

-- ============================================
-- Categorias (mismos slugs que usa el frontend)
-- ============================================
INSERT INTO categories (name, slug, description, sort_order) VALUES
('Urbano', 'urbano', 'Sneakers de calle con actitud, comodidad y materiales nobles para el dia a dia.', 1),
('Running', 'running', 'Amortiguacion y respuesta para entrenar, competir y bajar tus marcas.', 2),
('Casual', 'casual', 'Perfiles limpios que combinan con todo, del trabajo al fin de semana.', 3),
('Outdoor', 'outdoor', 'Agarre, proteccion y confort para senderos y clima exigente.', 4),
('Accesorios', 'accesorios', 'Complementos que completan tu equipo y cuidan tu calzado.', 5)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = datetime('now');

-- Limpieza: SKU de versiones anteriores y actuales del seed.
-- Las variantes caen en cascada. Ningun SKU ajeno a la demo se toca.
DELETE FROM products WHERE sku IN (
  'VANTA-01', 'NORD-02', 'ASTRAL-03', 'KINETIK-04', 'KINETIK-05', 'KINETIK-06',
  'LUMEN-06', 'LUMEN-07', 'TERA-08', 'ORBE-07', 'ORBE-09', 'ORBE-10', 'CIMA-11',
  'BSK-BALL-7', 'RITMO-10', 'ZENIT-11', 'RITMO-12', 'RUTA-12', 'RUTA-13',
  'NORD-14', 'TERA-15', 'TERA-16', 'VOLTA-17', 'VOLTA-04', 'VANTA-18',
  'KINETIK-19', 'RUTA-20', 'VOLTA-21', 'NORD-22', 'DEMO-001'
);

-- Categoria de baloncesto del seed anterior: se elimina solo si quedo vacia.
DELETE FROM categories WHERE slug = 'baloncesto' AND NOT EXISTS (
  SELECT 1 FROM products WHERE category_id = categories.id
);

-- ============================================
-- Productos
-- ============================================
INSERT OR IGNORE INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls) VALUES
-- Accesorios
('VANTA-18', 'Vanta Crew Socks', 'Calcetines de cana media en algodon peinado, con puno acanalado y refuerzo en el talon. Seis combinaciones de color para rotar toda la semana.', 'Vanta', (SELECT id FROM categories WHERE slug = 'accesorios'), 49900, NULL, 0, '["/seed-images/sneakerhub/VANTA-18.jpg"]'),
('KINETIK-19', 'Kinetik Sport Cap', 'Gorra de sarga lavada con visera curva y cierre ajustable. El lavado en prenda le da un tono desgastado que gana con el uso.', 'Kinetik', (SELECT id FROM categories WHERE slug = 'accesorios'), 79900, 94900, 0, '["/seed-images/sneakerhub/KINETIK-19.jpg"]'),
('RUTA-20', 'Ruta Canvas Tote', 'Tote de lona gruesa con asas reforzadas y bolsillo interior. Amplio para el dia completo y sobrio para todo.', 'Ruta', (SELECT id FROM categories WHERE slug = 'accesorios'), 119900, NULL, 0, '["/seed-images/sneakerhub/RUTA-20.jpg"]'),
('VOLTA-21', 'Volta Reusable Bottle', 'Botella reutilizable de demostracion en tono blanco con tapa deportiva. Confirmar material y capacidad antes de publicar.', 'Volta', (SELECT id FROM categories WHERE slug = 'accesorios'), 69900, NULL, 0, '["/seed-images/sneakerhub/VOLTA-21.jpg"]'),
('NORD-22', 'Nord Field Backpack', 'Mochila de lona con cierre de cordon, bolsillo frontal con hebilla metalica y correas acolchadas. Pensada para escapadas de fin de semana.', 'Nord', (SELECT id FROM categories WHERE slug = 'accesorios'), 199900, 239900, 1, '["/seed-images/sneakerhub/NORD-22.jpg"]'),
-- Casual
('NORD-14', 'Nord Suede Loafer', 'Mocasin de ante con horma redondeada y suela flexible. La alternativa sin cordones al zapato de todos los dias.', 'Nord', (SELECT id FROM categories WHERE slug = 'casual'), 169900, NULL, 0, '["/seed-images/sneakerhub/NORD-14.jpg"]'),
('RUTA-12', 'Ruta Canvas Classic', 'Lona resistente, puntera vulcanizada y cordones de algodon. El clasico de siempre en un rojo apagado que combina con todo.', 'Ruta', (SELECT id FROM categories WHERE slug = 'casual'), 149900, 179900, 0, '["/seed-images/sneakerhub/RUTA-12.jpg"]'),
-- Urbano
('ASTRAL-03', 'Astral Wave Runner', 'Silueta futurista con malla transpirable y detalles reflectantes. Comodidad de running con actitud de calle.', 'Astral', (SELECT id FROM categories WHERE slug = 'urbano'), 174900, 199900, 1, '["/seed-images/sneakerhub/ASTRAL-03.jpg"]'),
('VOLTA-04', 'Volta Street Mid', 'Cana media con paneles de ante y malla. Amortiguacion equilibrada para caminar todo el dia con soporte.', 'Volta', (SELECT id FROM categories WHERE slug = 'urbano'), 199900, NULL, 0, '["/seed-images/sneakerhub/VOLTA-04.jpg"]'),
('NORD-02', 'Nord Drift High', 'Cana alta con cuello reforzado y suela de goma antideslizante. Un basico de temporada que aguanta el ritmo de la ciudad.', 'Nord', (SELECT id FROM categories WHERE slug = 'urbano'), 219900, NULL, 1, '["/seed-images/sneakerhub/NORD-02.jpg"]'),
('VANTA-01', 'Vanta Knit Low', 'Sneaker de perfil bajo en tejido blanco, con plantilla acolchada y forro transpirable. Modelo visual de demostracion; confirmar materiales antes de publicar.', 'Vanta', (SELECT id FROM categories WHERE slug = 'urbano'), 189900, 229900, 1, '["/seed-images/sneakerhub/VANTA-01.jpg"]'),
-- Running
('LUMEN-07', 'Lumen Pace Lite', 'Rodadora ligera y ventilada, con mediasuela de espuma blanda y upper de punto. La opcion para sumar kilometros sin pensar en los pies.', 'Lumen', (SELECT id FROM categories WHERE slug = 'running'), 209900, NULL, 0, '["/seed-images/sneakerhub/LUMEN-07.jpg"]'),
('KINETIK-05', 'Kinetik Flow 3', 'Producto de demostracion: zapatilla de running azul marino y naranja, con cordones y suela blanca. Verificar modelo, color y caracteristicas reales antes de publicar.', 'Kinetik', (SELECT id FROM categories WHERE slug = 'running'), 259900, 299900, 1, '["/seed-images/sneakerhub/KINETIK-05.jpg"]'),
('KINETIK-06', 'Kinetik Aero Run', 'Modelo de demostracion para running en blanco y negro, con upper de malla y suela de perfil alto. Confirmar materiales y ficha tecnica antes de publicar.', 'Kinetik', (SELECT id FROM categories WHERE slug = 'running'), 389900, NULL, 1, '["/seed-images/sneakerhub/KINETIK-06.jpg"]'),
('TERA-08', 'Tera Trail GTX', 'Trail con membrana impermeable, tacos de agarre profundo y proteccion en la puntera. Disenada para barro, raices y desnivel.', 'Tera', (SELECT id FROM categories WHERE slug = 'running'), 279900, 319900, 1, '["/seed-images/sneakerhub/TERA-08.jpg"]'),
-- Outdoor
('TERA-16', 'Tera Ridge Low', 'Cana baja, ligera y transpirable, con suela de tacos moderados. Pensada para senderos de un dia con desniveles suaves.', 'Tera', (SELECT id FROM categories WHERE slug = 'outdoor'), 259900, NULL, 0, '["/seed-images/sneakerhub/TERA-16.jpg"]'),
('VOLTA-17', 'Volta Terra Hiker', 'Bota de cana media con membrana impermeable, cuello acolchado y suela de agarre. Disenada para barro, nieve y piedra suelta.', 'Volta', (SELECT id FROM categories WHERE slug = 'outdoor'), 229900, NULL, 0, '["/seed-images/sneakerhub/VOLTA-17.jpg"]'),
('TERA-15', 'Tera Alpine Boot', 'Bota de montana en cuero hidrofugado, con soporte de tobillo y suela profunda. Construida para terrenos exigentes y jornadas largas.', 'Tera', (SELECT id FROM categories WHERE slug = 'outdoor'), 349900, 399900, 1, '["/seed-images/sneakerhub/TERA-15.jpg"]');

-- ============================================
-- Variantes (inventario por talla; la ultima talla queda en escasez)
-- ============================================

-- Tallas 38-44: VANTA-01 y RUTA-12
WITH sizes(size, ord) AS (
  VALUES ('38', 1), ('39', 2), ('40', 3), ('41', 4), ('42', 5), ('43', 6), ('44', 7)
)
INSERT OR IGNORE INTO product_variants (product_id, sku, name, size, stock, sort_order)
SELECT p.id, p.sku || '-' || s.size, 'Talla ' || s.size, s.size,
       CASE WHEN s.ord = 7 THEN 3 ELSE 18 END, s.ord
FROM products p
CROSS JOIN sizes s
WHERE p.sku IN ('VANTA-01', 'RUTA-12');

-- Tallas 40-45: resto de calzado
WITH sizes(size, ord) AS (
  VALUES ('40', 1), ('41', 2), ('42', 3), ('43', 4), ('44', 5), ('45', 6)
)
INSERT OR IGNORE INTO product_variants (product_id, sku, name, size, stock, sort_order)
SELECT p.id, p.sku || '-' || s.size, 'Talla ' || s.size, s.size,
       CASE
         WHEN s.ord = 6 THEN 3
         WHEN p.sku = 'TERA-15' THEN 12
         WHEN p.sku = 'KINETIK-06' THEN 9
         ELSE 18
       END,
       s.ord
FROM products p
CROSS JOIN sizes s
WHERE p.sku IN (
  'NORD-02', 'ASTRAL-03', 'VOLTA-04', 'KINETIK-05', 'KINETIK-06', 'LUMEN-07',
  'TERA-08', 'NORD-14', 'TERA-15', 'TERA-16', 'VOLTA-17'
);

-- Accesorios: talla unica
INSERT OR IGNORE INTO product_variants (product_id, sku, name, size, stock, sort_order)
SELECT p.id, p.sku || '-U', 'Unica', 'Unica',
       CASE p.sku
         WHEN 'VANTA-18' THEN 42
         WHEN 'KINETIK-19' THEN 30
         WHEN 'RUTA-20' THEN 24
         WHEN 'VOLTA-21' THEN 35
         ELSE 20
       END,
       1
FROM products p
WHERE p.sku IN ('VANTA-18', 'KINETIK-19', 'RUTA-20', 'VOLTA-21', 'NORD-22');
