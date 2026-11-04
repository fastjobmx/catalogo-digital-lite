# Plataforma de comercio inteligente — auditoría y fases

Auditoría del repositorio el 2026-11-04 (commit base `a69c40f`, producción `226aef4e`). Estados: ✅ implementado y verificado · 🟡 parcial · ⬜ ausente.

## 1. Matriz de funcionalidades

| Módulo | Estado antes | Qué existía | Qué faltaba |
|---|---|---|---|
| **Multitienda en Telegram** | ✅ | Membresías por ID numérico, selector `/tiendas` y `/cambiar_tienda`, tienda activa por cuenta, pendientes cancelados al cambiar, botones atados a su tienda, Gemini con datos de la tienda activa, tienda adicional sin duplicar la cuenta. | SneakerHub sigue reconocida por el dueño heredado `TELEGRAM_OWNER_ID` y no por una membresía (recomendado convertirla; ver §4). |
| **1. Productos con Gemini** | ✅/🟡 | Fotos múltiples → nombre, descripción, categoría y colores visibles. Precio, tallas y existencias se preguntan. Vista previa y ✅ Guardar / ✏️ Editar / ❌ Cancelar. SKU único, idempotencia y voz. Tallas con letras y rangos. | Detección de productos *parecidos* (posible duplicado con otro SKU) y edición de variantes ya publicadas por voz. |
| **2. Pedidos** | 🟡 → ✅ | Estados recibido → confirmado → en preparación → despachado → entregado / cancelado. Transiciones válidas, revisión optimista, historial (`order_events`), reserva y liberación de existencias por triggers. Todo solo en el panel web. | Gestión desde Telegram, aviso de pedidos nuevos, transportadora y guía, fechas de despacho y entrega. **Hecho en la Fase 2.** |
| **3. Inventario** | 🟡 → ✅ | Stock por variante (talla, color) y SKU. Cambios confirmados en Telegram. Consultas de poco stock y agotados. | Libro de movimientos con motivos, bloqueo de inventario negativo y alertas al cambiar stock. **Hecho en la Fase 2.** Pendiente: *presentación* y *ubicación* (bodega). |
| **4. Inteligencia comercial** | 🟡 | Resumen por estado, ventas confirmadas (solo desde “confirmado”), más vendidos, poco stock y consejos deterministas. | Productos sin movimiento (ahora posible con el libro), clientes recurrentes y rentabilidad. Esta última requiere costos confiables, que hoy no existen. |
| **5. Marketing** | ⬜ | Solo productos destacados. | Cupones, promociones, campañas con consentimiento y aprobación, y medición. El checkout ya reserva `discountTotal` en 0. |
| **6. Empleados** | 🟡 | Roles propietario, administrador y operador, con auditoría. | Roles vendedor y encargado de inventario, e invitaciones desde Telegram. |
| **7. Entregas** | 🟡 → ✅ | Dirección, ciudad, método y costo de envío del pedido. | Transportadora, guía, fecha de despacho y de entrega. **Hecho en la Fase 2.** Sin seguimiento automático: no hay integración con transportadoras. |
| **8. Administración SaaS** | 🟡 | Bot maestro y `/plataforma`: tiendas, propietarios, planes, servicios, consumo y presupuesto de Gemini, suspensión y reactivación, salud técnica, dominios (tabla) y purga de pruebas. | Facturación y cobros, límites de plan aplicados (`max_products`), gestión de dominios propios y renovaciones. |

## 2. Dependencias y orden

1. **Multitienda** (base de autorización) → todo lo demás.
2. **Pedidos e inventario** (Fase 2) → inteligencia comercial (productos sin movimiento, rotación), entregas y alertas.
3. **Roles de empleados** (Fase 4) → antes de abrir pedidos e inventario a vendedores o bodegueros.
4. **Inteligencia comercial** (Fase 3) → usa el libro de movimientos y los estados de pedido.
5. **Marketing** (Fase 5) → necesita clientes con consentimiento registrado y descuentos en el checkout.
6. **SaaS** (Fase 6) → límites y facturación sobre planes y servicios existentes.

## 3. Fases completadas

### Fase 1 — Multitienda (en producción desde `ebf20122`)

Verificado con lecturas en producción: tu cuenta tiene membresía de propietario en Muy Parcero, más SneakerHub por el dueño heredado, y la tienda activa es Muy Parcero (9 productos). Pruebas: `multistore.test.ts` (12 escenarios) y staging 16/16. Detalle en `docs/MULTITIENDA_TELEGRAM.md`.

### Fase 2 — Pedidos, entregas e inventario (staging; producción pendiente de autorización)

**Pedidos en Telegram:**
- `/pedidos` o “🛒 Consultar pedidos” muestra los pedidos en curso, con filtros por estado.
- Cada pedido muestra artículos, totales, entrega, guía y estado de pago. Los datos de contacto del comprador siguen solo en el panel.
- Botones de las transiciones válidas, siempre con confirmación (“¿Cambio el pedido … a Confirmado?”).
- Lenguaje natural: “confirma el pedido AB12CD34”, “despacha el pedido …”, “el pedido … fue entregado”, “el pedido … ya pagó”.
- Despacho con transportadora y guía (“Servientrega 123456789”). Se aclara que no hay seguimiento automático.
- **“Recibido” no es una venta:** es la solicitud por WhatsApp. El resumen de ventas cuenta solo desde “Confirmado”; el pago se verifica aparte (“💳 Marcar pago verificado”).
- **Protecciones:** botón viejo o pedido modificado por otra persona → no se aplica (revisión). Transición no permitida → rechazada. Sin existencias suficientes → no se confirma. Pedido de otra tienda → no se muestra ni se modifica (ofrece cambiar de tienda si tienes acceso). Pueden gestionarlos el propietario, el administrador y el operador.
- **Aviso de pedido nuevo:** al equipo de la tienda (membresías activas con Telegram, más el dueño heredado de la tienda 1), sin datos del comprador.

**Panel web:** campos de transportadora y número de guía en el detalle del pedido. La fecha de despacho y la de entrega se registran solas.

**Inventario:**
- Migración `0009`: tabla `inventory_movements` (entrada, salida, ajuste, pedido, pedido cancelado) con existencias antes y después, motivo, referencia y responsable.
- Un trigger registra **todo** cambio de stock, venga de donde venga. Otro trigger impide existencias negativas.
- Telegram:
  - “Llegaron 10 unidades de CAM-1 talla M por compra al proveedor”.
  - “Se dañaron 2 unidades de CAM-1 talla L”.
  - “Salida de 3 … por muestra”.
  - Antes de aplicar se calcula el nuevo stock y se pide confirmación.
  - Una salida mayor que el stock se rechaza.
  - Avisa cuando quedan 3 unidades o menos.
- “Muéstrame los movimientos de inventario de CAM-1”.

**Pruebas:**
- Worker **229/229** (`commerce.test.ts` con 11 escenarios de pedidos e inventario) y frontend **67/67** con build.
- `0009` verificada sobre copias de staging y de producción: 18 tablas con datos idénticos, integridad correcta y 0 violaciones de claves foráneas, también tras la reversión.
- Staging (`c2ca4381`, prueba de escritura 18/18 sobre una tienda ficticia eliminada al final):
  - Confirmación con reserva única; un botón viejo no repite la reserva.
  - Movimiento “pedido” registrado.
  - Despacho con guía e historial de estados.
  - Entrada con motivo; salida excesiva rechazada.
  - Tienda principal de staging idéntica.

**Publicación (requiere autorización):**
1. Respaldo de producción y `0009` (solo agrega).
2. Despliegue del Worker.
3. **Después**, push a `main` para que Netlify publique el panel. El panel nuevo envía transportadora y guía; el Worker actual rechaza esos campos, así que el orden importa.

Reversión: Worker anterior + `database/rollback/0009_orders_inventory.down.sql`.

### Fase 3 — Inteligencia comercial (staging)

Consultas tipificadas de solo lectura. Gemini solo elige la acción y el servidor calcula con datos de la tienda activa; no hay SQL libre.

- **Ventas por día, semana o mes** (“ventas por semana”): solo pedidos confirmados, con descuentos ya restados.
- **Productos sin movimiento** (“¿qué productos no se han vendido?”): sin ventas confirmadas en 60 días. Los productos nuevos se excluyen.
- **Rotación por talla** (“¿qué tallas se venden más?”).
- **Clientes recurrentes**: solo con 5 o más compradores; teléfonos enmascarados (•••1234).
- **Rentabilidad**: se niega a calcularla porque no hay costos registrados; no inventa cifras.
- El resumen de pedidos muestra “Recibido (sin confirmar)” aparte de las ventas.

### Fase 4 — Empleados (staging)

- **Roles nuevos:**
  - **Vendedor:** gestiona pedidos y consultas.
  - **Encargado de inventario:** gestiona existencias y movimientos.
  - **Operador:** pedidos e inventario; sin cambios para quienes ya lo tienen.
- Se suman a propietario y administrador.
- **Permisos explícitos** (`can(role, capability)`) además de la jerarquía:
  - Un vendedor no cambia stock y un encargado de inventario no gestiona pedidos, ni en Telegram ni en el panel (`PATCH /api/orders` → 403).
  - Cupones y campañas solo para propietario y administrador.
- **`/equipo` en Telegram:**
  - Lista del equipo.
  - Invitación con el rol mínimo, mediante un enlace o código `/link` de un solo uso que vence en 72 h; solo se guarda el hash.
  - Quitar acceso con confirmación; también invalida los códigos pendientes de esa persona.
  - Todo queda auditado.
- **Al vincularse:** si la persona ya tiene cuenta, se le agrega la tienda y se retira la cuenta provisional de la invitación.
- **API del panel:** `POST /api/admin/team` acepta los roles nuevos.
- **Migración `0010`:** reconstruye `store_memberships` para ampliar la restricción de roles. Sobre copias de staging y de producción, filas idénticas e índice recreado.

### Fase 5 — Marketing con consentimiento (staging)

- **Cupones:**
  - Por Telegram: “crea un cupón VERANO10 de 10% hasta el 31/12, máximo 50 usos”, con vista previa y confirmación.
  - `/cupones` para la lista, resultados y desactivación.
  - Porcentaje de 1 a 90 o valor fijo, con mínimo de compra, vigencia y límite de usos.
- **Checkout:**
  - Campo de cupón con vista previa (`POST /api/orders/coupon`).
  - El servidor vuelve a validar el cupón con los precios del catálogo y respeta el límite de usos aunque haya pedidos simultáneos.
  - El descuento queda en `discount_total`.
- **Consentimiento:** casilla **sin marcar por defecto** (“Quiero recibir promociones… puedo darme de baja”). Solo con la casilla marcada se guarda el contacto.
- **Bajas:** “dar de baja 3001234567” aplica de inmediato y queda en la auditoría con el número enmascarado.
- **Campañas:**
  - Se crean en borrador con vista previa y el número de destinatarios.
  - Requieren tu aprobación. Al aprobar, se generan **enlaces de WhatsApp** para que tú los envíes a mano, solo a contactos con consentimiento y sin baja; cada mensaje incluye cómo darse de baja.
  - **La plataforma nunca envía nada por su cuenta.**
- **Resultados del cupón:** cuentan solo pedidos confirmados.
- **Recuperación:** “pedidos sin confirmar” lista las solicitudes de más de 1 día con un enlace para escribirle al cliente. No hay carritos abandonados porque el carrito no se guarda en el servidor.

### Fase 6 — Administración SaaS (staging)

- **Límite de productos del plan** (`max_products`) aplicado en el panel (409 `PLAN_PRODUCT_LIMIT`) y en Telegram.
- **Facturas:**
  - Tabla `store_invoices`, generada a partir de servicios activos (mensuales, anuales en su mes y únicos) y del precio mensual del plan. Es idempotente: no se duplican.
  - Estados pendiente → pagada o anulada; pagada y anulada son definitivos. Todo queda auditado.
  - **Sin cobros automáticos.**
- **Dominios propios:** pendiente → verificado → activo → retirado. Para activarlo, el plan debe incluir `dominio_propio`. El DNS y Netlify siguen siendo pasos manuales.
- **Alertas de consumo de IA:** tiendas sobre su umbral de aviso.
- **API de plataforma:**
  - `GET /api/platform/invoices`
  - `POST /api/platform/invoices/generate`
  - `POST /api/platform/invoices/:id/status`
  - `POST /api/platform/domains/:domain/status`
  - `GET /api/platform/ai-alerts`
- **Bot maestro:** `/facturas`, `/facturar [AAAA-MM]`, `/pagada n`, `/anular n`, `/dominio_estado`, `/consumo`. Todos los cambios piden confirmación.

**Verificación de las fases 3 a 6:**
- Worker **245/245** (`platform-phases.test.ts`, 16 escenarios) y `tsc`; frontend **67/67** con compilación correcta.
- Staging: `0010` aplicada (respaldo `.tmp/staging-0010/`), Worker `e136904a`.
- Prueba de escritura 24/25 sobre una tienda ficticia eliminada al final, sin restos y con la tienda principal idéntica. El único punto marcado es que Telegram no pudo entregar las respuestas al usuario ficticio (“chat not found”); los cálculos sí se ejecutaron.
- En staging se encontró y corrigió un error: “crea una campaña con el cupón X” se interpretaba como un cupón nuevo.

**Pendiente o fuera de alcance:**
- Inventario por presentación y por ubicación (bodega).
- Pantalla de facturas en `/plataforma`: hoy se gestionan por API y por el bot maestro.
- Cobros en línea.
- Integración de seguimiento con transportadoras.
- Envío automático de campañas: no se hará sin un canal oficial (WhatsApp Business API) y tu decisión.

## 4. Publicación de las fases 2 a 6

Producción está en el Worker `226aef4e` y la migración `0008`. Orden obligatorio:

1. Respaldo fresco de `catalogo-lite-production-db` y bookmark de Time Travel.
2. Migraciones `0009` (solo agrega) y `0010` (agrega tablas y reconstruye `store_memberships` con las mismas filas).
3. Despliegue del Worker.
4. **Después**, push a `main` (Netlify publica el carrito con cupón y consentimiento, y los campos de envío del panel). El panel y el carrito nuevos envían campos que el Worker actual rechaza.
5. Smoke test en producción y verificación de las membresías (deben seguir siendo 2, idénticas).

Reversión: Worker anterior, luego `0010_team_marketing_billing.down.sql` y `0009_orders_inventory.down.sql`, en ese orden, o Time Travel al bookmark previo.

## 5. Fases propuestas originalmente (referencia)

| Fase | Contenido | Requiere |
|---|---|---|
| 3 — Inteligencia comercial | Productos sin movimiento (30/60/90 días), rotación por talla, ventas por período y por canal, clientes recurrentes por teléfono (con datos suficientes), consultas en lenguaje natural sobre estos indicadores. | Fase 2 en producción. |
| 4 — Empleados | Roles vendedor (pedidos) y encargado de inventario (stock y movimientos), invitación por código de un solo uso, auditoría por persona. | Ninguno. |
| 5 — Marketing | Cupones y promociones en el checkout, campañas que el propietario aprueba, registro de consentimiento y baja, medición por cupón. Sin envíos automáticos. | Fase 4 (permisos) y decisión sobre el canal (WhatsApp Business o correo). |
| 6 — SaaS | Límites de plan aplicados, facturación de servicios, dominios propios, alertas de consumo de Gemini en el bot maestro. | Decisión comercial sobre cobros. |
| Mantenimiento | Convertir el dueño heredado de SneakerHub en membresía real de tu cuenta (sin tocar productos). | Autorización: modifica una membresía de producción. |
