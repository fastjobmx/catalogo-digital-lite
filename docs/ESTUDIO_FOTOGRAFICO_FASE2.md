# Estudio Creativo IA · Fase 2: estudio fotográfico y producción por lotes

Continúa la arquitectura de [ESTUDIO_CREATIVO_IA.md](ESTUDIO_CREATIVO_IA.md) (fase 1). Misma rama: `feat/estudio-creativo-fase1`.
Estado: **nada desplegado y ninguna migración aplicada en producción.** Cada paso de publicación necesita autorización expresa (ver «Despliegue»).

No se tocó MOSTRALO PUES! ni se cambió ningún identificador técnico. El «Estudio IA» anterior (`/admin/estudio`) sigue igual.

---

## 1. Qué puede hacer el comerciante

Pantalla nueva **Estudio fotográfico** (`/admin/estudio-creativo/fotos`), en cinco pasos:

1. **Elegir fotos:** productos del catálogo (se toma la foto que ya tienen, sin volver a subirla), fotos de su biblioteca o fotos nuevas. Hasta 50 por lote.
2. **Analizar calidad (opcional, gratis):** resolución, luz, contraste y nitidez, medidos en el navegador. Sugiere primero la mejora que no cuesta. Si la foto está borrosa o es muy pequeña, lo dice: ninguna mejora recupera detalle que no existe.
3. **Elegir la mejora** entre tres niveles (ver abajo).
4. **Confirmar el costo y procesar:** ve cuántos créditos cuesta y su saldo antes de empezar; barra de progreso; puede cancelar lo que falta.
5. **Revisar y aprobar una por una:** comparación antes/después con divisor; cada resultado se puede poner como foto principal, como foto adicional, guardar solo en la biblioteca o descartar.

Pantalla nueva **Biblioteca de recursos** (`/admin/estudio-creativo/biblioteca`): resultados por revisar, aprobados y originales, con producto, fecha, tipo de procesamiento, modelo, costo, estado, formato y resolución. Una foto aprobada se puede agregar a cualquier producto o usar para crear un producto nuevo.

### Niveles de procesamiento

| Nivel | Operaciones disponibles | Cómo se hace | Costo |
|---|---|---|---|
| **A · Edición convencional** | Recorte cuadrado, encuadre sobre blanco, redimensionar, comprimir (WebP), convertir a JPG, ajuste básico de luz | En el navegador del comerciante (canvas). Sin IA | Gratis |
| **B · Packshot inteligente** | Fondo blanco, iluminación de estudio, fondo neutro con sombra natural, quitar objetos ajenos, corregir perspectiva | Modelo de imagen de Gemini | Créditos `foto_packshot` |
| **C · Composición premium** | Fondo publicitario, escenario comercial, presentación en local, luz editorial, escena según la categoría | Modelo de imagen de Gemini | Créditos `foto_premium` |

No se ofrecen todavía (aparecen como «próximamente», con el motivo):
- **Fondo transparente:** el modelo configurado no entrega transparencia real.
- **Modelo virtual o maniquí:** vestir un producto en una persona generada puede alterar su forma, talla y caída.

El sistema usa la alternativa más sencilla: el análisis sugiere primero el nivel A, y el enrutador elige el modelo por costo para B y por calidad para C (hoy ambos resuelven al mismo modelo porque solo hay uno configurado).

### Fidelidad

- El comerciante nunca escribe el prompt: elige una operación y la plataforma envía una instrucción fija con reglas de fidelidad (forma, colores, texturas, costuras, estampados, etiquetas, textos y logotipos intocables; no reubicar el producto; no completar partes cortadas; la luz no cambia el color).
- El original nunca se modifica ni se reemplaza. Aprobar agrega una foto; las anteriores del producto se conservan.
- La pantalla no promete exactitud: avisa que la IA puede equivocarse y pide comparar antes de aprobar.

### Creación de productos desde una foto

Se reutiliza la función existente «Desde fotos» (`photoToProduct`): sugiere nombre, categoría, descripción y atributos visibles, y deja un borrador editable. No propone precio, cantidad, tallas ni SKU, y una marca visible se muestra para que el comerciante la confirme. Lo nuevo: desde una foto aprobada de la biblioteca, «Crear un producto con esta foto» abre ese flujo con la foto ya cargada (`/admin/fotos?foto=…`). No se creó un segundo generador de productos.

### Telegram

No hay un importador nuevo. En la revisión de un lote de Telegram (Importar → lote) hay un botón **«Mejorar fotos (opcional)»** que abre el estudio fotográfico con las fotos de ese lote. Se mantiene la regla: una foto del lote es un producto. Al aprobar un resultado:
- si el borrador aún no se publicó, la foto mejorada pasa a ser la foto del borrador y el importador existente la publica como siempre;
- si ya es producto, se agrega al producto.
La foto original de Telegram queda guardada en la biblioteca.

### Prueba sin registro (mini tienda)

La mini tienda puede ofrecer «Mejorar foto con IA: fondo blanco» en cada producto, con la foto original siempre recuperable («Volver a la original»). **Está apagada por defecto** porque cada mejora la paga la plataforma. El superadministrador la activa en Plataforma → Pruebas con dos ajustes nuevos:
- **Mejoras por prueba** (`photoEnhancePerTrial`, 0 a 20; 0 = no se ofrece).
- **Mejoras por día en toda la plataforma** (`photoEnhanceDailyLimit`, por defecto 50).

Además hay un límite de 10 intentos por red y hora. Si la IA falla, no se descuenta la mejora. Se respeta el máximo de productos y la duración ya configurados de la prueba (no se cambiaron).

---

## 2. Arquitectura

```
Panel                                   API /api/creative (owner/admin · marketing.manage)
/admin/estudio-creativo/fotos      ──►  /photo/catalog · /photo/quote · /photo/batches · /jobs/:id/run|retry
/admin/estudio-creativo/biblioteca ──►  /assets · /assets/:id/file|edits|approve|discard
lib/photoEdit.ts (nivel A, canvas)           │
                                             ├─ creative/photoEngine.ts  operaciones, cotización, lotes, ejecución
                                             ├─ creative/library.ts      biblioteca (R2 privado + D1)
                                             ├─ creative/jobs.ts         cola, límites, reintentos
                                             ├─ creative/imageInfo.ts    tipo real, dimensiones, huella
                                             └─ reutiliza: ai/credits.ts · ai/usage.ts · ai/imageStudio.ts · aiRouter.ts
Cron */15  ──►  maintainCreativeJobs → processPendingPhotoJobs (avanza la cola aunque el panel esté cerrado)
```

**Procesamiento en segundo plano.** No hay Cloudflare Queues. Mientras el panel está abierto, este pide al servidor que ejecute los trabajos pendientes (dos a la vez por tienda). Si se cierra, el cron existente (cada 15 minutos) procesa hasta 4 trabajos pendientes por pasada. Es decir: el lote termina solo, pero más despacio. Para lotes grandes con el panel cerrado conviene Queues (requiere autorización).

**Créditos por lote.** Al confirmar se valida que el saldo cubra el lote completo, pero no se bloquean todos los créditos: cada foto reserva los suyos al ejecutarse y se cobran solo si sale bien (`runWithCredits`). Si el saldo se acaba a mitad del lote, las fotos restantes fallan sin costo y las demás quedan bien.

### Rutas nuevas (`/api/creative`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/photo/catalog` | Niveles, operaciones, disponibilidad, precio por foto y saldo |
| POST | `/photo/quote` | Costo de aplicar una operación a N fotos |
| POST | `/photo/batches` | Crea el lote (requiere `Idempotency-Key` y `confirmCredits` igual al costo cotizado). Informa las fotos omitidas |
| GET | `/photo/batches/:id` | Progreso: conteos, créditos cobrados y estado de cada foto |
| POST | `/photo/batches/:id/cancel` | Cancela los trabajos pendientes del lote |
| POST | `/jobs/:id/run` | Ejecuta un trabajo pendiente (429 si la tienda ya procesa dos) |
| POST | `/jobs/:id/retry` | Reintenta un trabajo fallido (máximo 3 intentos) |
| GET / POST | `/assets` | Lista la biblioteca / sube un original |
| POST | `/assets/import-product` · `/assets/import-telegram` | Toma una foto del catálogo o de un lote de Telegram |
| GET | `/assets/:id` · `/assets/:id/file` | Datos y archivo privado (solo la tienda dueña, con sesión) |
| POST | `/assets/:id/edits` | Guarda el resultado de una edición convencional hecha en el navegador |
| POST | `/assets/:id/approve` · `/assets/:id/discard` | Aprueba (y opcionalmente asocia) o descarta un resultado |

Prueba sin registro: `POST /api/trial/:id/photos/enhance`.

### Modelo de datos

Migración `database/migrations/0021_photo_studio.sql` (solo agrega) · rollback `database/rollback/0021_photo_studio.down.sql`.

| Cambio | Detalle |
|---|---|
| Tabla nueva `creative_assets` | Original o resultado, estado, producto, clave privada en R2, URL pública (solo aprobados), tipo, peso, ancho, alto, huella SHA-256, nivel, operación, modelo, créditos, costo estimado en micro-USD, original de origen, trabajo y procedencia. Índice único por tienda y huella para originales |
| Columna `creative_jobs.batch_id` | Agrupa los trabajos de un lote |
| Columna `trial_sessions.photo_enhance_count` | Mejoras usadas por cada mini tienda |

Se reutilizan sin duplicar: `creative_jobs`, `ai_credit_ledger`, `ai_credit_costs` (dos funciones nuevas: `foto_packshot` y `foto_premium`; su precio lo fija el superadministrador), `ai_usage_events`, `products`, `telegram_product_batch_items`, `platform_settings`, `platform_events`, `audit_log`.

Cambios respecto a la fase 1: la cola admite hasta 100 trabajos por tienda (antes 3) y 300 por hora (antes 30) para permitir lotes; la concurrencia real se limita a 2 ejecuciones simultáneas por tienda.

### Almacenamiento (R2)

| Prefijo | Contenido | Acceso |
|---|---|---|
| `creative-private/stores/<id>/originals/` | Originales | Privado: solo `/api/creative/assets/:id/file` con sesión de la tienda |
| `creative-private/stores/<id>/results/` | Resultados sin aprobar | Privado. Al descartar se borra |
| `stores/<id>/products/estudio-<uuid>.<ext>` | Copia de un resultado aprobado | Público, como cualquier foto de producto |

---

## 3. Seguridad

- **Aislamiento:** todas las consultas filtran por la tienda resuelta en el backend. Recursos, lotes y trabajos de otra tienda responden 404. Probado en ambos sentidos.
- **Permisos:** solo propietario y administrador (`marketing.manage`). Vendedor recibe 403; sin sesión, 401.
- **Archivos:** el tipo se verifica por los bytes, no por el nombre (un SVG disfrazado se rechaza). Máximo 5 MB. Un archivo repetido no se guarda dos veces.
- **Fotos de productos:** solo se toman fotos que pertenecen al producto y están en el almacenamiento de la tienda. Las fotos externas no se descargan (se pide subirlas).
- **Instrucciones:** el texto que recibe el modelo es fijo. Lo que escriba el cliente en la solicitud se ignora (probado).
- **Costos:** confirmación explícita del costo, idempotencia por lote y por trabajo, cobro solo de lo que sale bien, tope de cola, de concurrencia y de intentos.
- **Auditoría:** creación y cancelación de lotes, aprobaciones, asociaciones y descartes quedan en `audit_log`.
- **Prueba sin registro:** apagada por defecto, tope por prueba, tope diario y límite por red.

---

## 4. Pruebas

### Automáticas (2026-11-10)

| Comando | Resultado |
|---|---|
| `worker`: `npx tsc --noEmit` | OK |
| `worker`: `npx vitest run` | **43 archivos, 445 pruebas OK**, 1 omitida (la prueba manual con IA real) |
| `frontend`: `npx tsc --noEmit` | OK |
| `frontend`: `npx vitest run` | **22 archivos, 92 OK**, 1 omitida (ya lo estaba) |
| `frontend`: `npm run build` | OK |
| `wrangler d1 migrations apply --local` (base local aislada) | Migraciones 0001 a 0021 aplicadas sin errores |

Pruebas nuevas del backend (`worker/src/routes/creative-photo.test.ts`, 13, con el modelo simulado): permisos, aislamiento, archivos repetidos, archivos falsos, cotización, confirmación, saldo insuficiente, fallo parcial del lote, reintento, cobro único, cancelación, créditos que se acaban a mitad del lote, IA apagada, respuesta sin imagen, concurrencia, cron, instrucción fija, recuperación del original, Telegram y prueba sin registro. Pruebas nuevas del panel (`frontend/src/lib/photoEdit.test.ts`, 4): geometría, formatos, ajuste de luz y análisis de calidad.

### En el navegador (entorno local aislado)

Con el API y el panel locales sobre una base temporal: se eligieron dos productos, se analizó la calidad, se aplicó «Encuadre sobre blanco» (nivel A), se aprobó un resultado como foto principal, se procesó un lote de dos fotos con «Fondo blanco» (IA real) y se revisó la biblioteca. Todo funcionó. No se revisaron en el navegador: el flujo de Telegram, la mini tienda con la mejora activada ni la vista en teléfono.

### Con el modelo real y fotos (costos medidos)

Prueba manual `worker/src/testing/photo-real.test.ts` (`RUN_REAL_AI=1`), con el Worker real sobre una base en memoria y la clave local de desarrollo. Modelo: `gemini-3.1-flash-image`. Las comparaciones están en [capturas-estudio-fotografico/](capturas-estudio-fotografico/) y los datos en `informe.json` e `informe-01-05-06-10.json`.

**14 ejecuciones, 14 correctas** (10 casos y 4 repeticiones tras reforzar las reglas):

| Medida | Valor |
|---|---|
| Tiempo por foto | 7,3 a 10,3 s (promedio 8,4 s) |
| Tokens de entrada | 470 a 566 |
| Tokens de salida | 1.313 a 1.437 (promedio 1.370) |
| **Costo estimado por foto** | **≈ US$ 0,082** (a US$ 60 por millón de tokens de salida y US$ 0,30 de entrada, los precios configurados en producción) |
| Costo total de la prueba | ≈ US$ 1,15 (más ≈ US$ 0,16 de las dos fotos de la prueba en el navegador) |
| Resolución de salida | Lado mayor entre 1.024 y 1.264 px (igual para B y C) |
| Créditos cobrados | Coinciden exactamente con las fotos correctas |

El costo es una estimación con los precios configurados, no una factura de Google: conviene contrastarlo con la consola de facturación. Los niveles B y C cuestan lo mismo al proveedor; la diferencia de precio en créditos es una decisión comercial.

| Caso | Operación | Resultado observado |
|---|---|---|
| 01 Fondo complejo (varios objetos) | Fondo blanco | Bien. En la primera versión la IA giró y reubicó los tenis; con las reglas reforzadas conserva la posición |
| 02 Mala iluminación (foto oscura) | Fondo blanco | Bien: producto fiel, bien iluminado |
| 03 Texto en empaque y manos | Quitar objetos | Quita las manos y conserva el texto «THANK YOU» y el dibujo. Para rellenar, **inventó** un montón de galletas y una estantería al fondo |
| 04 Colores similares (gris sobre gris oscuro) | Fondo blanco | Bien: recorte limpio, cordones y textura intactos |
| 05 Estampados (rayas) | Fondo blanco | Primera versión: quitó las piernas pero **completó** partes de las medias que no se veían. Con las reglas reforzadas conserva las rayas y el encuadre, pero deja las piernas |
| 06 Reflejos (metal) | Fondo neutro | Reflejos bien, pero **completó** el borde del plato que la foto cortaba y lo redujo. No se corrigió con las reglas |
| 07 Variantes (tres colores) | Fondo blanco | Bien: los tres colores fieles; quita los soportes |
| 08 Subexpuesta | Iluminación de estudio | Bien: recupera luz sin cambiar el producto |
| 09 Escenario comercial (nivel C) | Escenario | Bien: producto fiel sobre mesa, tono algo más cálido |
| 10 Luz editorial (nivel C) | Editorial | La botella blanca se ve crema por la luz cálida; con las reglas reforzadas mejora pero no del todo |
| Archivo repetido | Subida | Detectado: no se duplica |

**Limitaciones reales que se deben conocer:**
- Si la foto corta el producto, la IA tiende a completar lo que falta (inventa). Conviene partir de fotos con el producto entero.
- «Quitar objetos» rellena el hueco con contenido inventado.
- La luz de las escenas premium puede teñir productos blancos o claros.
- La salida es de unos 1.024 a 1.264 px: suficiente para catálogo y redes, no para impresión.
- Las fotos de prueba son las imágenes de demostración del repositorio (limpias, varias generadas por IA), no fotos reales tomadas por comerciantes con celular. Falta probar con fotos reales de clientes, y casos como etiquetas con letra pequeña.

Por eso la revisión individual con antes/después es obligatoria y nada llega al catálogo sin aprobación.

---

## 5. Archivos

Nuevos:
- `database/migrations/0021_photo_studio.sql`, `database/rollback/0021_photo_studio.down.sql`
- `worker/src/creative/photoEngine.ts`, `library.ts`, `imageInfo.ts`
- `worker/src/routes/creative-photo.test.ts`, `worker/src/testing/photo-real.test.ts`
- `frontend/src/admin/pages/creative/PhotoStudio.tsx`, `Library.tsx`, `ResultReview.tsx`, `AssetImage.tsx`
- `frontend/src/lib/photoEdit.ts`, `photoEdit.test.ts`
- `docs/ESTUDIO_FOTOGRAFICO_FASE2.md`, `docs/capturas-estudio-fotografico/`

Modificados:
- `worker/src/routes/creative.ts` (rutas), `worker/src/index.ts` (cron), `worker/src/creative/jobs.ts` (lotes, ejecución, reintentos, límites), `contracts.ts`, `modules.ts`
- `worker/src/ai/imageStudio.ts` (el editor acepta instrucción, modelo y reglas; el Estudio IA anterior se comporta igual), `worker/src/ai/credits.ts` (dos funciones con precio)
- `worker/src/services/trials.ts`, `trialSettings.ts`, `worker/src/routes/trial.ts` (mejora en la prueba sin registro)
- `frontend/src/App.tsx`, `admin/AdminLayout.tsx` (+ prueba), `services/api.ts`, `admin/creditLabels.ts`, `admin/pages/creative/CreativeHome.tsx`
- `frontend/src/admin/pages/Import.tsx` (botón en el lote de Telegram), `admin/pages/PhotoProducts.tsx` (acepta una foto aprobada), `pages/TrialPage.tsx`, `admin/PlatformTrialsPage.tsx`

---

## 6. Despliegue (pendiente de autorización)

Orden, cada paso con autorización expresa:
1. Migraciones 0020 y 0021 en producción (`wrangler d1 migrations apply catalogo-lite-production-db --remote --config wrangler.production.toml`, desde `worker/`).
2. API (`catalogo-lite-api`).
3. Panel (`npm run deploy:cloudflare` en `frontend/`).

Después del despliegue, decisiones del operador:
- **Precio en créditos** de `foto_packshot` y `foto_premium` (Plataforma → Créditos). Mientras no se fijen, las mejoras con IA no descuentan créditos y solo las frena el límite mensual de IA de cada tienda. **Conviene fijarlos antes de anunciar la función**: cada foto cuesta a la plataforma unos US$ 0,08.
- Si se activa o no la mejora de fotos en la prueba sin registro, y con qué topes.

## 7. Pendientes y riesgos

- **Piezas comerciales con las mismas imágenes:** la biblioteca ya permite reutilizar las fotos aprobadas, pero el motor de creativos publicitarios es de una fase posterior.
- **Campañas:** las fotos aprobadas aún no se pueden adjuntar a campañas (no existe todavía la campaña creativa).
- **Segundo plano real:** con el panel cerrado el lote avanza 4 fotos cada 15 minutos. Para producción masiva conviene Cloudflare Queues.
- **Retención de la biblioteca:** los originales no se borran solos y no hay botón para eliminarlos; el tope es de 2.000 recursos por tienda. Falta definir política de retención y borrado.
- **Fotos alojadas fuera de la tienda** (URL externas) no se pueden mejorar sin subirlas.
- **Fondo transparente y modelos virtuales:** no disponibles; requieren otro modelo o proveedor y pruebas de fidelidad.
- **Un solo modelo de imagen:** B y C usan el mismo. Para una diferencia real de calidad en C habría que evaluar `gemini-3-pro-image` (costo y resultado) y añadirlo al enrutador.
