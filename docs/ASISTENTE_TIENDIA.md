# Asistente TiendIA: fases 1 a 3

Este documento explica cómo el bot de Telegram de Tienda IA Express pasó a ser un asistente conversacional para comerciantes. El nombre visible es **Asistente TiendIA**. No cambió ningún identificador técnico: los bots, los tokens, los webhooks y los nombres de usuario siguen iguales.

## 1. Auditoría: lo que había

| Elemento | Estado encontrado |
|---|---|
| Bots | Producción: `@SneakerHubAdmin_bot` (asistente de tiendas) y `@CatalogoDigitalMaestro_bot` (plataforma). Pruebas: `@SneakerHubPruebas_bot` (id 9169852191), con el webhook apuntando a `sneakerhub-telegram-staging…/api/telegram/webhook`, sin actualizaciones pendientes ni errores. No se modificaron tokens, webhooks, nombres ni asociaciones. |
| Webhook | `POST /api/telegram/webhook`. Exige el secreto `X-Telegram-Bot-Api-Secret-Token` y responde 403 sin él. Solo acepta chats privados y autoriza por el ID numérico del usuario de Telegram, nunca por el nombre de usuario. Limita a 20 mensajes por minuto y chat. Aplica idempotencia por `update_id` en la tabla `processed_updates`. |
| Credenciales | Producción tiene 10 secretos: ADMIN_EMAIL, ADMIN_PASSWORD_HASH, GEMINI_API_KEY, JWT_SECRET, MASTER_ADMIN_TELEGRAM_IDS, MASTER_BOT_TOKEN, MASTER_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_ID y TELEGRAM_WEBHOOK_SECRET. No se leyó ni se cambió ninguno. |
| Vinculación | Código de un solo uso (`/link CÓDIGO` o el enlace profundo del bot maestro), de la cuenta real a sus tiendas (`store_memberships`). La tienda activa sale de las membresías del usuario y nunca de un `store_id` enviado por el usuario. |
| Comandos y menús | `/start`, `/ayuda`, `/menu`, `/tiendas`, `/productos`, `/inventario`, `/agotados`, `/pedidos`, `/categorias`, `/agregar`, `/configurar`, `/equipo`, `/clave`, `/cupones`, `/campanas`, `/consejos` y `/cancelar`. Hay menús con botones. |
| IA | Gemini, ejecutada solo desde el servidor. Devuelve acciones tipadas validadas con zod. Tiene presupuesto mensual por tienda (`withAiBudget`), registro de uso y respaldo sin IA. |
| Cambios | `proposeChange`: toma una foto del estado antes y después, muestra una vista previa, pide confirmación (con vencimiento de 15 minutos) y aplica de forma atómica con un token de ejecución, que impide aplicar dos veces o aplicar sobre datos que cambiaron. Deja auditoría en `audit_log` y movimientos de inventario por disparador. |
| Productos y pedidos | Borrador guiado de producto (fotos, nombre, descripción, categoría, precio, tallas y existencias, SKU). Pedidos: listado, detalle y cambios de estado con confirmación. Importación de archivos CSV y PDF. |
| Errores | Se guardan en `platform_events` (UPDATE_FAILED, OPERATION_FAILED, gemini). Al comerciante le llega un mensaje sin detalles técnicos. |
| Límites de Cloudflare | Cada mensaje se resuelve en una sola invocación del servidor con consultas acotadas: catálogo de hasta 2000 productos por tienda y lotes atómicos de D1. |

**Lo que faltaba**, comprobado con los mensajes de la especificación, sin IA:

- Ningún ejemplo funcionaba.
- Los cambios solo se entendían por código SKU.
- «agrega 3 negras talla 38» abría un borrador de producto nuevo, y ese borrador atrapaba los mensajes siguientes.
- No existía `/resumen`.
- No había correcciones ni aclaraciones.

## 2. Qué se construyó

Se agregó el motor comercial en `worker/src/services/assistant/commerce/`. Sus archivos son:

- `language.ts`: normaliza cantidades en números o palabras (tres, una docena) y precios (80mil, 80k, 80.000, $80.000, ochenta mil, 1,5 millones). También tallas numéricas y de letras (XS–XXL, 2XL), colores con su género y plural (negras → Negro), plurales y errores de escritura (camizetas ≈ camisetas).
- `intent.ts`: esquema zod de las intenciones posibles: existencias, agotado, precio, corrección, quitar foto, crear producto, consultar existencias, enlace, activar u ocultar, nombre, categoría y descripción.
- `parse.ts`: intérprete determinista que no usa IA.
- `ai.ts`: la IA lee solo los mensajes que las reglas no entienden y devuelve la misma estructura validada. No ve identificadores ni ejecuta nada, y gasta del presupuesto de IA de la tienda.
- `resolve.ts`: busca el producto real dentro de la tienda activa por nombre, marca, color o SKU, con tolerancia a errores. Las referencias como «ese» o «las negras» se usan solo si hay un antecedente inequívoco: el producto en foco, o el único de la última lista mostrada.
- `plan.ts`: lleva la intención a cambios sobre variantes reales. Pregunta lo que falta en vez de inventarlo.
- `engine.ts`: maneja la conversación. Muestra opciones cuando el producto es ambiguo, pregunta «¿sumar o dejar en N?», corrige una propuesta pendiente, ofrece cambiar de tema, arma `/resumen` y pone los botones de contexto.

Se agregaron dos acciones al catálogo cerrado. Las prepara solo el servidor, no se le ofrecen a la IA y pasan por la confirmación de siempre:

- `update_variant_stocks`: cambia varias variantes de un producto a la vez y crea variantes nuevas. Crear variantes exige el rol de administrador. Cada variante nueva recibe un código único SKU-COLOR-TALLA y un movimiento de entrada.
- `update_product_images`: quita fotos, solo de entre las que el producto ya tiene.

### Estados de una operación

| Estado | Dónde vive |
|---|---|
| Interpretando | `parseCommerce` y, si hace falta, la IA |
| Requiere aclaración | `telegram_sessions.context_json.commerce.ask`: producto, sumar o dejar, distribución o color |
| Pendiente de confirmación | `telegram_operations.status = 'pending'` (vence en 15 minutos) |
| Ejecutando | `applying`, con token de ejecución |
| Completado | `applied`, más `audit_log` e `inventory_movements` |
| Fallido | `stale` (los datos cambiaron mientras tanto) o `expired`; el error queda en `platform_events` |
| Cancelado | `cancelled` |

### Comportamiento

- **Mensajes en lenguaje natural**, sin aprender comandos. El asistente se presenta como una IA y no como una persona.
- **Lo que falta, se pregunta.** Por ejemplo, ante «Me llegaron 10 camisetas, 4 M y 3 L» responde: «Identifiqué 7 unidades distribuidas. Faltan 3 para completar las 10 que mencionaste. ¿Qué talla corresponde a esas 3 unidades?». No reparte unidades ni elige productos por su cuenta.
- **Correcciones sin reiniciar**: «las M son 5, no 3» o «la talla es 39, no 38». La propuesta anterior se cancela sin aplicarse y se muestra la corregida.
- **Cambio de tema**: si hay un producto a medio crear, pregunta antes de dejarlo. Una propuesta sin confirmar se descarta y se avisa.
- **Productos**:
  - Crear: «Créame unas sandalias negras Guess talla 38 y 39 a 80 mil» muestra un resumen, pide solo las unidades por talla («2 y 3» o «2 de cada una») y avisa si el producto ya parece existir.
  - Buscar y consultar existencias: «¿cuántas sandalias me quedan?».
  - Cambiar nombre, descripción, categoría y precio, incluido «súbele 10 mil» o un porcentaje.
  - Ocultar o reactivar, obtener el enlace público, quitar una foto, crear variantes y registrar entradas, salidas y ajustes.
- **Botones de contexto**: Confirmar, Cancelar, Ver producto (página pública), Abrir panel (`/admin/products`) y Ayuda.
- **Comandos de respaldo**: `/start`, `/ayuda`, `/productos`, `/inventario`, `/pedidos`, `/resumen` (nuevo, con datos reales) y `/cancelar`. Los demás comandos siguen igual.
- **Pedidos**: se conservan los listados, el detalle y los cambios de estado confirmados que ya existían. No se inventan pagos, entregas ni estados.
- **Sin IA**: todo lo anterior funciona igual, porque es determinista. Si la IA falla o no tiene presupuesto, se usan las reglas.
- **Retención**: el estado de la conversación vence a los 30 minutos y la memoria de mensajes (`assistant_messages`) se borra a los 7 días. Las sesiones van por usuario de Telegram y tienda activa, y cada entorno usa su propia base de datos.

## 3. Pruebas

| Tipo | Resultado |
|---|---|
| Servidor completo | **340/340** pruebas, incluidas las 321 anteriores, que siguen pasando. |
| Conversación (`commerce.conversation.test.ts`) | 21 pruebas. Cubren errores de escritura, cantidades incompletas, productos ambiguos, variantes inexistentes, inventario negativo, cambios simultáneos, operaciones canceladas, reintento del webhook, doble confirmación, permisos (un vendedor no puede tocar el inventario), botones de otra tienda, caída de Telegram después de confirmar, caída de la IA, respuesta inválida de la IA, creación de producto, quitar foto, cambio de tema y los comandos anteriores. |
| Staging de punta a punta | **30/30** comprobaciones con el servidor y la base reales de staging (`ca322129`), a través del webhook con su secreto. Se usó una tienda y unos usuarios ficticios creados para la prueba y eliminados al final. La otra tienda de staging no cambió. |

Cuando Telegram falla al entregar un aviso intermedio («corrijo la propuesta», «vamos a registrarlo»), la operación ya no se interrumpe. Este fallo apareció en la prueba de staging y quedó corregido.

## 4. En producción (2026-11-05, autorizado)

| Paso | Resultado |
|---|---|
| Servidor | `catalogo-lite-api`: `501b02d3` → `87e31055-c570-4906-abd3-e8f3e7dc3a25`. Sin migración. El panel no cambió. |
| Verificación | La salud responde 200. Los 10 secretos siguen intactos. Ambos webhooks rechazan con 403 si no llevan su secreto. Los datos no cambiaron: 4 tiendas, 161 productos, 690 variantes, 14 pedidos y 3 usuarios. No hubo errores nuevos. No se enviaron mensajes de prueba a tiendas reales. |
| Commit | `ef01034` |
| Reversión | Volver a la versión `501b02d3` del servidor. |

## 5. Pendiente de autorización

- **Nombre y descripción visibles del bot en Telegram** (`setMyName`, `setMyDescription`, `setMyCommands`). Cambian la configuración del bot y requieren tu autorización. Hoy el asistente ya se presenta como Asistente TiendIA dentro de sus mensajes.
