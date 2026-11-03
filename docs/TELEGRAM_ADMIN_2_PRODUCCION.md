# Telegram Admin 2.1 — estado de producción

## Alcance de esta entrega

Se implementó un menú inline de Telegram para consultas y para iniciar cambios de nombre comercial, color principal, título de portada y WhatsApp. Se conserva el mecanismo existente para cambios de precio y stock. Las propuestas de escritura tienen vista previa en Telegram, expiración de 15 minutos y botones específicos de confirmar/cancelar. No se cambió el webhook ni se hizo despliegue remoto.

El menú solo procesa callbacks de un usuario cuyo ID numérico coincide con el propietario vinculado/configurado, en chat privado. El webhook sigue validando `X-Telegram-Bot-Api-Secret-Token`, aplicando rate limit y deduplicación de `update_id`. Los botones de consulta no ejecutan mutaciones.

## Matriz panel → endpoint → Telegram

| Funcionalidad del panel | Endpoint/servicio actual | Telegram Admin 2.0 | Estado y prueba |
|---|---|---|---|
| Inicio y estadísticas | `GET /api/admin/stats` (panel); consultas D1 | `/estado`, Reportes | Lectura implementada; `telegram.process.test.ts` |
| Listar/buscar productos | `GET /api/products`; CRUD `POST/PUT/DELETE /api/admin/products` | `/productos`, botón Productos; lenguaje natural existente para lecturas | Lista limitada a 10. Búsqueda paginada, creación y edición por bot pendientes |
| Inventario y variantes | `PUT /api/admin/products/:id/variants` | Consulta de stock; propuestas confirmadas para actualizar precio/stock | Precio/stock son las únicas mutaciones Telegram aplicadas de forma atómica. Variantes y lotes pendientes |
| Categorías | `GET /api/categories`; CRUD `/api/admin/categories` | `/categorias`, botón Categorías | Consulta implementada. Altas/edición/borrado pendientes |
| Pedidos | `GET /api/orders`, `GET /api/orders/:id`, `PATCH /api/orders/:id` | Últimos pedidos y filtro de pendientes, sin PII de comprador | Lectura resumida implementada. Detalle, fotos, notas y cambios de estado pendientes |
| Apariencia | `GET /api/store`; `PUT /api/admin/store`; `POST /api/upload/image`; shared `updateStoreConfiguration` | Botón Apariencia propone color y título | Nombre/color principal/título confirmables desde Telegram; título en `theme_config.hero.title`, color en `theme_config.style.palette.primary` y `primary_color`. Las fotos y reversión siguen pendientes |
| Configuración | `GET /api/store`; `PUT /api/admin/store`; shared `updateStoreConfiguration` | Botón Configuración propone nombre y WhatsApp | Escritura confirmable de nombre y WhatsApp. Ambos campos se vuelven a leer de D1 tras guardar |
| Vinculación Telegram | `POST /api/admin/telegram/link-code`, `GET /api/admin/telegram/status`, `/api/telegram/webhook` | Vinculación de un solo uso existente | Reutilizado; no se modificó el webhook |
| Clientes | Sin módulo/API de clientes independiente | Botón informa que no está disponible | No implementado; no se inventó un módulo |
| Fotos de productos/tienda | `POST /api/upload/image` (administrador web) y R2 | Telegram responde que recepción de fotos no está habilitada | Pendiente: descarga oficial, validación por contenido, borrador R2/D1 y confirmación |
| Promociones | Sin acción/endpoint de promociones identificado | No disponible | Pendiente de soporte real en el panel/backend |

## Funciones implementadas

- Menú inline: Mi tienda, Productos, Inventario, Pedidos, Apariencia, Categorías, Reportes, Configuración, Clientes y Ayuda.
- Callback `callback_query` procesado con autorización de propietario y chat privado; los callbacks de usuarios distintos no generan respuesta ni consulta.
- Resúmenes de tienda, apariencia y configuración; totales de inventario; pedidos recientes/pendientes sin nombre, teléfono, correo ni dirección del comprador.
- Escape de contenido de base de datos antes de enviar HTML de Telegram.
- Menú de pedidos separa pendientes y todos.
- Las cuatro acciones mutables nuevas: `update_store_name`, `update_store_colors` (solo principal), `update_hero_title` y `update_whatsapp`.
- Botones específicos Vista previa, Confirmar y Cancelar por `operation_id`; la vista previa reporta el cambio propuesto sin tocar el storefront.
- Escrituras de tienda usan `applyConfirmedStoreMutation` en el servicio compartido de negocio: allowlist de columnas, verificación del snapshot anterior, claim de una operación pendiente, un batch D1 con actualización/auditoría/estado final y rechazo de repetición o conflicto.
- El título y el color se guardan en las propiedades consumidas por React. WhatsApp exige prefijo internacional y actualiza `whatsapp_phone` más `whatsapp_orders` sin tocar la identidad Telegram.
- Para SneakerHub, el nombre se persiste en `store_config.name`; color en `theme_config.style.palette.primary` y compatibilidad `primary_color`; el título visible en `theme_config.hero.title`; WhatsApp comercial en `whatsapp_phone`/`whatsapp_orders`. El storefront vuelve a leer los valores por `GET /api/store`; el panel los refleja al recargar su configuración.
- Lenguaje natural determinista reconoce nombres comerciales, títulos y una lista cerrada de colores comunes; Gemini solo entrega acciones Zod permitidas y texto/voz continúan el mismo flujo de confirmación.
- Las opciones de Apariencia y Configuración del menú pueden iniciar las cuatro acciones.

## Funciones pendientes

- Flujo conversacional de alta/edición de producto, preguntas por campos faltantes, variantes, categorías y publicación atómica.
- Gestión de fotos desde Telegram, guardado propio por tienda en R2 y asociación confirmada en D1. El bot actualmente rechaza fotos sin guardarlas.
- Vista previa visual dentro del storefront, edición del borrador antes de confirmar y reversión. Hoy la vista previa es un resumen textual en Telegram; no cambia el sitio público antes de confirmar.
- Detalle de pedidos (incluidas imágenes e instantáneas de precio/variante), notas internas, transiciones de estado por Telegram y alertas de pedidos nuevos.
- Otras ediciones de ajustes de tienda, operaciones de categoría, archivado/restauración y destacados por Telegram.
- Módulo de clientes y promociones: no existe soporte backend comprobado.
- Flujos de consentimiento/confirmación reforzada para operaciones críticas y cobertura de concurrencia integral para nuevas mutaciones.
- Aislamiento multi-tienda: el Worker/D1 actual usa `store_config.id = 1` y no incluye `tenant_id`. Una instalación individual por Worker/D1 está aislada por infraestructura; no equivale a multi-tenancy dentro de un Worker compartido. No activar multi-tienda hasta diseñar y probar el aislamiento.

## Endpoints/servicios añadidos

Esta entrega no añadió endpoints HTTP ni migraciones. Amplió `worker/src/services/telegram.ts` y `worker/src/routes/telegram.ts` para el teclado, callbacks y propuestas autenticadas; añadió `applyConfirmedStoreMutation` a `worker/src/services/business.ts`, utilizando el allowlist y servicio de negocio compartido con `PUT /api/admin/store`. Se amplió el catálogo Zod/Gemini con `update_hero_title` y se endureció la validación de WhatsApp.

No se genera SQL ni código desde Gemini. El modelo solo propone valores tipados y validados; el Worker autoriza, crea la operación, presenta los valores leídos de D1 y aplica la escritura confirmada.

## Pruebas locales

- Worker: `npm test` — 96 pruebas aprobadas.
- Worker TypeScript: `npx tsc --noEmit` — aprobado.
- Frontend: `npm test -- --run` — 54 pruebas aprobadas.
- Frontend build: `npm run build` — aprobado. Vite muestra el aviso existente de un chunk JavaScript mayor a 500 kB.
- Pruebas unitarias de schemas, color/nombre/título/WhatsApp desde intérprete y Gemini, propuestas sin escritura, confirmación de las cuatro acciones, snapshot concurrente, callback de vista previa/cancelación/confirmación y repetición.
- No se hicieron pruebas de integración contra D1 comercial ni el webhook real; las pruebas de persistencia de Worker usan mocks de D1. Requiere una prueba aislada no productiva antes de activar.

## Estado comercial y activación

La auditoría remota previa de solo lectura encontró la D1 comercial con migraciones 0001–0006 aplicadas y R2 comercial configurado. En el Worker comercial faltaban los nombres de secreto Telegram/Gemini requeridos y en D1 el propietario de Telegram seguía sin vincular. No se leyeron ni se escribieron secretos. Por ello, el bot no está listo para activación comercial aunque su código pase pruebas.

La instalación staging tiene secretos de nombres configurados, pero su D1 estaba pendiente de las migraciones `0005_admin_login_rate_limits.sql` y `0006_order_management.sql`. El webhook principal continuaba apuntando a staging según la revisión anterior. No se llamó a `getWebhookInfo`, `setWebhook` ni `deleteWebhook`, y no se hicieron escrituras remotas.

La auditoría remota de esta sesión intentó listar migraciones/secretos y consultar únicamente si el propietario estaba vinculado. Wrangler no pudo resolver `api.cloudflare.com` por DNS. Se verificó localmente que `wrangler.production.toml` apunta a `catalogo-lite-production-db` y `catalogo-lite-production-assets`; el estado remoto actual, los nombres de secretos y el vínculo de propietario quedan sin reconfirmar en esta sesión. No se mostraron valores de secretos.

Antes de activar Entrega A:

1. Rotar los tokens locales con advertencia de exposición y guardarlos como secretos del Worker, nunca en Git ni en variables `VITE_*`.
2. Aplicar y verificar en una ventana autorizada las migraciones pendientes del entorno que se vaya a usar; comprobar D1 y R2 destino mediante configuración y consultas de solo lectura.
3. Configurar en el Worker comercial los secretos Telegram, webhook y propietario, además de Gemini si se desea interpretación de lenguaje natural/voz. Vincular al propietario desde el panel con un código de un solo uso.
4. Desplegar y verificar el Worker comercial en una ventana separada. Solo después de autorizar expresamente el corte, confirmar el destino del webhook y cambiarlo; no reutilizar el bot en staging y producción al mismo tiempo.
5. Ejecutar pruebas en un entorno aislado con productos de prueba; no modificar inventario comercial durante verificación.

No ejecutar el paso de cambio de webhook como parte de este documento: requiere una autorización específica de corte. Esta entrega no hace `wrangler deploy`, migraciones remotas ni operaciones D1/R2.

## Seguridad de secretos

No se imprimieron valores secretos en la documentación ni en el resumen. La auditoría anterior indicó advertencias de rotación para tokens locales de Telegram. Revisar/rotar esos tokens antes del corte; cualquier credencial histórica expuesta debe rotarse en su proveedor y eliminarse del historial mediante un procedimiento separado autorizado. No se debe asumir que hacer privado el repositorio protege credenciales.

## Próximas etapas

**Entrega A:** validar entorno comercial, migraciones, secretos, propietario, pruebas aisladas y Worker; autorización explícita antes del cambio de webhook.

**Entrega B:** implementar por fases las funciones marcadas pendientes, con servicios compartidos con el panel, transacciones D1, optimistic concurrency, auditoría, expiración y pruebas de autorización/aislamiento. Las operaciones críticas y de archivos permanecen bloqueadas hasta contar con garantías suficientes. No declarar paridad completa antes de cubrir todas las filas de la matriz.
