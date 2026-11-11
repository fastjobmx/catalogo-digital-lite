# Estudio Creativo IA · Fase 3: fábrica de creativos y video comercial

Rama: `feat/estudio-creativo-fase3` (sale de `main` = producción, commit `e6a7d48`).
Estado: **nada desplegado y la migración 0022 no está aplicada en producción.** Cada paso de publicación necesita autorización expresa (ver «Despliegue»).

Fases anteriores: [ESTUDIO_CREATIVO_IA.md](ESTUDIO_CREATIVO_IA.md) (fase 1) y [ESTUDIO_FOTOGRAFICO_FASE2.md](ESTUDIO_FOTOGRAFICO_FASE2.md) (fase 2, en producción).

---

## 1. Qué hace

Página nueva en el panel: **Estudio Creativo IA → Creativos y video** (`/admin/estudio-creativo/creativos`). El comerciante crea imágenes, carruseles y videos cortos con los productos y las fotos que ya tiene en su tienda. No hay un editor de video genérico ni una segunda biblioteca de productos: cada pieza apunta a productos existentes.

Flujo de 8 pasos: producto → tipo de contenido → plantilla → formato → texto → calidad → costo → confirmación. Después puede revisar, editar el texto, aceptar, rechazar, descargar y asociar la pieza a una campaña.

### Formatos

| Formato | Tamaño | Video |
|---|---|---|
| Publicación cuadrada 1:1 | 1080 × 1080 | Sí |
| Publicación vertical 4:5 | 1080 × 1350 | Sí |
| Historia y Reel 9:16 | 1080 × 1920 | Sí |
| Banner horizontal 16:9 | 1920 × 1080 | Sí |
| Imagen para WhatsApp 4:3 | 1200 × 900 | No |
| Portada comercial | 1640 × 624 | No |

Carrusel: una imagen por producto (2 a 6). Colección: varios productos en una sola pieza.

### Plantillas y el dato real que exige cada una

Una plantilla solo se puede elegir cuando lo que afirma es cierto en el catálogo. El servidor lo comprueba; no se puede forzar.

| Plantilla | Dato exigido |
|---|---|
| Producto nuevo | El producto se creó hace 30 días o menos |
| Últimas unidades | Inventario real entre 1 y 5 unidades |
| Oferta aprobada | «Precio anterior» mayor que el precio actual en el catálogo |
| Producto destacado | Ninguno (no afirma nada) |
| Colección | 2 a 6 productos |
| Antes y después | Foto mejorada y aprobada en el estudio fotográfico (fase 2) |
| Novedades de temporada | Todos los productos creados hace 60 días o menos |
| Historia de marca | Brand Kit con nombre y eslogan |
| Invitación al catálogo | Dirección pública de la tienda configurada |

### Cifras exactas

El precio, el precio anterior, el porcentaje (`-20%`) y las etiquetas («NUEVO», «ÚLTIMAS UNIDADES») los calcula y los formatea **el servidor** con los datos del catálogo. El panel los dibuja como capas gráficas. Ninguna IA escribe cifras. El precio nunca se corta: si no cabe, se reduce la letra.

### Textos comerciales

- **Sin IA (siempre, sin costo):** titular, descripción, llamada a la acción y hashtags salen de la ficha del producto y del Brand Kit. Los beneficios quedan vacíos porque no hay de dónde sustentarlos.
- **Con IA (opcional, función de créditos `creativo_texto`):** la IA recibe solo la ficha (nombre, descripción, categoría, marca, tono). No recibe ni escribe precios. Su propuesta pasa por un filtro: cualquier campo con una cifra o una promesa que la ficha no respalde (descuento, envío gratis, garantía, «original», porcentajes, monedas…) se reemplaza por el texto base. Sin descripción en la ficha no se aceptan beneficios.
- **Versiones por canal** (corta, WhatsApp, Instagram y Facebook): se componen de forma determinista con esos campos, el precio real y la dirección de la tienda.
- El comerciante puede editar todos los textos; lo que él escriba es su responsabilidad.

---

## 2. Motor de video: dos modos

### Modo A · video automático (sin IA, sin costo)

Usa las fotos del producto y dibuja cuadro por cuadro: acercamiento lento sobre la foto, aparición escalonada de logo, etiqueta, nombre, precio y llamada a la acción, transición entre productos y, en «Antes y después», revelado de la foto mejorada sobre la original. Duraciones según la plantilla: 6, 10 o 15 segundos.

Es determinista: `frameAt(plan, t)` devuelve siempre el mismo cuadro para el mismo instante, así que textos y precios son idénticos en todo el video.

### Modo B · video generativo con IA (créditos por segundo)

Anima una foto real del producto con un modelo de video.

- **Modelo verificado:** `gemini-omni-1.2-flash`, por la *Interactions API* de Gemini (`POST /v1beta/interactions`). Confirmado con la lista de modelos de la clave de desarrollo y con dos generaciones reales (ver §5).
- **Veo:** los modelos `veo-3.1-*-preview` fueron apagados el 22-oct-2026 según la documentación; están bloqueados en `RETIRED_MODELS` junto con `gemini-omni-flash-preview`. `gemini-omni-1.1-flash` se redirige a 1.2 el 3-dic-2026.
- **Adaptadores:** `VideoProvider` (`worker/src/creative/videoEngine.ts`). Para cambiar de proveedor se implementa esa interfaz y se registra en `VIDEO_PROVIDERS`; el enrutador de IA elige por la tarea `video`. No hay modelo por defecto: se configura con la variable `GEMINI_VIDEO_MODEL` (o `CREATIVE_AI_MODELS`).
- **Opciones:** historia 9:16 o banner 16:9; 4, 6 u 8 segundos; 360p o 720p; tres movimientos (acercamiento, paneo suave, luz y ambiente).
- **Honestidad:** no se ofrecen giros ni cambios de ángulo, porque la IA inventaría lados del producto que la foto no muestra. Cada video de IA lleva la advertencia «es una interpretación, no una vista real del producto» en la pieza y en el panel. El video de IA no lleva nombre, precio ni textos.
- **Control de gasto:** el modo B **solo se ofrece cuando la plataforma fija un precio en créditos por segundo** (`video_ia_segundo`). Sin precio, no se genera nada.

---

## 3. Sistema de renderizado

**Decisión: el render convencional se hace en el navegador del comerciante.** Canvas 2D para las imágenes y WebCodecs (H.264) + `mp4-muxer` para el MP4. No se ejecuta FFmpeg ni Remotion dentro de Workers.

| Opción | Compatibilidad con Workers | Costo de plataforma | Estado |
|---|---|---|---|
| **Navegador (Canvas + WebCodecs)** | No usa Workers para renderizar | **US$ 0** por pieza | **Implementado y medido** |
| Respaldo: grabación del lienzo (MediaRecorder, WebM) | Igual | US$ 0 | Implementado (navegadores sin WebCodecs); tarda lo que dura el video |
| FFmpeg / Remotion dentro de un Worker | **No compatible**: no hay procesos nativos ni Chromium, y el límite de CPU y memoria no alcanza | — | Descartado |
| Contenedor con FFmpeg o Remotion (Cloudflare Containers u otro) | Compatible como servicio aparte, orquestado desde el Worker | Por segundo de cómputo; **no cotizado en esta fase** | No implementado |
| Servicio externo de render (Remotion Lambda, Shotstack…) | Compatible por API | Por video; **no cotizado en esta fase** | No implementado |

Por qué el navegador: cuesta cero, da texto exacto y no añade infraestructura. Lo que se pierde: hay que tener el panel abierto mientras se exporta, y no hay render masivo en segundo plano. Si más adelante se necesita producir muchos videos sin el panel abierto, el siguiente paso es un contenedor con FFmpeg; antes de contratarlo hay que cotizar precios vigentes.

**Orquestación, estados y resultados siguen en Cloudflare:** el Worker valida el plan, guarda los archivos en R2 privado (`creative-private/stores/<id>/pieces/`), lleva el estado en D1 (`creative_pieces`, `creative_jobs`) y controla créditos.

**Colas:** el proyecto no tiene Cloudflare Queues (es un recurso nuevo que requiere autorización). El video con IA usa la misma cola de trabajos de la fase 2: el panel ejecuta el trabajo y, si se cierra, el cron de 15 minutos lo retoma (un video por pasada). Los trabajos caídos se marcan fallidos y devuelven sus créditos.

---

## 4. Costos

Antes de generar, el panel muestra el costo separado en tres líneas:

| Tipo de trabajo | Función de créditos | Costo para la tienda |
|---|---|---|
| Composición convencional (imagen, carrusel, video automático) | — | **Sin costo** |
| Imagen generativa | `foto_packshot`, `foto_premium` (estudio fotográfico, fase 2) | El de la fase 2; la fábrica no genera imágenes con IA, usa fotos ya aprobadas |
| Video generativo | `video_ia_segundo` × segundos | Precio por segundo que fije la plataforma |
| Textos con IA (opcional) | `creativo_texto` | Precio por sugerencia; sin precio usa solo el límite mensual |

**Reutilización:** cada pieza guarda la huella de su configuración. Pedir lo mismo otra vez devuelve la pieza existente: no se duplica el archivo y, en video con IA, no se llama al modelo ni se cobran créditos. Un fallo del proveedor o una respuesta sin video tampoco cobra.

---

## 5. Resultados reales y costos medidos (2026-11-10)

Entorno: API y panel locales sobre una base aislada (`.tmp/fase3-local`, con las 22 migraciones aplicadas), 4 productos de demostración, Brand Kit con dos colores, tipografía Poppins y logo. Navegador integrado (Chromium). Capturas en [capturas-fabrica-creativos/](capturas-fabrica-creativos/); los MP4 quedaron en `.tmp/fase3-videos/` (fuera del repositorio).

### Modo convencional (sin IA)

| Pieza | Resultado | Tiempo total (exportar + subir) | Costo |
|---|---|---|---|
| Imagen · Oferta aprobada · vertical | JPG 1080 × 1350, 307 KB, `-20%` y precio anterior tachado | 1,6 s | US$ 0 |
| Carrusel · Colección · cuadrado | 3 JPG 1080 × 1080 | 3,6 s | US$ 0 |
| Video · Producto nuevo · historia, 10 s, estándar | MP4 H.264 High, 720 × 1280, 30 fps, 300 cuadros, 5,1 MB | 16 s | US$ 0 |
| Video · Novedades de temporada · banner, 10 s, alta | MP4 H.264 High, 1920 × 1080, 30 fps, 300 cuadros, 10,2 MB | ≈ 35 s | US$ 0 |
| Imagen · Últimas unidades · WhatsApp | PNG 1200 × 900 | < 10 s | US$ 0 |
| Imagen · Historia de marca · portada | PNG 1640 × 624 | < 10 s | US$ 0 |
| Imagen · Invitación al catálogo · historia | PNG 1080 × 1920, 4 productos y dirección de la tienda | < 10 s | US$ 0 |

Los tiempos de las tres últimas no se midieron por separado (se generaron en lote).

### Modo B · video con IA (`gemini-omni-1.2-flash`)

| Prueba | Resultado | Tiempo | Costo estimado del proveedor |
|---|---|---|---|
| Historia 9:16, 4 s, 360p, acercamiento | MP4 H.264 360 × 640, 24 fps, con audio ambiente, 1,7 MB | 15,6 s | **US$ 0,095** |
| Banner 16:9, 4 s, 720p, luz y ambiente | MP4 H.264 1280 × 720, 24 fps, 2,0 MB | 23,0 s | **US$ 0,280** |

Costo total de la prueba: ≈ US$ 0,37, con la clave local de desarrollo. El costo es una estimación con la tarifa de la documentación (US$ 12 por millón de tokens de salida; 1.931 tokens/s a 360p y 5.792 tokens/s a 720p); no se contrastó con la factura. Proyección con esa tarifa: 6 s a 720p ≈ US$ 0,42; 8 s a 720p ≈ US$ 0,56.

Lo observado: en ambos videos el producto conserva forma, color y ángulo. En el primero la foto era cuadrada y el modelo la encuadró a 9:16 recortando los lados del producto. El tejido lateral del tenis cambia levemente respecto a la foto. Son dos muestras con fotos de demostración limpias; no alcanza para afirmar fidelidad general.

---

## 6. Pruebas

| Comando | Resultado |
|---|---|
| `worker`: `npx tsc --noEmit` | OK |
| `worker`: `npx vitest run` | **44 archivos, 457 pruebas OK**, 1 omitida (prueba manual con IA real de la fase 2) |
| `worker`: `wrangler deploy --dry-run` (config de producción) | OK |
| `frontend`: `npx tsc --noEmit` | OK |
| `frontend`: `npx vitest run` | **23 archivos, 102 OK**, 1 omitida (ya lo estaba) |
| `frontend`: `npm run build:cloudflare` | OK (página nueva: 70 KB, 23 KB comprimida) |
| `wrangler d1 migrations apply --local` (base aislada) | Migraciones 0001 a 0022 aplicadas sin errores |

Pruebas nuevas del servidor (`worker/src/routes/creative-pieces.test.ts`, 12, con la IA simulada): plantillas según datos reales, plan con precio/etiqueta/porcentaje, validaciones, permisos y aislamiento entre tiendas, filtro de afirmaciones, resolución exacta, archivos falsos, almacenamiento privado, idempotencia, reutilización, aprobar/descargar/rechazar, campañas (incluida una ajena), edición de texto, carrusel, video (tipo real y duración), textos con IA (cobro, filtro, fallo sin cobro) y video con IA (no disponible sin precio, cotización, confirmación, saldo, petición exacta al proveedor, cobro único, reutilización, fallos sin cobro, cron). Se actualizaron 2 pruebas de la fase 1 (enrutador y estado de módulos).

Pruebas nuevas del panel (`frontend/src/lib/creative/scene.test.ts`, 10): textos y cifras exactos en los 6 formatos, capas dentro del lienzo, colores con contraste, colección y carrusel, antes/después, tamaño y número de cuadros del video, determinismo, orden de aparición, transiciones y ajuste de texto.

**No probado:** el flujo completo en un celular; Safari y Firefox (el respaldo WebM existe pero no se ejecutó); «Antes y después» con fotos reales del estudio (solo pruebas automáticas); la sugerencia de textos con el modelo real (solo simulada); el botón de video con IA desde el panel (la generación real se lanzó por la API local; el panel mostró la pieza resultante); fotos reales de comerciantes.

---

## 7. Lo implementado

### Rutas nuevas (`/api/creative`, mismas reglas: sesión + `marketing.manage`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/creatives/catalog` | Formatos, plantillas, calidades, estado del video con IA y campañas |
| POST | `/creatives/eligibility` | Qué plantillas aplican a los productos elegidos y por qué no las demás |
| POST | `/creatives/plan` | Plan de composición con datos verificados, textos y costo; avisa si ya existe una pieza igual |
| POST | `/creatives/copy` | Sugerencia de textos con IA, filtrada |
| GET · POST | `/creatives` | Lista piezas · guarda una pieza compuesta en el navegador |
| GET | `/creatives/:id` · `/creatives/:id/files/:n` | Pieza · archivo privado (vista o descarga) |
| POST | `/creatives/:id/approve` · `/reject` · `/campaign` | Aceptar · rechazar (borra el archivo) · asociar a una campaña |
| POST | `/creatives/video-ai/quote` · `/creatives/video-ai` | Cotiza · crea el trabajo de video con IA |

`POST /jobs/:id/run` ahora ejecuta trabajos de foto o de video según su tipo.

### Datos

Migración `database/migrations/0022_creative_pieces.sql` (solo agrega la tabla `creative_pieces`) · rollback `database/rollback/0022_creative_pieces.down.sql`. La asociación a campañas usa la tabla `campaigns` existente (columna `campaign_id` en la pieza).

### Archivos

Nuevos:
- `worker/src/creative/templates.ts` (formatos, plantillas, datos verificados, textos y filtro), `pieces.ts` (piezas), `videoEngine.ts` (video con IA y adaptadores)
- `worker/src/routes/creative-pieces.test.ts`
- `frontend/src/lib/creative/scene.ts` (composición y línea de tiempo, funciones puras), `render.ts` (pintado y exportación), `scene.test.ts`
- `frontend/src/admin/pages/creative/Factory.tsx`
- `docs/FABRICA_CREATIVOS_FASE3.md`, `docs/capturas-fabrica-creativos/`

Modificados:
- `worker/src/routes/creative.ts`, `creative/aiRouter.ts` (entrada de video y render), `creative/modules.ts`, `ai/credits.ts` (funciones `creativo_texto` y `video_ia_segundo`; `runWithCredits` acepta `units`), `index.ts` (variables y cron)
- `frontend/src/App.tsx`, `admin/AdminLayout.tsx`, `admin/pages/creative/CreativeHome.tsx`, `services/api.ts`, `package.json` (dependencia `mp4-muxer`)

---

## 8. Despliegue (pendiente de autorización)

Orden, cada paso con autorización expresa:
1. Respaldo y migración 0022 en producción.
2. API (`catalogo-lite-api`).
3. Panel (`npm run deploy:cloudflare` en `frontend/`).

Con eso queda disponible todo el modo convencional. **El video con IA queda apagado** hasta que el operador decida:
- Agregar `GEMINI_VIDEO_MODEL = "gemini-omni-1.2-flash"` a `wrangler.production.toml` (no se agregó).
- Fijar el precio de `video_ia_segundo` en Plataforma → Créditos. Referencia: a 720p cada segundo le cuesta a la plataforma unos US$ 0,07.
- Fijar (o no) el precio de `creativo_texto`. Sin precio, las sugerencias no descuentan créditos y solo las frena el límite mensual de IA.

## 9. Pendientes y riesgos

- **Piezas privadas:** se descargan desde el panel; no tienen dirección pública para compartir por enlace.
- **Campañas:** la pieza se asocia a una campaña existente, pero las campañas no muestran todavía sus piezas ni las envían.
- **Video con IA y fotos cuadradas:** el modelo recorta la foto al formato pedido. Conviene avisar o preparar la foto en el formato del video.
- **Idioma del modelo de video:** la documentación indica soporte completo solo en inglés; la instrucción fija va en inglés y el comerciante no escribe el prompt.
- **Marca de agua:** según la documentación, todos los videos del modelo llevan marca SynthID (invisible).
- **Presupuesto mensual de IA:** un video con IA consume una parte grande del presupuesto por tienda (US$ 2 por defecto); puede bloquear otras funciones de IA ese mes.
- **Retención:** las piezas no se borran solas; tope de 1.000 por tienda. Falta política de retención.
- **Equipos lentos:** exportar un video 1080p depende del equipo del comerciante; en un celular de gama baja puede tardar bastante más que lo medido.
- **Texto superpuesto en video con IA:** combinar un clip de IA como fondo con las capas exactas del modo A no está implementado.
