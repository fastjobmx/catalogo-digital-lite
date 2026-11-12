# WAHA como proveedor alternativo de WhatsApp

Rama `feat/whatsapp-admin-bot` (2026-11-12). Prototipo funcional en **staging**. **Producción intacta**: ni Worker, ni D1, ni secretos, ni los seis comercios, ni sus planes.

> **WAHA no es la API oficial de Meta.** Usa una sesión de WhatsApp vinculada por QR, igual que WhatsApp Web. WhatsApp no permite bots ni clientes no oficiales. El número puede ser **suspendido o desconectado** sin aviso, y la propia documentación de WAHA lo advierte. Para uso crítico, la vía recomendada sigue siendo Meta Cloud API, que se conserva intacta.

## 1. Auditoría del repositorio

| Qué | Estado |
|---|---|
| Ruta | `D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite` (verificada) |
| Rama | `feat/whatsapp-admin-bot`, base `e4f486e` (bot oficial de Meta en staging, consumo de IA separado 0025) |
| Producción | Worker `catalogo-lite-api` sin cambios. 0026 **no** aplicada en producción |
| Motor común | `services/telegram.ts` → `openAssistantContext` + `dispatchAssistantUpdate`. WhatsApp entra por `AssistantChannel` (sin canal = Telegram) |
| Adaptador oficial | `worker/src/whatsapp/` (Meta): firma, idempotencia, vinculación por código, reportes. Se reutilizó todo |
| Fotos | Telegram ya tenía `/lote`: **1 foto = 1 producto**. Faltaba agrupar varias fotos por producto |
| Borradores | `assistant/productDraft.ts`: el borrador `create_product` con vista previa y confirmación obligatoria. Se reutiliza tal cual |
| IA | `ai_usage_events.channel`: `NULL` (Telegram/panel), `whatsapp` (Meta) y ahora `whatsapp_waha`. Ninguno de WhatsApp suma al presupuesto mensual de la tienda |
| Pruebas | Base 636. Ahora **662 pasan**, 17 omitidas (26 nuevas de WAHA; Telegram y Meta sin regresiones) |

## 2. Versión de WAHA y justificación

- Imagen **`devlikeapro/waha:gows-2026.10.1`** (estable del 28-oct-2026, versión fijada).
- **Motor GOWS** (Go, sin navegador): unos 0,1 CPU y 200 MB por sesión, frente a 0,3 CPU y 400 MB de WEBJS. Recibe imágenes, voz y documentos y envía texto e imagen, con API de LID, QR y código de emparejamiento.
- **WAHA Plus ya no existe** (desde 2026.6.1 todo está en Core). La descarga de multimedia, las sesiones ilimitadas y la seguridad integrada son gratis. La licencia del repositorio es Apache 2.0, con un aporte voluntario opcional de 5 USD al mes sin beneficios.
- Probado con **WhatsApp normal**, sin necesidad de migrar a Business. La documentación no trata WhatsApp Business App; hay reportes de fallos con el modo «Coexistence» (Business App + API oficial a la vez): no usar ese modo.

Fuentes: waha.devlike.pro (instalación, motores, sesiones, eventos, seguridad, almacenamiento, FAQ, changelog) y github.com/devlikeapro/waha.

## 3. Requisitos de infraestructura

- **Mínimo oficial: 2 CPU y 4 GB de RAM**, incluso para una sola sesión.
- Este equipo (i9-14900HX, 128 GB, 32 hilos) supera el mínimo con creces; el contenedor se limitó a 2 CPU y 2 GB.
- Instalados con autorización: **WSL 3.0.5** y **Docker Desktop** (Engine 29.9.3, Compose v5.7.0). Docker Desktop es gratis para empresas de menos de 250 empleados y menos de 10 M USD de ingresos.
- **Limitación actual: WAHA corre en este PC.** Si el equipo se apaga, se suspende o pierde Internet, el asistente deja de responder. Los mensajes llegan a WhatsApp y WAHA los entrega cuando vuelve, pero los que tengan más de 15 minutos se descartan a propósito.

## 4. Instalación (resultado)

`infra/waha/`:

| Archivo | Para qué |
|---|---|
| `docker-compose.yml` | `waha`, solo en `127.0.0.1:3000`, con volúmenes de sesión y archivos, comprobación de salud, registros rotados, límites de recursos y `restart: unless-stopped`. `gateway` (nginx). `tunnel` (perfil opcional) |
| `gateway/default.conf.template` | Lista blanca: solo `sendText`, `sendImage`, `sendSeen`, `startTyping`/`stopTyping`, descarga de archivos de la sesión, resolución de LID y estado de la sesión. Todo lo demás responde 404 (panel, Swagger, sesiones, claves, logout). Exige `X-Gateway-Token` y limita la frecuencia |
| `.env.example` / `.gitignore` | Plantilla. `.env`, `.secrets/`, `data/` y `backups/` nunca van a Git |
| `scripts/init-env.mjs` | Genera los secretos aleatorios sin imprimirlos. La clave administrativa se guarda como `sha512:` |
| `scripts/session.mjs` | `status`, `create`, `me`, `worker-key`, `restart`, `logout --confirm`, `backup [--with-sessions]` |
| `scripts/qr-server.mjs` | Página local `http://127.0.0.1:3099` que muestra el QR oficial sin manejar la clave y se cierra sola al vincular |

Verificado:
- Sin clave, la API responde 401.
- La **clave del Worker** solo es de sesión, con permisos de lectura y envío: no puede reiniciar sesiones ni listar claves (403, incluso con acceso directo).
- Por el túnel, `dashboard`, `api/sessions`, `logout` y `keys` responden 404; sin token, 401.

## 5. Sesión de WhatsApp

Sesión `tiendia` en estado **WORKING**, número terminado en **…9121** (WhatsApp normal), vinculada por QR. WAHA solo procesa chats privados: estados, grupos, canales y difusiones se ignoran en la propia sesión y otra vez en el Worker.

## 6. Webhook

`POST /api/whatsapp/waha/webhook`, independiente del de Meta.

- **HMAC-SHA512** en hexadecimal (`X-Webhook-Hmac`) sobre el cuerpo original. La firma de Meta no sirve aquí.
- Valida la sesión, descarta mensajes de más de 15 minutos y limita el tamaño a 512 KB.
- Ignora los mensajes propios (`fromMe`), así que no hay bucles. También ignora grupos, canales, cabeceras de álbum, reacciones y mensajes de protocolo.
- **Idempotencia**: cada mensaje se guarda con id `waha:<id>`; un reintento de WAHA no hace nada.
- Responde de inmediato y procesa después, con reintentos de WAHA en caso de 503. Los registros nunca contienen secretos ni el contenido de los mensajes.
- Los eventos `session.status` alimentan `whatsapp_channels` y `platform_events` (QR, conectado, caído).

Estructura real capturada con GOWS:
- El remitente llega como **`<LID>@lid`** y el teléfono en `_data.Info.SenderAlt`.
- Un **álbum** llega como un mensaje `albumMessage` vacío seguido de cada foto, enlazada por `messageAssociation.parentMessageKey`.
- Un **reenviado** trae `contextInfo.isForwarded`.
- Cada imagen trae `fileSHA256`, que permite detectar duplicados sin descargar.

## 7. Arquitectura de adaptadores

```
Meta  ─► routes/whatsapp.ts /webhook        (X-Hub-Signature-256) ─┐
WAHA  ─► routes/whatsapp.ts /waha/webhook   (X-Webhook-Hmac)      ─┤
                                                                   ▼
        inbound.ts  NormalizedInbound { provider, channelId, sessionId, messageId,
                    sender, kind, text, caption, media, forwarded, albumId, receivedAt, trace }
                                                                   ▼
        processor.ts  identidad vinculada → tienda → [lote de fotos] → motor común (Telegram)
                                                                   ▼
        salida por proveedor: Meta (botones/listas) | WAHA (texto + menú numerado + imagen)
```

- Las vinculaciones pertenecen a **cuentas internas** (`whatsapp_identities.user_id`), nunca al número del bot. Con teléfono conocido, la identidad es el teléfono del comerciante; si solo hay LID, `waha-lid:<lid>` (espacio propio, sin choques con Meta).
- **Cambiar la conexión de WhatsApp** (otra sesión u otro número del bot) no borra productos, inventario, pedidos, comerciantes, imágenes, auditoría ni Telegram.
- `WAHA_ENABLED` apaga WAHA al instante sin tocar Meta, y los mensajes ya guardados de WAHA no se responden.

## 8. Flujo de fotos (lotes)

Activo solo con `WAHA_PHOTO_BATCH_ENABLED=true`. Archivo: `whatsapp/photoBatch.ts`.

1. **Recepción silenciosa**: valida el formato (JPG/PNG/WebP), el tamaño (5 MB) y la imagen real. Descarta repetidas por huella **antes de descargar** y guarda en R2 (`whatsapp-batches/<lote>/`). Nunca pregunta nada por cada foto.
2. **Análisis por tandas de 8 mientras llegan.** Cuando dejan de llegar (5 s en staging), envía **un aviso** y agrupa con IA: varias fotos del mismo artículo forman **un producto**, y lo que no es producto (capturas, comprobantes) se deja aparte.
3. **Resumen**: «He identificado N posibles productos», con avisos de repetidas, archivos inválidos y parecidos con productos existentes. Esos productos nunca se modifican.
4. Correcciones: «une 1 y 2», «quita 3», «cancelar lote».
5. Con «sí», abre las fichas una por una con el borrador del motor:
   - pregunta primero el precio;
   - acepta «180 mil, tallas 38 al 42, cinco de cada talla» en una sola respuesta;
   - pide el código, o con «no» usa el sugerido;
   - muestra la vista previa **con la foto**.
   «Confirmar» publica; «omitir» salta el producto.
6. Al terminar o cancelar: borra las fotos temporales y los pies de foto, y deja auditoría `whatsapp_photo_batch_completed`.

No inventa precios, marcas, referencias ni cantidades: solo toma el precio y las tallas que **escribió el comerciante**. Si la IA falla, cada álbum (o foto suelta) es un producto y nada se pierde.

**Trabajos en cola**: el paso final corre en la cola **`WHATSAPP_JOBS`** (Cloudflare Queues). Sin cola, un paso de IA (15-25 s con Gemini) puede superar los 30 s de `waitUntil`: eso pasó en la primera prueba real. Respaldos: el resumen se marca como entregado solo cuando sale, se reenvía con el siguiente mensaje del comerciante y la tarea programada lo retoma.

Límites:
- 100 fotos por lote (`WAHA_PHOTO_BATCH_MAX`, tope 200).
- 240 fotos por minuto por remitente, con ventana separada de la de texto.
- Lotes abandonados: se cancelan a las 48 h.
- Retención: 180 días de registros sin contenido.

## 9. Pruebas

**Automatizadas** (`worker/src/whatsapp/waha.test.ts`, 26 pruebas; WAHA y Gemini simulados):
- firma HMAC (válida, ausente, otra clave, cuerpo alterado, otro algoritmo, cabecera de Meta) y carga excesiva;
- canal apagado, otra sesión, mensajes propios, grupos y canales, cabecera de álbum, mensajes viejos y duplicados;
- normalización real de GOWS (LID + SenderAlt, álbum, reenviado, huella) y archivo de otra sesión;
- estado de la sesión; desconocido; vinculación; menú numerado;
- protección entre comercios; fallo del proveedor; foto con lotes apagados;
- lotes de 8, 20, 50 y 100 fotos con **a lo sumo 3 mensajes** por lote; duplicados; «une» y «quita»; fallo de la IA; máximo por lote; imagen falsa;
- recuperación por la tarea programada; lote reabierto; resumen perdido; cola; aislamiento entre tiendas; lectura de precio y tallas;
- costos: `whatsapp_waha` / `agrupar_fotos`, con `ai_usage_monthly` intacto.

**Reales en staging** (tienda ficticia 94 «Canario Staging», usuario ficticio id 60):

| Prueba | Resultado |
|---|---|
| Sesión vinculada por QR | ✅ WORKING |
| Texto y respuesta automática | ✅ |
| Vinculación con código | ✅ identidad 2 → usuario 60 → tienda 94 |
| Desconocido escribe | ✅ solo recibe instrucciones para vincular (2 mensajes de otro número) |
| Foto → borrador → confirmar → catálogo | ✅ «Tenis Dama running», 250.000, 7 fotos (flujo normal del motor) |
| Lote de 12 fotos → resumen → ficha → vista previa con foto → publicar | ✅ «Zapatillas deportivas On Running», 220.000, 3 fotos, talla 40 × 6 |
| Primera versión sin cola | ❌ el resumen se perdió por el límite de 30 s. Corregido con la cola y la recuperación |

**Pendientes con el usuario**: 20, 50 y 100 fotos reales, nota de voz, CSV, reposición, cancelación del lote, desconexión y restauración de la sesión, cambio controlado de número y Telegram de staging de punta a punta.

## 10. Costos

- **IA medida en staging** (gemini-3.8-flash, precios configurados): agrupar 12 fotos ≈ 13.700 tokens de entrada + 5.200 de salida = **0,017 USD**. Proyección lineal: unos 0,14 USD por 100 fotos (estimado, sin verificar a esa escala). Todo WAHA en staging: 0,024 USD.
- **Cola**: gratis hasta 10.000 operaciones al día; un lote de 100 fotos usa unas 300.
- **WAHA**: licencia gratis.
- **Servidor**: hoy este PC (0 USD). Para 24/7 hace falta un servidor con 2 CPU y 4 GB como mínimo; **precio no cotizado** (no se contrató nada).
- **WhatsApp**: sin cargo por mensaje con WAHA (no pasa por la facturación de Meta).

## 11. Riesgos

1. **Suspensión del número** (no oficial). Mitigación: solo responder, nunca iniciar conversaciones; ritmo humano (leído → escribiendo → pausa); foto de perfil; Meta Cloud API como respaldo. Ante los errores 463/475 **no** reiniciar.
2. **Disponibilidad**: depende de este PC, de Docker y del túnel rápido.
3. **URL del túnel temporal**: cambia si se reinicia el contenedor `tunnel`. Hay que actualizar `WAHA_API_URL` y volver a desplegar staging. Para algo estable: túnel con nombre en el dominio propio, con Cloudflare Access.
4. **Privacidad**: las fotos y conversaciones pueden ser privadas.
   - WAHA borra sus archivos a la hora.
   - Las fotos temporales del lote se borran al terminar.
   - El contenido de los mensajes se borra al procesarlos.
   - La copia `backup --with-sessions` equivale a tener el WhatsApp abierto: guardarla solo cifrada.
5. **Agrupación por IA**: puede equivocarse. Por eso el comerciante revisa y corrige, y nada se publica sin confirmar.
6. **Motor compartido**: los ganchos de lote en `productDraft.ts` y `telegram.ts` no actúan si el borrador no trae `batch`, y Telegram nunca lo trae. Aun así, al desplegar en producción cambia el código que usa Telegram.

## 12. Restaurar o cambiar la conexión

- **Sesión caída** (`FAILED`): `node scripts/session.mjs restart`. Si no basta, `logout --confirm`, luego `create` y escanear con `qr-server.mjs`.
- **Cambio de número del bot**: nueva sesión (o logout + QR con el otro teléfono). Las vinculaciones de los comerciantes siguen siendo las mismas (son su teléfono y su cuenta). No se borra nada.
- **El comerciante cambia de teléfono**: escribe «desvincular» (o lo hace desde el panel) y vuelve a vincular con un código nuevo.
- **Apagar WAHA**: `WAHA_ENABLED=false` en el Worker, de efecto inmediato. Meta y Telegram siguen igual.
- **Copia de configuración**: `node scripts/session.mjs backup`.

## 13. Estado de staging

| Recurso | Estado |
|---|---|
| Worker `sneakerhub-telegram-staging` | **`6e4bca5f`** = código del commit `a51495d` de esta rama. Retorno: `56401a84` |
| D1 staging | 0026 aplicada. Marcador previo: `00000400-00000000-00005121-c9aa92dfabee20e0a528a6be60a4a2cd` |
| Cola | `tiendia-whatsapp-jobs-staging` (productor y consumidor). Configurada en `wrangler.remote-staging.toml` (local, no versionado) |
| Variables nuevas | `WAHA_ENABLED=true`, `WAHA_SESSION=tiendia`, `WAHA_API_URL=<túnel>`, `WAHA_PHOTO_BATCH_ENABLED=true`, `WAHA_PHOTO_QUIET_SECONDS=5`, `WAHA_PHOTO_BATCH_MAX=100`. Piloto `1,94` |
| Secretos nuevos | `WAHA_API_KEY` (clave de sesión limitada), `WAHA_GATEWAY_TOKEN`, `WAHA_WEBHOOK_HMAC_KEY` |
| Datos ficticios | Usuario 60 `waha-prueba@staging.invalid` (sin contraseña), dueño de la tienda 94. Lote `3062583b` abierto en el producto 2 de 7 |

Reversión de staging: `wrangler rollback 56401a84-…` → (opcional) `database/rollback/0026_whatsapp_waha.down.sql` → `wrangler queues delete tiendia-whatsapp-jobs-staging` → `docker compose down`.

## 14. Recomendaciones antes de producción

1. Decidir el **alojamiento 24/7** (servidor dedicado con 2 CPU y 4 GB) y un **túnel con nombre** con Cloudflare Access.
2. Crear la **cola de producción** y su configuración en `wrangler.production.toml` (no hecho).
3. Pruebas reales de 20, 50 y 100 fotos, voz, CSV, reposición, desconexión y restauración, y Telegram de punta a punta en staging.
4. Usar un número **dedicado**, nunca el personal ni el de un comercio. Plan B: Meta Cloud API ya implementada.
5. Piloto con una tienda interna (`WHATSAPP_PILOT_STORE_IDS`) y revisión diaria de `/api/whatsapp/report`, que ya separa Meta y WAHA y trae el estado de la sesión y los lotes.
6. Política de conservación por escrito para los comerciantes (fotos y mensajes).
7. Aplicar 0026 en producción con copia y marcador, desplegar con `WAHA_ENABLED` apagado, hacer humo y solo entonces activar el piloto.
