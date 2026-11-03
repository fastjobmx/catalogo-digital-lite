# Guía de personalización — SneakerHub Premium

Sitio: `catalogo-lite`  
Aplica a: `frontend/src/admin/pages/Appearance.tsx`, `frontend/src/types/theme.ts`, `frontend/src/contexts/StoreContext.tsx`.

Esta guía explica cómo un comerciante (o desarrollador) cambia la identidad visual de la tienda **sin tocar código**, desde el panel `/admin/apariencia`. Los cambios se guardan en D1 (cuando hay backend) o en el navegador (modo demo).

## 1. Entrar al personalizador

1. Inicia el Worker (`npx wrangler dev --port 8788`) y el frontend (`npx vite`).
2. Abre `http://localhost:5173/admin` y accede a **Apariencia**.
3. El panel se divide en controles (izquierda) y una vista previa reducida (derecha) que se actualiza en vivo mientras editas.

## 2. Qué se puede configurar

### Plantillas
Aplica de un clic un esquema completo de colores, tipografía, radios, modo oscuro y estilos de botón/tarjeta:
- **Streetwear Premium** (por defecto): editorial, neutro, fotografía protagonista.
- **Boutique Elegance**: fondos cálidos, serif editorial, bordes suaves.
- **Tech Minimal**: composición limpia, azul técnico, acentos fríos.

Aplicar una plantilla **no borra productos, categorías, contactos ni fotografías**.

### Colores (diez tokens)
Edita cada uno con el selector de color o escribiendo el valor hex:

| Token | Defecto | Uso |
|---|---|---|
| Fondo de la página | `#F7F6F2` | Fondo general |
| Superficie (tarjetas, header) | `#FFFFFF` | Tarjetas, paneles, header |
| Texto principal | `#171717` | Títulos, cuerpo |
| Texto secundario | `#717171` | Metadatos, etiquetas suaves |
| Bordes y separadores | `#E5E3DE` | Líneas, divisores |
| Color primario | `#222222` | Enlaces, foco, selección |
| Color secundario | `#D9D0C1` | Etiquetas, bloques suaves |
| Acento editorial | `#8D806D` | Detalles, eyebrows |
| Fondo de botones | `#222222` | Botón principal |
| Texto de botones | `#F7F6F2` | Texto sobre el botón principal |

Al guardar, los valores se escriben también en las columnas legacy `primary_color`, `secondary_color`, `accent_color`, `button_color` de `store_config` para compatibilidad con integraciones antiguas.

### Tipografía y estilo
- **Fuente de interfaz**: Inter, Manrope, DM Sans, Space Grotesk, Sora o Playfair Display (solo fuentes seguras de Google Fonts).
- **Fuente de títulos**: misma lista, independiente de la de interfaz.
- **Escala de texto**: compacta / normal / amplia.
- **Peso de títulos**: semibold / bold / extrabold.
- **Bordes**: recto / suave / redondeado / pastilla.
- **Densidad**: compacta / normal / amplia (afecta separación de secciones, relleno de tarjetas y hueco de cuadrícula).
- **Estilo de botones**: sólido / contorno / suave.
- **Estilo de tarjetas**: con sombra / con borde / plana.
- **Modo oscuro**: activa/desactiva; invierte superficies y textos manteniendo la paleta como base.

### Encabezado (header)
- Barra informativa superior: activar/desactivar y texto (ej. "Envío a todo el país · Cambios gratis en 30 días").
- Acceso a WhatsApp/teléfono: solo se muestra si hay un número configurado en Datos de la tienda.
- Encabezado fijo al hacer scroll: activar/desactivar.

### Portada (hero)
- Mostrar/ocultar portada.
- Etiqueta superior, alineación del texto (izquierda / centrada / derecha), título (admite salto de línea), subtítulo y descripción.
- Botón principal y secundario con texto y enlace (deben apuntar a una página real del catálogo; no se permiten CTA sin acción).
- Fotografía de escritorio y opcional de móvil (ruta local o URL).
- Altura: compacta / estándar / amplia.
- Oscurecimiento de la imagen: 0–90 %.

### Secciones de la página de inicio
Cada sección se puede activar/ocultar y reordenar (subir/bajar):
- Portada (hero), Categorías visuales, Colección destacada, Banner editorial, Ofertas, Nuevos lanzamientos, Beneficios comerciales, Contacto y WhatsApp, Testimonios (solo reales), Cierre editorial.
- Productos por sección: 4–16.

Cuando una sección no tiene datos (ej. testimonios vacíos), se oculta automáticamente. Nunca se publican reseñas ni valoraciones inventadas.

### Banner editorial
Etiqueta, título, texto, botón con enlace e imagen. Ideal para campañas y temporadas.

### Beneficios de compra
Lista de beneficios con icono, título y descripción. Solo afirmaciones que la tienda pueda cumplir. Se renderizan como una fila sobria; no como tarjetas con estadísticas inventadas.

### Testimonios reales
Agrega solo opiniones de clientes reales, con su permiso. La sección permanece oculta mientras no haya al menos un testimonio con texto.

### Pie de página
Texto sobre la tienda, mostrar políticas, título de políticas, texto de copyright y detalle de políticas.

## 3. Guardar y persistir

- **Guardar apariencia**: persiste la configuración. En modo demo o sin backend, queda en `localStorage` del navegador.
- Con backend y sesión de administrador, se envía a `PUT /api/admin/store` con `themeConfig` y se refresca desde la API.
- **Restaurar**: vuelve a los valores por defecto del tema Streetwear Premium (descarta cambios no guardados).

## 4. Dónde vive cada ajuste en código

| Ajuste | Archivo y propiedad |
|---|---|
| Paleta de 10 colores | `frontend/src/types/theme.ts` → `PaletteConfig`; `frontend/src/styles/globals.css` → `--color-*` |
| Tipografía | `frontend/src/types/theme.ts` → `TypographyConfig`; `SAFE_FONTS` |
| Header | `frontend/src/types/theme.ts` → `HeaderConfig`; `frontend/src/components/layout/Header.tsx` |
| Hero | `frontend/src/types/theme.ts` → `HeroConfig`; `frontend/src/components/home/HeroSection.tsx` |
| Secciones del home | `frontend/src/types/theme.ts` → `SectionConfig`; `frontend/src/pages/HomePage.tsx` |
| Migración de temas antiguos | `frontend/src/types/theme.ts` → `mergeTheme` / `migrateStyle` |
| Aplicación de variables CSS | `frontend/src/contexts/StoreContext.tsx` |

## 5. Límites

- No se permite guardar CSS ni JavaScript arbitrario del comerciante (evita inyección y mantiene el tema mantenible).
- La vista previa del administrador es una representación reducida basada en la configuración y los datos del catálogo disponibles; no es un render aislado del storefront real.
- La persistencia remota en D1 requiere una sesión de administrador conectada y no se comprobó en esta sesión.

## 6. Documentación relacionada

- `docs/STREETWEAR_PREMIUM.md` — alcance del tema y archivo modificado.
- `docs/ASSETS_DEMO.md` — imágenes demo, autor, fuente y licencia.
- `docs/PENDIENTES.md` — trabajo no completado (incluye personalización completa y presets adicionales).
- `PROGRESO.md` — estado por fase y evidencia de lo verificado.
