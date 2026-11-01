# Plan de mejora visual — Catálogo Digital Lite

Documento de la **FASE A**: auditoría del estado actual, debilidades detectadas y plan de intervención.

## 1. Estado actual (lo que ya existe)

| Área | Estado |
|---|---|
| Storefront | Home con hero plano, chips de categorías, «Destacados» y «Novedades». Navegación por categoría y buscador. |
| Detalle de producto | Galería simple, selector de variantes, cantidad y añadir al carrito. |
| Carrito | Drawer lateral con cantidades, subtotal y checkout a WhatsApp. |
| Admin | 7 secciones (Resumen, Productos, Categorías, Configuración, Cuestionario, Simulador IA, Pedidos). |
| Personalización | Solo nombre, eslogan, descripción, contacto, redes y 2 colores. |

## 2. Debilidades detectadas

### 2.1 Storefront
- **Header:** topbar con emojis como iconos; sin navegación por categorías en desktop; buscador solo visible en desktop; sin estado *sticky* con cambio de elevación.
- **Hero:** un único bloque centrado de color plano; no es configurable (título, subtítulo, CTAs, imagen, alineación); sin jerarquía ni profundidad; el aviso de modo demo rompe la estética.
- **Categorías:** fila de *chips* sin imagen ni estado activo claro; sin bloque visual de categorías destacadas en el home.
- **Tarjetas de producto:** relación de aspecto fija, sin segunda imagen en *hover*, badges pequeños, sin indicador de tallas disponible, sin CTA visible, sombras muy tenues.
- **Home:** solo 2 secciones de producto; sin banner promocional, sin beneficios, sin prueba social, sin CTA final; orden no editable.
- **Detalle de producto:** sin galería con miniaturas laterales, sin bloque de beneficios/envío, «relacionados» como lista de texto (no tarjetas), selector de variantes como botones planos.
- **Carrito:** vacío con emoji, sin barra de progreso de compra, sin badges de confianza, tipografía de precio inconsistente.
- **Footer:** solo 4 columnas simples, sin políticas, sin enlaces útiles, sin bloque de pago/seguridad, copyright muy discreto.
- **Sistema de diseño:** sin escala tipográfica, sin tokens de sombra progresiva, radios fijos, sin estados de foco visibles, sin animaciones de entrada.

### 2.2 Personalización (la debilidad más grave)
- No se puede controlar: logo, favicon, imagen de portada, color de acento, color de botón, tipografía, radio, densidad, estilo de botones/cards, modo oscuro.
- **No existe configuración del hero** (textos, CTAs, imagen, alineación).
- **No existe configuración de secciones** del home (activar/desactivar/ordenar).
- **No existe selección manual** de productos destacados ni de categorías destacadas.
- **No existe banner promocional** configurable.
- **No existe configuración del footer** (sobre nosotros, políticas, copyright).
- Todo cambio exige editar código.

### 2.3 Admin
- Sidebar funcional pero sin agrupación ni icono de marca; sin sección de **Apariencia**.
- Dashboard con 4 KPIs planos; sin accesos visuales ni estado del sistema.
- Formularios largos sin organización por pestañas ni vista previa; guardado sin feedback persistente.
- Sin vista previa de los cambios de tema.

### 2.4 Datos demo
- Solo 6 productos; imágenes `placehold.co` genéricas; sin banner, sin variedad de color en variantes; la tienda se ve vacía en varias categorías.

## 3. Plan de intervención

### FASE B — Storefront premium
- **Sistema de diseño primero:** escala tipográfica, sombras progresivas, radios y densidad configurables, animaciones de entrada, utilidades `btn`/`card`/`badge`.
- **Header:** topbar informativa elegante, sticky con elevación, navegación por categorías en desktop, buscador con sugerencias visuales, carrito con badge animado.
- **Hero configurable:** eyebrow + titular + subtítulo + descripción + 2 CTAs + imagen + overlay + alineación; composición asimétrica en desktop y apilada en móvil.
- **Categorías:** bloque visual con imagen/icono y contadores; chips con estado activo elegante.
- **Secciones del home** (orden y visibilidad configurables): destacados, categorías, banners promocionales, novedades, ofertas, beneficios, testimonios y CTA final.
- **Tarjetas:** imagen dominante con segunda imagen en hover, badges (destacado/oferta/nuevo/agotado), marca, nombre, precio con tachado y % de descuento, tallas disponibles, CTA.
- **Detalle:** galería principal + miniaturas, marca y SKU, precio, stock, variantes (talla/color), stepper de cantidad, CTAs (carrito + WhatsApp), beneficios de compra y relacionados en tarjetas.
- **Carrito:** resumen con subtotal, edición de cantidades, vacío elegante, mensajes de confianza y CTA WhatsApp destacado.
- **Footer:** marca + descripción, enlaces, contacto, redes, horarios, políticas, métodos de pago y copyright.

### FASE C — Admin
- Sidebar agrupado (Catálogo, Apariencia, Operación) con marca y avatar; navegación móvil.
- Dashboard con KPIs visuales, accesos rápidos y estado del sistema.
- Formularios organizados en tarjetas y pestañas; feedback de guardado persistente.

### FASE D — Personalización
Persistida en D1 mediante una nueva columna JSON `store_config.theme_config` (sin romper el esquema actual):
- **Marca:** nombre, eslogan, descripciones, logo, favicon, tipo de negocio.
- **Tema:** color primario/secundario/acento/botón, tipografía, radio, densidad, estilo de botones/cards, modo claro/oscuro y presets de tema.
- **Hero:** todo lo del hero, activable.
- **Secciones:** activar/desactivar y ordenar; límite de destacados.
- **Destacados:** selección manual de productos y categorías.
- **Promocional:** banner intermedio editable.
- **Contacto y comercial:** WhatsApp, teléfono, email, dirección, horarios, redes, mapa, moneda, mensaje de WhatsApp, entregas, pagos y políticas.
- **Footer:** texto, políticas y copyright.

### FASE E — Tienda demo premium
- Identidad propia («SneakerHub Premium»), eslogan, descripción y paleta.
- 6 categorías y **16 productos** con nombres, marcas demo, precios coherentes, ofertas, destacados, variantes por talla y por color, y stock realista.
- Imágenes generadas con identidad propia (sin marcas reales ni contenido protegido).
- Banner de portada, banner promocional, beneficios y testimonios configurados.

### FASE F — Verificación
- `tsc --noEmit` en frontend y worker.
- Pruebas existentes (38) en verde.
- `npm run build` sin errores.
- Reinicio de D1 con el nuevo seed y comprobación de endpoints.
- Comprobación de que un cambio en el admin se refleja en la tienda pública.
