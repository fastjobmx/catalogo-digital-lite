# Pedidos por WhatsApp con la fotografía del producto

Fecha: 2026-11-11 · Rama `feat/whatsapp-fotos` (sale de `main` = producción) · **EN PRODUCCIÓN desde 2026-11-11 (autorizado), ver §10.**
No se tocaron los bots de Telegram, Resend, planes, inventarios ni comercios. Sin migraciones.

## 1. Diagnóstico del flujo actual

| Paso | Hoy (producción) |
|---|---|
| Carrito (`CartDrawer`) y «Pedir por WhatsApp» de la ficha (`ProductPage`) | Verifican precio y stock, registran el pedido (`POST /api/orders`, clave de idempotencia, número `PED-AAAAMMDD-XXXXXXXX`) y arman el texto con `buildWhatsAppOrderMessage`. |
| Mensaje | Encabezado, pedido, fecha, cliente, productos (talla, SKU, cantidad × precio) y por cada producto **`Foto: <URL larga de la imagen>`**, subtotal, envío por cotizar, pago, nota final. |
| Apertura | `wa.me` con el texto. En computador, pestaña nueva abierta dentro del clic; en celulares y navegadores de apps, **la misma pestaña** (la página se va a WhatsApp). |
| Historial | Evento `created` («Pedido recibido»). La columna `orders.whatsapp_sent` existe y **nunca se marca** (correcto: WhatsApp no confirma nada). |
| Fichas públicas | El worker del panel (`frontend/cloudflare/worker.js`) ya publica `og:image` = foto principal real, título y descripción por producto. |

Fotos principales en producción (muestra, 2026-11-11): SneakerHub, MUY PARCERO e Imperio Nova en JPEG de 113–632 KB; **Luz Mágica 100 % WebP** (34–162 KB).

## 2. Alternativa recomendada

Dos caminos complementarios, el primero universal:

1. **Enlace de la ficha con vista previa (todos los dispositivos).** El mensaje reemplaza la URL larga de la imagen por `Ver producto: https://app.tiendiaexpres.com/[t/<tienda>/]producto/<SKU>`. WhatsApp genera la tarjeta de vista previa (foto principal real, nombre y dominio) a partir del Open Graph de la ficha, para el **primer enlace** del mensaje. Se mejoró ese Open Graph (§5).
2. **«Enviar también la foto» con Web Share (solo donde el navegador puede compartir archivos).** Se descargan antes del toque las fotos principales reales (una por producto distinto, máximo 5) y, tras el toque explícito del comprador, `navigator.share({ files, text })` abre el menú de compartir del sistema. El comprador elige WhatsApp y el chat de la tienda.

**Varios productos:** el texto conserva siempre todos los artículos; se comparten las fotos originales por separado (hasta 5). Se descartó el collage: sería una imagen nueva y reduciría la resolución de cada foto.

**WebP:** al compartir, las fotos WebP/AVIF se recodifican a JPEG con los mismos píxeles y tamaño (sin editar), porque algunas apps tratan WebP como sticker. El original guardado no cambia. JPEG y PNG se comparten tal cual (verificado byte a byte).

## 3. Compatibilidad por dispositivo

| Entorno | Enlace con vista previa | Compartir foto (Web Share con archivos) | Comportamiento implementado |
|---|---|---|---|
| Android · Chrome, Edge, Samsung Internet | Sí, si WhatsApp genera la vista previa | Sí (`canShare({ files })`) | Panel en la página: «1 · Enviar pedido por WhatsApp» y «2 · Enviar también la foto». |
| iPhone/iPad · Safari (y Chrome/Firefox iOS, que usan WebKit) | Sí, idem | Sí (iOS 15+) | Igual que Android. El texto puede no viajar con la foto (§7): queda copiado para pegarlo. |
| Navegadores dentro de apps (Instagram, Facebook, TikTok) | Sí | Normalmente no | Igual que hoy: se abre WhatsApp en la misma pestaña. |
| Escritorio · Chrome/Edge Windows, Safari macOS | Sí | A veces | Igual que hoy (pestaña nueva automática) + botón de foto si el navegador lo permite. |
| Escritorio · Firefox | Sí | No | Igual que hoy. |

**Lo que no se pudo verificar aquí:** no hay celulares físicos ni WhatsApp instalado en este entorno. Las rutas de Android, iPhone y escritorio se probaron en Chromium emulando cada dispositivo, con la API de compartir simulada (§6). Pendiente antes de publicar: prueba manual en un Android y un iPhone reales (§9).

## 4. Flujo de compra

```
Comprador toca «Enviar pedido por WhatsApp» (carrito) o «Pedir por WhatsApp» (ficha)
  → se verifica precio/stock y se registra el pedido (igual que hoy)
  ├─ Celular con compartir archivos:
  │    Panel «Pedido PED-… registrado · Falta enviarlo a <tienda>»
  │      1 · Enviar pedido por WhatsApp   → abre el chat de la tienda con el texto (pestaña/app aparte; la página sigue)
  │      2 · Enviar también la foto       → menú del sistema → WhatsApp → chat de la tienda
  │    («Envía primero el pedido para que ese chat aparezca entre los recientes»)
  └─ Resto (escritorio, apps, navegadores sin la función):
       WhatsApp se abre solo, como hoy; el panel ofrece «Abrir WhatsApp otra vez» (+ foto si se puede)
```

Textos honestos: «la tienda lo recibe cuando tocas «Enviar» en WhatsApp», «Tu celular pasó la foto a la app que elegiste. Revisa en WhatsApp que quede enviado…». Nunca dice «enviado».

**Estados en el historial del pedido (panel → Pedidos):**

| Situación | Cómo se registra |
|---|---|
| Pedido registrado | Evento `created` (existente), estado `pendiente`. |
| Intento de envío | Evento nuevo `comprador_whatsapp`: «abrió WhatsApp con el pedido», «compartió la foto desde su celular (N fotos)», «canceló compartir la foto», «su celular no permitió compartir la foto». Etiqueta: «Comprador (no confirma envío)». |
| Envío confirmado | **No se registra automáticamente**: la plataforma no puede verificarlo. `whatsapp_sent` sigue en 0; el comercio confirma el pedido como siempre. |

Solo el navegador que creó el pedido puede registrar estos eventos (debe presentar su clave de idempotencia), con un máximo de 12 por pedido. Si el registro falla, el comprador no se entera ni se bloquea.

## 5. Cambios

| Archivo | Cambio |
|---|---|
| `frontend/src/lib/whatsapp.ts` | `productPageUrl()`; el mensaje usa «Ver producto: <ficha>» (se mantiene «Foto:» solo si no hay ficha). |
| `frontend/src/lib/orderShare.ts` (nuevo) | Detección de `canShare({ files })`, fotos por producto (sin duplicados, máx. 5), descarga previa, WebP→JPEG sin editar, `share()` tras el toque con copia del texto al portapapeles, registro de intentos. |
| `frontend/src/components/orders/OrderSendPanel.tsx` (nuevo) | Panel posterior al registro (pasos 1 y 2, mensajes honestos). |
| `frontend/src/components/cart/CartDrawer.tsx`, `frontend/src/pages/ProductPage.tsx` | Usan el enlace de ficha y el panel; en celulares con la función no saltan solos a WhatsApp. El botón de envío del carrito se oculta mientras el panel está visible. |
| `frontend/src/services/api.ts`, `frontend/src/lib/orderStatus.ts` | Llamada y etiquetas del historial. |
| `frontend/cloudflare/worker.js` | Fichas: `og:image:secure_url`, `og:image:type`, `og:image:alt`, `twitter:image:alt`, `product:price:amount/currency`. |
| `worker/src/routes/orders.ts` | `POST /api/orders/whatsapp-event` (público, por tienda, clave del comprador, acciones cerradas, tope 12). Sin migración: usa `order_events`. |
| `apps/tiendaiaexpress-landing/…` | La demo «Mensaje de WhatsApp» muestra «Ver producto» y la tarjeta de vista previa con la foto real; nota sobre la foto desde el celular. |
| `.claude/launch.json` | Configuración local `api-local-pedidos` (base aislada `.tmp/fase3-local`, `COMMERCE_ENABLED`). |

## 6. Pruebas

| Prueba | Resultado |
|---|---|
| Servidor: `npx vitest run` (incluye 4 nuevas del endpoint: registra intentos sin marcar enviado, exige la clave del comprador, rechaza acciones como «enviado», tope por pedido) | 461 ✔, 1 omitida |
| Panel: `npx vitest run` (mensaje con «Ver producto», URLs de ficha, compartir: detección, deduplicado y tope, nombres, éxito/cancelación/error, copia del texto; metadatos OG nuevos) | 110 ✔, 1 omitida |
| `tsc` servidor y panel, `npm run build` del panel | ✔ |
| E2E local (API + panel, base aislada), Android emulado con compartir simulado: ficha → panel, la página no se va, enlace en pestaña aparte, texto con «Ver producto», 1 foto JPEG idéntica a la original, texto copiado = texto del pedido, evento `foto_compartida (1 foto)` | ✔ |
| E2E iPhone emulado, carrito con 2 productos: «Enviar también las 2 fotos», 2 archivos JPEG, texto con los 2 artículos y sus enlaces | ✔ |
| E2E escritorio sin compartir archivos: WhatsApp se abre solo como hoy, panel «Abrir WhatsApp otra vez», sin botón de foto, evento `whatsapp_abierto` | ✔ |
| Conversión WebP→JPEG en el navegador: mismas dimensiones; JPEG sin tocar; fotos de otros dominios omitidas | ✔ |
| Historial: `created` + `comprador_whatsapp`; `status = pendiente`, `whatsapp_sent = 0` | ✔ |
| Landing: 43 pruebas (incluye la demo con «Ver producto» y la vista previa, axe) | ✔ |
| Android/iPhone reales con WhatsApp | **Pendiente** (no disponible aquí) |

Capturas: `docs/capturas-whatsapp-fotos/`.

## 7. Riesgos

- **El texto con la foto:** en Android WhatsApp suele usar el texto como pie de foto; en iPhone puede descartarlo. Mitigación: el texto se copia al portapapeles antes de abrir el menú y el panel lo explica; además el paso 1 envía el texto completo. Verificar en dispositivos reales.
- **Elegir el chat:** Web Share no puede preseleccionar el chat de la tienda. Por eso el orden recomendado es 1 (texto, abre el chat de la tienda) y luego 2 (foto al chat reciente).
- **Vista previa del enlace:** la genera WhatsApp en el celular del comprador; puede no aparecer (conexión, caché de WhatsApp, imagen pesada). Fotos WebP (Luz Mágica) y de más de ~600 KB son las de mayor riesgo. Mejora posible, con autorización: transformar la imagen de `og:image` a JPEG liviano con Cloudflare Images.
- **Un toque más en celulares compatibles:** antes WhatsApp se abría solo; ahora el comprador elige en el panel. A cambio, la página no se pierde y puede mandar la foto.
- **Eventos públicos:** limitados a quien tiene la clave del pedido y a 12 por pedido; no cambian estados ni datos del pedido.
- **Datos móviles:** se descargan hasta 5 fotos (en la prueba, 89–371 KB cada una) solo en celulares compatibles y solo después de registrar el pedido.

## 8. WhatsApp Business Cloud API (no integrada)

No se integró. Antes de decidir conviene evaluar: verificación de la empresa en Meta por cada comercio (o un número de la plataforma), número dedicado y su convivencia con la app de WhatsApp Business, plantillas aprobadas para mensajes iniciados por el negocio, cobro por conversación según país y categoría (hay que cotizar tarifas vigentes para Colombia), webhooks y almacenamiento de mensajes, y responsabilidad sobre datos personales. Consecuencia para el comerciante: deja de recibir pedidos en su WhatsApp de siempre como mensajes del cliente, o debe gestionar la coexistencia. Ganancia: confirmación real de entrega y envío de imágenes sin intervención del comprador.

## 9. Publicación (solo con autorización) y reversión

Orden: **API → panel → landing**.
1. API: `cd worker && npx wrangler deploy --config wrangler.production.toml` (sin migración). El endpoint nuevo no lo usa nadie hasta publicar el panel.
2. Panel: `cd frontend && npm run deploy:cloudflare` (incluye `worker.js` con el Open Graph mejorado).
3. Prueba en producción con una tienda propia (SneakerHub) en un Android y un iPhone reales: enlace con vista previa, compartir foto, texto, historial. Cancelar el pedido de prueba en el panel.
4. Landing: `cd apps/tiendaiaexpress-landing && npm run cf:deploy` (demo actualizada), solo después del panel.

**Reversión:** panel y API a su versión anterior desde Cloudflare (Workers → Deployments) o `wrangler rollback`; landing con Rollback de Pages. No hay migración que revertir; los eventos `comprador_whatsapp` ya registrados quedan en el historial y no afectan nada.

## 10. Publicación (2026-11-11, autorizada)

| Servicio | Antes | Ahora |
|---|---|---|
| API `catalogo-lite-api` | `b2f35814-3f47-423d-a0d7-0c1768ab3faf` | `3c61c48a-52be-46b7-a522-cfc1c6c9ca9b` (cron `*/15` activo) |
| Panel y tiendas `catalogo-digital-ia` | `2410c9f8-3a47-4ef2-b9f2-117091c16927` | `83900c68-b040-4af0-8263-b6768101a99e` |
| Landing Pages `tiendaiaexpress` | `b51e5018` | `b2a8a0db` (`index-DEYPy-I1.js`, igual al build) |

Sin migraciones. Verificación en producción:
- `/api/health` 200; `POST /api/orders/whatsapp-event` responde 404 con una clave que no corresponde y 400 con una acción no permitida.
- Fichas: `og:image` (foto principal real), `og:image:secure_url`, `og:image:type` (`image/jpeg` en SneakerHub, `image/webp` en Luz Mágica), `og:image:alt`, `twitter:image:alt`, `product:price:amount/currency`. `/admin/login` sigue con `noindex`.
- Código publicado, Android emulado (solo la respuesta del registro del pedido se simuló para no crear pedidos reales ni avisos de Telegram): mensaje con «Ver producto: https://app.tiendiaexpres.com/producto/KINETIK-06» al número real de la tienda, botón «Enviar también la foto», archivo JPEG real de 156 KB, evento `foto_compartida`. Escritorio: WhatsApp se abre solo como antes, evento `whatsapp_abierto`, «Abrir WhatsApp otra vez».
- Landing: demo «Mensaje de WhatsApp» con «Ver producto» y vista previa (2 pruebas en vivo ✔).

**Pendiente:** prueba en un Android y un iPhone reales con WhatsApp (texto junto a la foto en iOS; vista previa de fichas con foto WebP, como Luz Mágica).

**Reversión:** `cd worker && npx wrangler rollback b2f35814-3f47-423d-a0d7-0c1768ab3faf --config wrangler.production.toml`; panel `cd frontend && node ../worker/node_modules/wrangler/bin/wrangler.js rollback 2410c9f8-3a47-4ef2-b9f2-117091c16927`; landing: Pages → `tiendaiaexpress` → Deployments → `b51e5018` → Rollback. Revertir primero el panel (el panel anterior no llama al endpoint nuevo).
