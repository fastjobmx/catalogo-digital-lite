-- ============================================
-- Configuración de apariencia de la tienda
-- ============================================
-- Guarda en JSON todo lo personalizable desde /admin/apariencia:
-- estilo (tipografía, radios, densidad, botones, tarjetas, modo oscuro),
-- hero, secciones del home, banner promocional, destacados, beneficios,
-- testimonios y footer.

ALTER TABLE store_config ADD COLUMN theme_config TEXT NOT NULL DEFAULT '{}';
