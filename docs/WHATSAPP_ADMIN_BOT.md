# Asistente administrativo por WhatsApp

Rama `feat/whatsapp-admin-bot` (2026-11-11). Canal adicional para comerciantes sobre WhatsApp Business Platform (Cloud API oficial). **No está desplegado ni activo**: sin push, sin migración remota, sin secretos, `WHATSAPP_ADMIN_BOT_ENABLED` sin definir (apagado).

No cambia: Telegram, el panel (ningún archivo de `frontend/`), el WhatsApp de pedidos de los compradores (enlaces `wa.me` del catálogo; no pasan por este código), los comercios existentes ni los planes.

## 1. Auditoría

| Qué | Estado real |
|---|---|
| Worker en producción | `56b1450b`, código `c08c55d` de `feat/telegram-ia-planes` (verificado con `wrangler deployments list`). `main` (`0bfbc03`) va **por detrás** de producción en el Worker. |
| `feat/telegram-ia-planes` | En producción y **sin merge a `main`**: intérprete inteligente, botón Corregir, voz, cuota de mensajes en `shadow` (cuenta y avisa, no bloquea), migración 0023 aplicada. |
| `feat/checkout-un-clic` (`f8f5194`) | Un commit sobre `main`, sin publicar. No se tocó. |
| Base de esta rama | `891d17a` (punta de `feat/telegram-ia-planes`): es lo que corre en producción. No se hizo merge de nada experimental. |
| Línea base de pruebas | 555 pasan, 17 omitidas. |

Hallazgo de la auditoría del motor: **casi todo el asistente ya era independiente del transporte**. Productos, inventario, precios, categorías, propuestas y confirmaciones hablan con el comerciante solo a través de `say()` / `sayPhoto()` y guardan su estado con dos claves opacas (`chatId`, `telegramUserId`). Lo acoplado a Telegram eran 4 descargas de imágenes, 1 de documentos, 1 de voz, el indicador "escribiendo…" y la elección de tienda.

Estado de los documentos (importadores): **CSV** de precios y existencias funciona con propuesta y confirmación. **PDF** solo se resume con IA; **no importa productos**. **Excel** no existe en el asistente. Lotes de fotos (`/lote`) dependen de Telegram.

## 2. Arquitectura

```
Telegram ──► routes/telegram.ts ─► buildContext ─┐
                                                  ├─► openAssistantContext ─► dispatchAssistantUpdate
WhatsApp ──► routes/whatsapp.ts ─► whatsapp/processor.ts ─┘        (services/telegram.ts: el motor de siempre)
              firma HMAC            identidad vinculada                       │
              idempotencia          canal (AssistantChannel)                  ▼
              respuesta 200         formato y botones            productos · inventario · precios · IA · permisos
                                                                              │
                                                                         D1 y R2
```

Extracción mínima en el motor (12 archivos, +157 −49, comportamiento de Telegram idéntico):

- `AssistantContext.channel?` opcional. Sin canal = Telegram, igual que antes.
- `say`, `sayPhoto`, `showTyping`, `fetchImage`, `fetchFile` enrutan al canal cuando existe.
- `openAssistantContext` (antes dentro de `buildContext`) y `dispatchAssistantUpdate` (antes dentro de `processTelegramUpdate`) quedan exportados; Telegram los usa igual.
- Cuatro funciones propias de Telegram responden "todavía no está disponible por WhatsApp": lotes de fotos, equipo, contraseña del panel y configuración guiada.

El adaptador (`worker/src/whatsapp/`) no contiene reglas de negocio:

| Archivo | Responsabilidad |
|---|---|
| `api.ts` | Firma del webhook, envío por Graph API, descarga de archivos, duración de audios. |
| `format.ts` | HTML del asistente → formato WhatsApp; teclado → 3 botones, lista de 10 o menú numerado. |
| `identity.ts` | Vinculación, códigos, revocación, límites de intentos. |
| `processor.ts` | Recepción, idempotencia, canal de salida, trazabilidad, costos, mantenimiento. |
| `routes/whatsapp.ts` | Webhook y endpoints de vinculación y reporte. |

Flujo de un mensaje:

```
Meta ─POST firmado─► ¿firma válida? ─no─► 401
                         │sí
                 ¿canal activo? ─no─► 200 (se descarta)
                         │sí
        guardar por id de mensaje (repetido = no hace nada) ─► 200 a Meta
                         │ (después de responder: waitUntil)
        ¿es "VINCULAR código"? ─► vincular ─► respuesta
        ¿remitente vinculado? ─no─► instrucciones (1 vez cada 6 h) y fin
        membresías y rol leídos en ese momento ─► ¿tienda activa? ─no─► selector
        motor común ─► propuesta ─► Confirmar / Corregir / Cancelar ─► ejecución
        borrar contenido del mensaje; queda el registro (tienda, estado, costo)
```

Procesamiento asíncrono: hoy `waitUntil` + reintento por la tarea programada (mensajes guardados que no arrancaron en 60 s; máximo 3 intentos; los que quedaron a medias **no se repiten**, se cierran como fallidos). **Propuesta**: pasar a Cloudflare Queues cuando el piloto muestre audios o documentos que superen los ~30 s de `waitUntil`; el punto de entrada (`processInbound(id)`) ya es el consumidor natural. No se agregó la cola ahora porque exige crear infraestructura en la cuenta.

## 3. Vinculación y seguridad

1. El comerciante, con sesión iniciada, llama `POST /api/whatsapp/link-code` → código `XXXX-XXXX-XX`, 15 minutos, un solo uso, guardado solo como hash SHA-256. Devuelve también el enlace `wa.me` con el mensaje listo.
2. Envía `VINCULAR código` al número central. El remitente es el que firma Meta, no lo que diga el texto.
3. Se valida código, vigencia, usuario activo, membresía activa y tienda no cancelada. Queda auditado (`whatsapp_link_code_generated`, `whatsapp_linked`).

Protecciones: 5 códigos fallidos bloquean ese número una hora; una cuenta admite un solo WhatsApp y cambiarlo exige revocar primero (`DELETE /api/whatsapp/link` o escribir `desvincular`); un WhatsApp ya vinculado no se puede reasignar con otro código; una palabra suelta nunca se toma por código. La identidad principal es el identificador de usuario de Meta (BSUID) y el teléfono es opcional: si el mismo teléfono llega con otro BSUID (el número cambió de dueño) **no hereda el vínculo**.

Interfaz: no se creó ninguna pantalla. Los tres endpoints quedan listos para una página aislada de vinculación (pendiente, requiere autorización porque toca `frontend/`). Para el piloto basta llamar el endpoint con la sesión del comerciante.

Aislamiento: la conversación de WhatsApp usa claves propias (`wa:<id>` y un `chatId` negativo fuera del rango de Telegram), así que sesión, propuestas y memoria no se mezclan con las de Telegram del mismo usuario. Membresías y rol se leen en cada mensaje. Las propuestas se validan por conversación + tienda + vigencia + estado anterior (`before_json`) + token de ejecución, igual que en Telegram.

## 4. Migración

`database/migrations/0024_whatsapp_admin_bot.sql` (solo tablas nuevas; reversión en `database/rollback/0024_whatsapp_admin_bot.down.sql`):

- `whatsapp_identities`: vínculo WhatsApp ↔ usuario, con BSUID y/o teléfono.
- `whatsapp_link_tokens`: códigos (hash), vencimiento, uso.
- `whatsapp_throttles`: intentos fallidos, ráfagas, avisos a desconocidos.
- `whatsapp_messages`: un renglón por mensaje entrante o saliente (idempotencia, trazabilidad, estado, cobro). El contenido del mensaje solo existe mientras se procesa.

Retención: contenido borrado al terminar; registros 180 días; códigos y ventanas 7 días.

## 5. Costos

Reglas de Meta vigentes (consultadas el 2026-11-11; verificar la tarifa oficial antes de presupuestar):

- Cobro por mensaje entregado desde julio de 2025, según categoría y país del destinatario.
- **Desde el 1 de octubre de 2026 los mensajes de servicio (respuestas libres dentro de las 24 h) ya no son gratis sin límite**: solo los primeros 1.000 al mes por número. Las plantillas de utilidad dentro de la ventana también se cobran. Sin medio de pago registrado, Meta deja de entregar mensajes de servicio.
- Colombia: sin cambio de tarifa en octubre; facturación en COP disponible. Tarifas en USD **no confirmadas en fuente oficial** (agregadores: ~0,0008 servicio/utilidad/autenticación, ~0,0125 marketing).
- El bot solo responde a mensajes del comerciante, así que no consume límites de mensajería ni necesita plantillas. Avisos proactivos sí las necesitarían (no implementado).

Qué se mide: entrantes, salientes, fallidos, cobrables y gratuitos según el webhook de estado (`pricing.billable`, `category`, `type`), notas de voz, fotos y documentos, por tienda. Costo estimado = tarifa configurada en `WHATSAPP_RATES_USD_MICROS` × mensajes cobrables; sin tarifa configurada queda vacío (no se inventa). `GET /api/whatsapp/report?period=AAAA-MM` (superadministrador) lo entrega junto con las interacciones de IA que entraron por WhatsApp.

Asignación a comercios: cada mensaje lleva la tienda activa; vinculación, selector y desconocidos quedan como costo de plataforma. Los 1.000 gratuitos son del número, compartidos: se propone repartirlos en proporción a los salientes de cada tienda. Costo real = factura de Meta; lo del reporte es estimado.

IA: mismo presupuesto mensual y mismo registro (`ai_usage_events`). La cuota de mensajes cuenta una vez por interacción con clave `wa:<id>`; la columna `channel` del libro sigue diciendo `telegram_text` / `telegram_voice` (indica texto o voz; cambiarla exige reconstruir la tabla). No se agregó ninguna restricción nueva.

Control: máximo 30 mensajes por minuto por remitente, 12 respuestas por mensaje entrante, un aviso cada 6 h a desconocidos, evento `WHATSAPP_VOLUME` si una tienda supera 300 salientes en 24 h (avisa, no bloquea).

## 6. Configuración de Meta (manual)

1. Portafolio de Meta Business con medio de pago registrado.
2. App de tipo Business con el producto WhatsApp, en modo **Live**.
3. Número exclusivo para el asistente: no puede estar en uso en WhatsApp ni ser el de soporte, el personal o el de un comercio. Registrarlo (código por SMS o llamada + PIN de dos pasos) hasta estado `CONNECTED`; nombre visible "TiendIA Exprés — Asistente de comercios" (pasa revisión).
4. Usuario del sistema con token permanente y permisos `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`.
5. Webhook: URL `https://<worker>/api/whatsapp/webhook`, token de verificación propio, campo `messages` suscrito; suscribir la cuenta de WhatsApp a la app.
6. Verificación del negocio: no es obligatoria para empezar (2 números, nivel 250); recomendable.

Para pruebas sirve el número de prueba de Meta con destinatarios autorizados.

Datos que necesito: identificador del número, identificador de la cuenta de WhatsApp Business, App Secret, token del usuario del sistema, el número en formato internacional y un token de verificación.

## 7. Secretos y variables

| Nombre | Tipo | Uso |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | secreto | Envío y descarga de archivos. |
| `WHATSAPP_APP_SECRET` | secreto | Firma del webhook. |
| `WHATSAPP_VERIFY_TOKEN` | secreto | Verificación inicial. |
| `WHATSAPP_PHONE_NUMBER_ID` | variable | Solo se aceptan eventos de este número. |
| `WHATSAPP_ACCOUNT_ID` | variable | Referencia de la cuenta. |
| `WHATSAPP_ADMIN_BOT_ENABLED` | variable | `true` activa. Cualquier otro valor: apagado. |
| `WHATSAPP_DISPLAY_NUMBER` | variable | Número para el enlace `wa.me`. |
| `WHATSAPP_PILOT_STORE_IDS` | variable | Tiendas habilitadas (vacío = todas). |
| `WHATSAPP_GRAPH_VERSION` | variable | Por defecto `v26.0`. |
| `WHATSAPP_RATES_USD_MICROS` | variable | Tarifas para el estimado. |
| `WHATSAPP_MONITOR_DAILY_MESSAGES`, `WHATSAPP_MEDIA_HOSTS` | variable | Umbral de alerta; hosts extra de descarga. |

Staging y producción usan apps, números y secretos distintos. Ningún secreto está en Git, en respuestas ni en logs (solo se registra el código numérico de error de Meta).

## 8. Conversaciones de ejemplo

```
Comerciante: VINCULAR K7P2-MQ9X-T4
Asistente:   ✅ ¡Listo! Este WhatsApp quedó vinculado a *SneakerHub*. Escribe *hola* para empezar.

Comerciante: tiendas
Asistente:   Estas son las tiendas que puedes administrar. ¿Con cuál quieres trabajar?   [lista]
Comerciante: (elige SneakerHub)
Asistente:   ¡Perfecto! Ahora estás administrando *SneakerHub*.

Comerciante: Cambia el precio de AD223 a 195 mil
Asistente:   resumen con precio anterior y nuevo     [✅ Confirmar] [✏️ Corregir] [✖ Cancelar]
Comerciante: (Corregir) el precio es 185 mil
Asistente:   resumen nuevo                           [✅ Confirmar] [✏️ Corregir] [✖ Cancelar]

Comerciante: 🎙️ "llegaron tres negras talla 38 de las sandalias"
Asistente:   🎙️ Entendí: "…"  + resumen 1 → 4       [✅ Confirmar] [✏️ Corregir] [✖ Cancelar]

Desconocido: ¿cuánto inventario hay?
Asistente:   Este WhatsApp todavía no está vinculado… VINCULAR TU-CODIGO
```

## 9. Pruebas

`worker/src/whatsapp/whatsapp.test.ts`: 46 pruebas sobre el Worker real con SQLite y todas las migraciones. Suite completa: **601 pasan, 17 omitidas** (555 anteriores sin cambios + 46).

Cubierto: firma inválida/ausente/otro secreto/cuerpo alterado, token inválido, carga excesiva, canal apagado, otro número, mensaje repetido, número no vinculado, código reutilizado/vencido/inventado, bloqueo por intentos, secuestro de cuenta, teléfono reasignado, revocación, piloto, rol sin permiso, permiso retirado tras proponer, varias tiendas, cambio de tienda, identificador de tienda manipulado, propuesta de otra conversación, confirmación vencida y duplicada, inventario cambiado con propuesta pendiente, archivo que no es imagen, CSV con fórmula, PDF hostil, descarga solo desde hosts de Meta, WhatsApp y Telegram del mismo usuario sin mezclarse.

**Solo simulado** (Meta y Gemini son dobles de prueba): entrega real de mensajes, audios reales, fotos reales, PDF reales, estados de cobro reales.

## 10. Staging, piloto y producción (propuestas; requieren autorización)

Staging: aplicar 0024 al D1 `sneakerhub-telegram-staging-db`, desplegar el Worker de staging con secretos de una app de prueba de Meta y su número de prueba, registrar el webhook, vincular una tienda ficticia y recorrer los 16 criterios con mensajes, audio y foto reales.

Piloto: un comercio autorizado, `WHATSAPP_PILOT_STORE_IDS` con su tienda, número central definitivo registrado, medio de pago en Meta, tarifa oficial de Colombia cargada, forma de entregar el código (página aislada o soporte) y revisión diaria del reporte.

Producción: copia del D1 y bookmark de Time Travel → migración 0024 → despliegue con el canal apagado y humo de Telegram, catálogo, pedidos y panel → secretos → webhook → activar solo el piloto.

Reversión: `WHATSAPP_ADMIN_BOT_ENABLED=false` (inmediato, sin tocar código; el webhook sigue confirmando a Meta y descarta) → `wrangler rollback 56b1450b-ebfc-4337-86e5-e1f3cb0897dd` → solo si hace falta, `0024_whatsapp_admin_bot.down.sql` (la migración es aditiva; el Worker anterior funciona con las tablas presentes).

## 11. Riesgos y pendientes

- La frase «Agrega tenis blancos AD223, tallas…» (código sin la palabra "referencia") **no crea el borrador sin IA**: el motor la toma como reposición de un producto existente. Pasa igual en Telegram. Con «referencia AD223» funciona. Corregirlo cambia el intérprete compartido (requiere autorización).
- La auditoría de acciones del motor registra `source = 'telegram'` y actor `telegram:wa:<id>` también para WhatsApp. Es rastreable, pero el rótulo engaña; cambiarlo toca ~40 sentencias del motor.
- Cambio de número o de BSUID del comerciante (mensaje `system` de Meta): hoy se ignora y el comerciante debe volver a vincular.
- La vista previa de fotos no reenvía la imagen (no está confirmado que un archivo recibido pueda reenviarse por su identificador).
- Aviso por correo al titular cuando se vincula un WhatsApp: no implementado.
- Textos de algunos mensajes del motor mencionan comandos con `/` pensados para Telegram; funcionan escritos en WhatsApp.
- Política de Meta sobre proveedores de IA: un asistente acotado a administrar la tienda es IA accesoria al servicio (interpretación, no declaración de Meta). No debe responder como asistente general.
- Host de descarga de archivos no documentado por Meta: lista de sufijos permitidos ampliable con `WHATSAPP_MEDIA_HOSTS`.

## 12. Entregables

| # | Entregable | Estado |
|---|---|---|
| 1 | Auditoría de la arquitectura | Implementado |
| 2 | Motor reutilizable identificado | Implementado, probado |
| 3 | Diseño del adaptador | Implementado |
| 4 | Diagrama de flujo | Implementado |
| 5 | Migraciones | Implementado, probado en local · aplicar en remoto requiere autorización |
| 6 | Modelo de vinculación | Implementado, probado |
| 7 | Webhook | Implementado, probado (simulado) · requiere configuración externa |
| 8 | Manejo de mensajes | Implementado, probado (simulado) |
| 9 | Pruebas de seguridad | Probado |
| 10 | Pruebas multiempresa | Probado |
| 11 | Telegram sin regresión | Probado (555 pruebas anteriores pasan) |
| 12 | Informe de costos | Implementado · tarifa oficial de Colombia pendiente |
| 13 | Guía de Meta | Implementado · requiere configuración externa |
| 14 | Lista de secretos | Implementado |
| 15 | Ejemplos de conversaciones | Implementado |
| 16 | Audio e imágenes | Implementado, probado **solo con simulaciones** |
| 17 | Documentos | CSV implementado y probado (simulado) · importación de productos desde PDF/Excel pendiente (no existe en el motor) |
| 18 | Commits locales | Implementado |
| 19 | Despliegue de pruebas | Pendiente · requiere autorización y configuración externa |
| 20 | Plan de reversión | Implementado |
| 21 | Riesgos pendientes | Implementado |
| 22 | Requisitos del piloto | Implementado · requiere autorización |

Criterios de aceptación: 2–12, 14 y 16 probados en local con Meta simulado; 13 probado con Gemini simulado; 15 sin cambios en `frontend/` ni en rutas del panel (suite del Worker en verde); **1 (Meta entrega un mensaje real) pendiente** hasta configurar Meta.
