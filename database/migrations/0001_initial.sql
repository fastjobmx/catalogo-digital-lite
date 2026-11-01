-- ============================================
-- Catálogo Digital Lite - Migración Inicial D1
-- ============================================

-- Configuración de la tienda (singleton por instalación)
CREATE TABLE IF NOT EXISTS store_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    name TEXT NOT NULL DEFAULT 'Mi Tienda',
    description TEXT DEFAULT '',
    slogan TEXT DEFAULT '',
    business_type TEXT DEFAULT '',
    logo_url TEXT DEFAULT NULL,
    favicon_url TEXT DEFAULT NULL,
    cover_image_url TEXT DEFAULT NULL,
    primary_color TEXT NOT NULL DEFAULT '#0057FF',
    secondary_color TEXT NOT NULL DEFAULT '#C1FF00',
    accent_color TEXT NOT NULL DEFAULT '#FF6B35',
    button_color TEXT NOT NULL DEFAULT '#0057FF',
    whatsapp_phone TEXT NOT NULL DEFAULT '',
    whatsapp_orders TEXT DEFAULT NULL,
    phone TEXT DEFAULT NULL,
    email TEXT DEFAULT NULL,
    address TEXT DEFAULT NULL,
    hours TEXT DEFAULT NULL,
    instagram TEXT DEFAULT NULL,
    facebook TEXT DEFAULT NULL,
    tiktok TEXT DEFAULT NULL,
    maps_url TEXT DEFAULT NULL,
    currency TEXT NOT NULL DEFAULT 'COP',
    country TEXT NOT NULL DEFAULT 'CO',
    delivery_methods TEXT NOT NULL DEFAULT '["envio","recogida"]',
    pickup_available INTEGER NOT NULL DEFAULT 1,
    payment_info TEXT DEFAULT NULL,
    default_whatsapp_message TEXT NOT NULL DEFAULT 'Hola! Quiero hacer un pedido:',
    telegram_owner_id TEXT DEFAULT NULL,
    telegram_link_code TEXT DEFAULT NULL,
    telegram_link_expires_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Categorías
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Productos
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    brand TEXT DEFAULT NULL,
    category_id INTEGER DEFAULT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    compare_at_price INTEGER DEFAULT NULL,
    is_featured INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_archived INTEGER NOT NULL DEFAULT 0,
    image_urls TEXT NOT NULL DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Variantes de producto (inventario independiente por variante)
CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    size TEXT DEFAULT NULL,
    color TEXT DEFAULT NULL,
    price_override INTEGER DEFAULT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(product_id, sku)
);

-- Pedidos (registro local opcional)
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_id TEXT NOT NULL UNIQUE,
    customer_name TEXT DEFAULT NULL,
    customer_phone TEXT DEFAULT NULL,
    customer_email TEXT DEFAULT NULL,
    delivery_address TEXT DEFAULT NULL,
    delivery_method TEXT DEFAULT NULL,
    items_json TEXT NOT NULL DEFAULT '[]',
    subtotal INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'COP',
    status TEXT NOT NULL DEFAULT 'pendiente',
    whatsapp_sent INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Auditoría de operaciones (Telegram, Admin, API)
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT DEFAULT NULL,
    payload TEXT DEFAULT '{}',
    performed_by TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'api',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sesiones / tokens de autenticación admin
CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active, is_archived);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON admin_sessions(expires_at);