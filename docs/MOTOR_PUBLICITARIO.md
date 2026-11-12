# Fábrica de publicidad (Estudio Creativo · fase 4)

Rama: `feat/motor-publicitario` (sale de `main` = `0bfbc03`). Worktree: `.tmp/wt-motor`.
Estado: **completa y validada en local. Commits locales; sin push, sin merge y sin despliegue.** No necesita migración de base de datos.

| Commit | Contenido |
|---|---|
| `4ba2cf5` | Motor de diseño: análisis de foto, composición medida, control de calidad, paso «Diseño» |
| `3c9c842` | Primera biblioteca de 15 estilos genéricos (reemplazada por la sectorial) |
| `b8e8c4c` | Dirección de arte por sector: 5 familias × 3 estilos, sector y objetivo, 5 composiciones de campaña |
| `2e6d4ff` | 10 plantillas de video con música generada, generación por lotes y ZIP |

Fase anterior: [FABRICA_CREATIVOS_FASE3.md](FABRICA_CREATIVOS_FASE3.md) (en producción).

---

## 1. Relación con producción (verificado el 2026-11-12, solo lectura)

- API `catalogo-lite-api`: versión `56b1450b` = código `c08c55d` (rama `feat/telegram-ia-planes`, que ya incluye `main`). **La API de producción va por delante de `main`.**
- Panel `catalogo-digital-ia`: desplegado el 2026-11-11 desde `main` (`0bfbc03`).
- `git merge-tree` de esta rama con `c08c55d` y con la punta `891d17a` de Telegram: **sin conflictos**. Esta rama no toca WhatsApp ni Telegram.
- Para publicar habrá que integrar primero esta rama con `feat/telegram-ia-planes` (o con lo que esté en producción ese día) y desplegar desde esa integración, no desde `main` sola: desplegar la API desde esta rama tal cual **quitaría** los cambios de Telegram que hoy corren.

## 2. Qué hace

En **Estudio Creativo → Creativos y video** el comerciante elige productos reales y obtiene imágenes, carruseles, historias, publicaciones y videos con su foto, nombre, precio y logo exactos. Todo se compone en su navegador: **sin IA de imágenes ni de video y sin costo por pieza**. Gemini solo se usa, si el comercio lo pide, para sugerir textos (filtrados).

### Decisiones del motor, en orden

1. **Sector** (sugerido con las categorías y nombres reales): calzado, moda/boutique, streetwear, hogar/decoración, belleza/cosmética.
2. **Objetivo**: venta directa, promoción, nueva colección, catálogo limpio, historia aspiracional, beneficios, lanzamiento. Cambia la jerarquía (qué manda: producto, precio, marca o datos). Nunca agrega afirmaciones: «Promoción» solo muestra rebajas si el catálogo tiene precio anterior; «Beneficios» solo muestra los que el comercio escribió o aprobó; «NUEVO» solo si el producto es nuevo de verdad.
3. **Estilo**: 3 por sector.
4. **Composición**: 5 por estilo, de 10 posibles. Si el producto es vertical (persona, espejo), las composiciones apiladas pasan a «lado a lado» para que se vea grande.

### Los 15 estilos

| Sector | Estilo | Lenguaje visual |
|---|---|---|
| Calzado | Sneaker Impact | Negro, luz del color de la marca, palabra gigante en contorno, líneas de velocidad, Anton, precio en bloque inclinado, botón en bloque, sello |
| Calzado | Sport Neon | Degradado noche-violeta, neón, cuadrícula de pista, Bebas Neue, etiqueta de precio, botón con flecha, reflejo |
| Calzado | Urban Drop | Concreto con grano, naranja de seguridad, collage, adhesivo de precio, cinta, Archivo Black |
| Moda | Editorial Nude | Nude y crema, lookbook, Cormorant Garamond, marco fino, precio discreto, enlace en vez de botón |
| Moda | Luxury Lookbook | Negro, marfil y champán, Playfair itálica, foto grande, botón de contorno |
| Moda | Sale Chic | Rosa empolvado y negro, DM Serif, sello circular, precio en cápsula, botón en bloque |
| Streetwear | Street Collage | Papel con grano y trama, fotos con cinta, producto recortado como adhesivo, nombre en barras negras |
| Streetwear | Bold Monochrome | Blanco y negro puros, condensada gigante en contorno, banda de texto repetido |
| Streetwear | Hype Drop | Degradado eléctrico, amarillo de alerta, destellos, Bricolage Grotesque, precio inclinado |
| Hogar | Warm Decor | Arena y terracota, arcos, Fraunces, textura de papel, precio subrayado |
| Hogar | Nordic Living | Blanco piedra y salvia, ficha de catálogo, mucho aire, Manrope |
| Hogar | Soft Catalog | Fichas limpias sobre crema, datos ordenados (referencia, categoría, precio) |
| Belleza | Clean Beauty | Neutros verdosos, podio, tipografía limpia |
| Belleza | Glow Premium | Halo dorado-durazno, destellos, Playfair itálica, reflejo |
| Belleza | Skincare Offer | Lila y blanco, tarjeta con podio, sello de oferta, botón sólido |

Composiciones: **héroe** (producto grande e inclinado, palabra gigante detrás), **lookbook** (la foto manda), **collage** (fotos con cinta, recorte como adhesivo), **ficha de catálogo**, **podio** (halo y podio), y las cinco de la primera versión (escenario, dividido, diagonal, editorial, tarjeta).

### Fidelidad del producto

Los píxeles del producto no se retocan. El fondo solo se quita cuando es seguro (fondo liso, contorno nítido); si no, se usa la foto original completa, sin deformar (encajada, en marco tipo polaroid o como tarjeta). Girar la foto (polaroid, producto héroe) no altera el producto.

## 3. Videos

**10 plantillas**: Producto premium, Oferta relámpago, Presentación elegante, Promoción dinámica, Producto tecnológico, Moda y accesorios, Belleza y bienestar, Producto destacado, Descuento especial, Catálogo animado. Cada una define intro (logo, destello, negro, blanco, retícula), movimiento de cámara (acercar, alejar, paneo, empuje, giro, flotar), entradas de textos (fundido, subir, laterales, rebote, golpe, barrido, giro), transición (fundido, barrido, deslizar, zoom), efecto de precio (late o se tacha el anterior), cierre (logo, nombre, precio y botón) y música.

- Duraciones 8, 10, 12 y 15 s sugeridas; cualquiera entre 6 y 20 s. Formatos verticales (9:16, 4:5, 1:1) y horizontal 16:9.
- «Descuento especial» muestra el precio anterior, lo tacha y luego el nuevo, **solo si el descuento existe en el catálogo**.
- «Catálogo animado» recorre hasta 3 fotos reales del producto, o varios productos.
- **Música:** la compone el propio sistema en el navegador (Web Audio: batería, bajo, acordes y arpegio según el ánimo y el tempo de la plantilla). No usa pistas de terceros, así que no hay licencias musicales que gestionar. Se codifica en **AAC** con WebCodecs; si el navegador no codifica AAC, el video sale sin audio (el panel lo avisa antes).
- Exportación MP4 H.264 a 30 cps con WebCodecs. Sin WebCodecs: grabación con MediaRecorder (MP4 o WebM según el navegador, sin audio, en tiempo real).

## 4. Generación por lotes

Sección **«Generación por lotes»** en la misma página: hasta 100 productos × formatos × imagen o video; estilo automático por sector o uno fijo; objetivo; JPG, PNG o WebP.

- Una pieza a la vez. Las fotos de un producto se cargan una vez, reducidas a 1600 px, y se **liberan** al pasar al siguiente.
- Cada pieza pasa el control de calidad; si una composición falla, prueba la siguiente del estilo; si ninguna pasa, la pieza queda «omitida» con el motivo.
- Reintenta errores pasajeros (2 veces); no reintenta errores de datos. Se puede cancelar: lo generado sigue disponible.
- **ZIP propio** (sin dependencias, método «store» con CRC-32): una carpeta por producto (`REF-nombre/formato-tipo-estilo-composicion.jpg`) y `resumen.csv`. Se divide en partes si supera 1,5 GB.
- Progreso, tiempo restante estimado, memoria en uso, lista de errores e historial de lotes en ese equipo.
- Las piezas del lote **no** se guardan en «Tus piezas» (evita llenar el almacenamiento y el tope de 1.000 por tienda); se descargan en el ZIP.

## 5. Control de calidad

Bloquea el guardado ante: dimensiones distintas al formato, textos o logo fuera de la zona segura (historias: 5 % arriba, 6 % abajo), superposiciones entre textos, textos sobre el producto, contraste WCAG insuficiente, textos desbordados, precio cortado, datos que no coinciden con el catálogo (nombre, precio, precio anterior, etiqueta, logo), foto recortada más de un 20 %, producto que ocupa menos del 5 % de la pieza, y falta del botón. Avisa (sin bloquear): producto por debajo del mínimo del sector, nombre acortado, letra pequeña, «Promoción» sin descuento real. Las capas giradas se comprueban con la caja que realmente ocupan.

## 6. Resultados

### Pruebas automatizadas

| Suite | Resultado |
|---|---|
| Panel `tsc` | OK |
| Panel `vitest run` | **137 OK**, 1 omitida (ya lo estaba) |
| Servidor `tsc` | OK |
| Servidor `vitest run` | **465 OK**, 1 omitida (ya lo estaba) |
| Matriz de calidad | **9.450 combinaciones** (15 estilos × 10 composiciones × 7 formatos × 9 casos, con objetivos) sin errores |
| Video | 10 plantillas distintas entre sí, reparto del tiempo para 6–20 s, determinismo, datos exactos al final de la escena, tachado del descuento, catálogo con 3 fotos |
| ZIP | CRC-32 estándar; lectura independiente del archivo: íntegro, UTF-8, carpetas, sin pisar nombres |

### Con productos reales (catálogos públicos de Luz Mágica y Muy Parcero, solo lectura)

- **Galería** (fuera del repositorio, en `.tmp/motor-media/galeria/`): antes (composición actual de producción) frente a después, las 5 familias, cuadros de los 10 videos, transiciones corregidas y muestra al azar del lote de 100.
- **10 MP4 de ejemplo** en `.tmp/motor-media/` (uno por plantilla; 8 verticales 720 × 1280 y 2 horizontales 1280 × 720; 8 a 15 s). Verificados con **ffprobe** y decodificados completos con **ffmpeg** sin errores: H.264 High 30 cps + AAC-LC 48 kHz estéreo, `moov` al inicio (reproducción inmediata en redes). Render de 2 a 6 s por video en Chromium 156 (uno tardó 40 s con el panel en segundo plano).
- No hay comercios de belleza en producción: los estilos de belleza se probaron con una camiseta (Muy Parcero) y productos de hogar.

### Lotes

| Lote | Piezas | Listas | Errores | Omitidas | Tiempo | Por pieza | ZIP | Memoria JS pico → final |
|---|---|---|---|---|---|---|---|---|
| 10 productos × 2 formatos | 20 | 20 | 0 | 0 | 22 s | 1,1 s | 8 MB | 30 → 26 MB |
| 50 productos × 1 formato | 50 | 50 | 0 | 0 | 90 s | 1,8 s | 16 MB | 35 → 21 MB |
| 100 productos × 1 formato | 100 | 100 | 0 | 0 | 129 s | 1,3 s | 25 MB | 35 → 22 MB |
| 10 videos de 8 s con música | 10 | 10 | 0 | 0 | 20 s | 2,0 s | 41 MB | 57 → 25 MB |

Los ZIP pasaron `testzip` (CRC) en Python. La memoria vuelve al nivel inicial al terminar (sin fugas). El tiempo por imagen está dominado por la descarga de las fotos desde producción. La memoria medida es la de JavaScript; la de mapas de bits y GPU no la informa el navegador.

**De punta a punta** con la API y el panel locales de la rama (base aislada): lote de 4 productos × 2 formatos a través del plan verificado del servidor, 8/8 listas, ZIP de 2,8 MB; sección de video con sector sugerido, plantilla sugerida, duración, música y aviso de compatibilidad.

### Compatibilidad

| Navegador | Imágenes JPG/PNG/WebP | MP4 H.264 | Audio AAC | Estado |
|---|---|---|---|---|
| Chrome 157 (Windows, real, sin ventana) | Sí | Sí | Sí | **Probado** |
| Edge 157 (Windows, real, sin ventana) | Sí | Sí | Sí | **Probado** |
| Chromium 156 (panel de la app) | Sí | Sí | Sí | **Probado** (galería, lotes, videos) |
| Sin WebCodecs (simulado en Edge) | Sí | MP4 por MediaRecorder | No | **Probado**: respaldo funciona, sin audio |
| Firefox | — | — | — | **Pendiente**: no está instalado aquí. Si no codifica AAC, el motor exporta el video sin audio y el panel lo avisa |
| Safari (Mac, iPhone) | — | — | — | **Pendiente**: no hay equipo Apple disponible |
| Android, iPhone (celulares reales) | — | — | — | **Pendiente**: no hay dispositivos disponibles |

## 7. Problemas encontrados y corregidos en esta fase

- En las transiciones de video, cada capa ignoraba la opacidad de su escena: la escena entrante tapaba a la saliente desde el primer cuadro (cuadros vacíos a mitad del cambio).
- La transición «zoom» dejaba ver un recuadro negro (escena entrante reducida y transparente).
- La cámara agrandaba fotos enmarcadas fuera de su marco, encima del texto.
- El respaldo MediaRecorder se quedaba esperando con la pestaña oculta.
- En 4:5 y cuadrado, productos verticales quedaban diminutos en composiciones apiladas (ahora van lado a lado).
- Botones y sellos con colores de estilo sin contraste suficiente (se ajusta su luminosidad, mismo tono).
- Precios largos en la ficha de catálogo se recortaban (ahora nunca: se reduce la letra).

## 8. Riesgos y pendientes antes de producción

1. **Integración con producción:** la API productiva corre `c08c55d` (Telegram), no `main`. Integrar esta rama con esa línea y probar en staging antes de publicar. Orden: API → panel. Sin migración.
2. **Firefox, Safari y celulares sin probar.** En celulares de gama baja los videos 1080p pueden tardar mucho más; los lotes grandes deberían hacerse en computador.
3. **Recorte de fondo:** solo 3 de 139 fotos reales lo permiten sin IA (casi todas son fotos de ambiente). Los estilos están pensados para funcionar con la foto completa, pero el efecto «producto héroe aislado» depende de fotos de estudio.
4. **Lotes:** necesitan el panel abierto; con la pestaña oculta el navegador puede frenar el trabajo. No hay generación en segundo plano en el servidor (requeriría infraestructura nueva).
5. **ZIP en memoria:** pensado hasta ~1,5 GB por parte. Lotes de 100 videos de 15 s en 1080p pueden necesitar varias partes.
6. **Música generada:** es sencilla (sintetizada); para un sonido más elaborado se necesitarían pistas con licencia comercial verificada.
7. **Belleza y moda femenina** sin catálogos reales en producción para validarlas con sus propios productos.
8. Las piezas del lote no quedan en «Tus piezas»; si se quiere historial en el servidor hay que decidir retención y límites.

## 9. Archivos

Nuevos: `frontend/src/lib/creative/design/{color,fonts,photo,styles,compose,campaign,qa,video,audio}.ts`, `design.test.ts`, `video.test.ts`, `frontend/src/lib/creative/{batch,zip}.ts`, `zip.test.ts`, `frontend/src/admin/pages/creative/{DesignPanel,BatchPanel}.tsx`, `worker/src/creative/designOptions.ts`.

Modificados: `frontend/src/lib/creative/{scene,render}.ts`, `frontend/src/admin/pages/creative/Factory.tsx`, `frontend/src/services/api.ts`, `worker/src/creative/{pieces,templates}.ts`, `worker/src/routes/creative-pieces.test.ts`.
