# Informe de publicación · Fábrica de publicidad

Fecha: 2026-11-12 (22:05 UTC). Autorizado por el usuario («pon todo a producción»).
Rama publicada: `integracion/motor-publicitario` @ `4bf559a` = lo que ya corría en producción (`c08c55d`, línea de Telegram IA) + la fábrica de publicidad (`feat/motor-publicitario` @ `87cdc86`). Detalle técnico: [MOTOR_PUBLICITARIO.md](MOTOR_PUBLICITARIO.md).

**Alcance:** solo la fábrica de publicidad. No se publicó la rama de WhatsApp (`feat/whatsapp-admin-bot`): es trabajo de otra sesión y su propio informe la declara no apta para producción. Telegram queda con el mismo código que tenía.

---

## 1. Qué se publicó

| Pieza | Antes (retorno) | Ahora |
|---|---|---|
| API `catalogo-lite-api` | `56b1450b-ebfc-4337-86e5-e1f3cb0897dd` | **`3c53c1d8-5be7-4cb4-85f9-74479869f698`** |
| Panel `catalogo-digital-ia` | `83900c68-b040-4af0-8263-b6768101a99e` | **`6f503c33-baea-4fb3-9e17-010ada09033d`** (`index-CkvTMeyS.js`, `Factory-Dj9gOK0D.js`) |
| Base D1 `catalogo-lite-production-db` | — | Sin cambios: no requería migración («No migrations to apply») |

Antes de publicar: versiones de producción iguales a las revisadas; mismas 27 variables y secretos antes y después; `AI_MESSAGE_QUOTA_MODE = "shadow"` se conserva (antes solo se pasaba a mano con `--var`; ahora está en `wrangler.production.toml`).

### Comprobaciones en vivo (sin sesión)

- `GET /api/health` → 200, `environment: production`.
- `/api/creative/creatives/catalog`, `/api/creative/creatives`, `/api/admin/ai-usage` sin sesión → 401 (protegidas).
- Catálogo público de Luz Mágica → 115 productos.
- Webhook de Telegram sin secreto → 403 (sigue protegido).
- `/`, `/t/luz-magica`, `/t/muy-parcero`, `/t/luz-magica/admin/estudio-creativo/creativos` y el módulo nuevo `Factory-Dj9gOK0D.js` → 200.
- En el navegador: la tienda carga sin errores en la consola; el estudio redirige al inicio de sesión, como debe.

## 2. Pruebas que NO se hicieron

| Prueba | Por qué no | Riesgo |
|---|---|---|
| **Staging** | El Worker de staging lo estaba usando la sesión de WhatsApp/WAHA (despliegues de las 21:36 y 21:42 UTC). Desplegar ahí habría cortado sus pruebas. | Medio: lo integrado solo se probó en local (base aislada con las 23 migraciones) |
| **Flujo con sesión en producción** (crear una pieza, un video y un lote con una tienda real) | No hay credenciales de producción a disposición del asistente, ni deben usarse | Medio: primera pieza real la hará un comercio |
| **Firefox** | No está instalado en el equipo | Si no codifica AAC, los videos saldrán sin audio (el panel lo avisa) |
| **Safari (Mac) e iPhone** | No hay equipo Apple | Desconocido: WebCodecs y AAC pueden faltar; hay respaldo MediaRecorder |
| **Celulares Android reales** | No hay dispositivo | Videos 1080p y lotes pueden ser lentos o agotar memoria en gama baja |
| **Lotes con fotos privadas** (biblioteca del estudio fotográfico) y lotes de más de 100 piezas o de videos 1080p | Solo se probaron fotos públicas del catálogo, hasta 100 imágenes y 10 videos 720p | ZIP grande en memoria; se divide a 1,5 GB |
| **Bot de Telegram después de publicar** | Su código no cambió (es `c08c55d`); solo pasaron sus 559 pruebas automáticas junto con las nuevas | Bajo |
| **Catálogos reales de belleza y moda femenina** | No hay tiendas de esos sectores en producción | Estilos validados con productos de otros sectores |
| **Accesibilidad del paso «Diseño» y del lote** (lector de pantalla, teclado) | No se auditó | Bajo-medio |

## 3. Qué vigilar los primeros días

1. Errores de la API: `npx wrangler tail catalogo-lite-api --format pretty` (desde `worker/`), filtrando `/api/creative`.
2. Que las piezas nuevas lleguen con `spec.version = 2` y archivos del tamaño correcto (`creative_pieces`).
3. Que la cuota de mensajes de Telegram siga en modo `shadow` (`/api/admin/ai-usage` con sesión).
4. Comentarios de los comercios: lentitud al exportar video en celular, piezas omitidas por control de calidad, estilos que no encajan con su marca.

## 4. Cómo volver atrás

Es seguro y no toca datos (no hubo migración; las piezas nuevas quedan guardadas y la versión anterior las sigue listando y descargando).

```bash
cd worker
npx wrangler rollback 83900c68-b040-4af0-8263-b6768101a99e --name catalogo-digital-ia
npx wrangler rollback 56b1450b-ebfc-4337-86e5-e1f3cb0897dd --name catalogo-lite-api
```

Orden: panel primero (el panel nuevo envía opciones de diseño que la API anterior no conoce).

## 5. Estado del repositorio

- **Actualizado (2026-11-12, autorizado):** `main` avanzó por avance directo de `0bfbc03` a `8d8f560` y se hizo push. El código de `main` es idéntico al publicado (API `3c53c1d8`, panel `6f503c33`): incluye la línea de Telegram (`c08c55d`) y la fábrica de publicidad. Desde ahora, `main` = producción.
- Las ramas que partieron antes (por ejemplo `feat/whatsapp-admin-bot`, desde `891d17a`) deben integrar `main` antes de publicar, para no borrar la fábrica.

---

## 6. Ideas para manejar la fábrica desde los bots de Telegram y WhatsApp

**Restricción de fondo:** las piezas se dibujan en el navegador (Canvas y WebCodecs). El servidor (Worker) no puede dibujar ni codificar video. Por eso las ideas se dividen entre lo que el servidor ya puede hacer solo y lo que necesita un navegador abierto.

### A. Inmediatas: el servidor ya puede hacerlas solo, sin infraestructura nueva

1. **«Envíame mis piezas»**: el bot manda por chat las piezas aprobadas (imagen o MP4, que ya están en R2 privado). Por ejemplo: *«mándame las historias de esta semana»* o *«el video del puff corazón»*. Telegram usa `sendPhoto`/`sendVideo`; WhatsApp, su API de medios.
2. **Aprobar desde el chat**: cuando se crea una pieza o termina un lote, el bot envía la vista previa con los botones **Aprobar / Rechazar / Otra variante**. Usa las mismas rutas de revisión que el panel.
3. **Textos listos para publicar**: el bot devuelve las versiones por canal (WhatsApp, Instagram/Facebook y corta), que el servidor ya compone con el precio real. Gemini, opcional, con el mismo filtro de afirmaciones.
4. **Sugerencias automáticas** con el cron de 15 minutos que ya existe. Por ejemplo, *«Tienes 6 productos nuevos sin publicidad»*, o *«El nochero tiene 3 unidades: ¿preparo una pieza de “Últimas unidades”?»*. Solo con datos verificados: la plantilla exige el dato real.
5. **Publicar en el canal de Telegram de la tienda** (si el bot es administrador del canal), siempre con confirmación previa.

### B. Con el teléfono del comercio como «estudio» (sin costo, sin servidor nuevo)

6. **Enlace de estudio rápido**: el comercio pide por chat, en lenguaje natural o por nota de voz (el intérprete de TiendIA ya entiende ambas), algo como *«hazme una historia del jean en estilo urbano»*. El bot confirma el resumen (producto, formato, estilo, objetivo) y responde con un enlace de un solo uso. Al tocarlo se abre una página liviana que genera la pieza sola, pasa el control de calidad y ofrece **Compartir** con el menú del celular (Web Share), directo a Estados de WhatsApp o Historias de Instagram.
7. **Lote por chat**: *«prepara las historias de los 10 productos más nuevos»* deja el lote pedido en el servidor. La próxima vez que el comercio abra el enlace o el panel, el navegador lo procesa, y el bot avisa cuando el ZIP o las piezas están listos.
8. **Plan semanal**: un mensaje fijo (por ejemplo los lunes) con 3 piezas propuestas para la semana (nuevo, destacado y oferta real si existe). El comercio responde «sí» y recibe el enlace de estudio rápido.

### C. Con autorización e infraestructura nueva (cotizar antes)

9. **Render en el servidor sin el panel abierto**: un contenedor con Chromium sin ventana o FFmpeg (Cloudflare Containers u otro), orquestado por la cola existente. Permitiría que el bot entregue imágenes y videos terminados sin intervención del comercio. Tiene costo por segundo de cómputo, a cotizar.
10. **Estados de WhatsApp automáticos**: la API oficial de WhatsApp (Cloud API) no permite publicar Estados. WAHA (no oficial) sí podría, pero con riesgo de suspensión del número. Recomendación: que el bot envíe la pieza vertical lista para que el comercio la reenvíe a su Estado.

### Reglas para todas

Mismos datos verificados y la misma elegibilidad de plantillas que el panel; nada de afirmaciones que el catálogo no respalde; confirmación antes de publicar en canales; límites por tienda y la cuota de mensajes con IA (hoy en observación); trazabilidad en `audit_log`; desactivadas por defecto y con piloto por tienda, como el resto de funciones de los bots.

**Orden sugerido:** 1 → 3 → 2 → 6 → 4 → 7 → 5 → 8. Las tres primeras no necesitan nada nuevo de infraestructura y dan valor desde el primer día.
