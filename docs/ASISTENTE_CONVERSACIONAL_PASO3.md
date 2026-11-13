# Asistente TiendIA · capa conversacional · Paso 3: pedidos y reportes dentro de la conversación

Estado al 2026-11-13: **en STAGING** (Worker `__VERSION__`), rama `feat/asistente-conversacional`, sin push, sin
merge, producción y `main` intactos. Pedidos encendidos solo en las tiendas ficticias 1 y 94. Sin migraciones nuevas.
Paso 4 (marketing y Fábrica de Publicidad) no empezado.

## Alcance (definido en esta sesión)

El texto original del paso 3 no estaba disponible: en el repositorio solo decía «Pedidos y reportes». El alcance se
definió con el mismo molde de los pasos 1 y 2 y **queda sujeto a tu revisión**:

- **Consultas** en lenguaje natural: cómo van los pedidos, pedidos en curso o por estado, por enviar / en tránsito,
  un pedido por código, «el último», «el 2» de la lista, «ese».
- **Reportes**: pedidos recibidos y ventas confirmadas de hoy, ayer, esta semana, este mes, el mes pasado o los
  últimos N días; lo más vendido.
- **Cambios** con confirmación escrita: confirmar, alistar, despachar (con transportadora y guía), entregar (con la
  forma de entrega), cancelar y marcar el pago como verificado.
- **Fuera del alcance** (siguen por su flujo de siempre, sin tocar): guías con foto, correcciones de guía, reversar
  estados, avisos al cliente, datos de contacto del cliente, reportes de rotación, clientes frecuentes y rentabilidad.

## Resumen de una página

**Qué cambia para el comerciante.**

- Pregunta como habla y recibe una respuesta corta con cifras reales: «cómo van los pedidos» → «Pedidos en curso: 1
  pendiente de confirmar · 1 confirmado · 1 en preparación · 1 enviado. Hoy llegaron 2 pedidos.»
- **Recibido no es venta**: los reportes separan siempre pedidos recibidos de ventas confirmadas («2 pedidos
  recibidos por $340.000. 1 ya es venta confirmada ($160.000) · 1 espera tu confirmación y todavía no cuenta como venta»).
- Contexto: lista → «el 1» → «confírmalo» → «sí». «El último pedido» → «ya pagó» → «dale».
- Confirma escribiendo («sí», «dale», «hágale», «listo»), no solo con el botón.
- Pregunta solo lo que falta: al despachar, la transportadora y la guía; al entregar sin transportadora, cómo se entregó.
- Una frase completa basta: «el pedido X ya salió por Servientrega guía 7000…» → una sola confirmación.
- Una pregunta no es una orden: «¿ya se envió el pedido X?» muestra el pedido, no propone despacharlo.

**Cómo está hecho.** Un módulo nuevo, `worker/src/services/assistant/agent/orders.ts`, que solo entiende a qué
pedido y a qué acción se refiere el mensaje. Las lecturas usan las funciones de pedidos existentes; los cambios se
aplican llamando al mismo manejador del flujo anterior (`handleOrderCallback` → `transitionOrder`), con sus
validaciones de rol, revisión concurrente, transición válida, reserva de inventario y auditoría. No se reescribió
nada del flujo de pedidos ni de guías.

Orden de lectura: reglas deterministas → modelo (solo si el mensaje nombra pedidos o ventas y las reglas no lo
resuelven; solo elige una herramienta) → si nada aplica, el mensaje sigue su camino normal.

**Herramientas** (`ORDER_TOOLS`, mismo estilo de registro): `ver_pedido`, `listar_pedidos`, `resumen_pedidos`,
`reporte_periodo`, `mas_vendidos` (lecturas, cualquier miembro de la tienda) · `cambiar_estado_pedido`,
`marcar_pago` (cambios, exigen el permiso de gestionar pedidos y confirmación).

**Seguridad.**
- Ningún cambio se aplica sin un «sí» del propio comerciante. El modelo nunca confirma, y si propone un cambio que
  el comerciante no pidió con sus palabras, no se propone nada (hay prueba).
- Un cambio propuesto caduca a los 10 minutos y **se descarta si el comerciante cambia de tema**: un «sí» posterior
  sobre otra cosa nunca lo aplica (hay prueba).
- «Cancela» o «confírmalo» sin nombrar un pedido, con un cambio de catálogo esperando, es de ese cambio, no del pedido.
- Aislamiento: todo se consulta por tienda; el pedido de otra tienda no se ve ni se cambia.
- Los datos de contacto del cliente (nombre, teléfono, dirección) no se muestran en el chat; siguen en el panel. El
  texto dentro de un pedido es dato: un nombre de cliente con instrucciones no cambia nada (hay prueba).
- Idempotencia: la confirmación entregada tres veces por el canal aplica una sola vez.

**Interruptor.** `ASSISTANT_ORDERS_STORE_IDS` (ids separados por coma; vacío = apagado; `*` = todas),
independiente de los de texto y multimedia. Apagado por defecto: los pedidos van por el flujo anterior (hay prueba
en Telegram y en WAHA). `ASSISTANT_TZ_OFFSET_HOURS` (por defecto −5) define qué es «hoy» para los reportes.

## Resultados

__RESULTADOS__

## Conversaciones antes / después (mismo guion)

| Mensaje | Antes | Después |
|---|---|---|
| «cuántos pedidos llegaron hoy» | «No pude entender bien la solicitud…» | «Hoy: 2 pedidos recibidos por $340.000 COP. 1 ya es venta confirmada ($160.000 COP) · 1 pedido espera tu confirmación ($180.000 COP) y todavía no cuenta como venta.» |
| «cuánto vendí en los últimos 7 días» | «No encontré el producto últimos días…» | «En los últimos 7 días: ventas confirmadas por $375.000 COP en 3 pedidos. Además: 1 pedido espera tu confirmación… · 1 cancelado.» |
| «qué pedidos tengo pendientes» → «el 1» → «confírmalo» → «sí» | «No encontré el producto pedidos pendientes» y tres veces «No pude entender» | lista numerada → detalle → «Pedido 2C519873 (1 u. · $180.000 COP): Pendiente → Confirmado. Se reservan las existencias… ¿Confirmas?» → «✅ El pedido 2C519873 quedó como Confirmado.» |
| «despacha el pedido X» → «Coordinadora 12345678» → «sí» | pregunta y anota la guía, pero el «sí» escrito responde «No hay nada pendiente por confirmar» (hay que tocar el botón) | pregunta transportadora y guía → «…En preparación → Entregado a transportadora. Sale con Coordinadora · guía 12345678… ¿Confirmas?» → «✅ … quedó como Entregado a transportadora» |
| «marca el pedido X como entregado» → «lo recogió en la tienda» → «listo» | «¿Cómo se entregó…?» y luego «No pude entender» dos veces | «¿Cómo se entregó…? Por transportadora, entrega personal, retiro en tienda o mensajero.» → «…Entrega: retiro en tienda. El estado del pago no cambia. ¿Confirmas?» → «✅ … Entregado. El pago sigue como estaba.» |

## Lo que NO se pudo comprobar

__NO_COMPROBADO__

## Riesgos y decisiones

1. **El alcance lo definí yo** (ver arriba). Si el paso 3 original pedía otra cosa (por ejemplo avisos al cliente o
   reportes distintos), falta.
2. **«Hoy» usa UTC−5 para todas las tiendas** (variable global). El flujo anterior de «despachados hoy» usa UTC; no se tocó.
3. **Los reportes cuentan el valor de los productos menos el descuento, sin envío**, igual que los reportes existentes.
   «Venta» = pedido de confirmado en adelante; los cancelados no cuentan.
4. **Lo más vendido agrupa por nombre de producto** tal como quedó en el pedido; si un producto cambió de nombre
   aparece dos veces.
5. Las listas muestran hasta 8 pedidos (las consultas existentes traen 10 o 15); el resto se remite al panel.
6. Si la aplicación del cambio falla (otra persona lo cambió, no hay existencias), se muestra el mensaje del motor
   y no se cambia nada; el detalle largo del pedido que el flujo anterior enviaba después no se reenvía.
7. La capa responde antes que la de texto: un mensaje que nombre «pedido» o «ventas» y además pida algo de catálogo
   lo intenta primero esta capa. Las pruebas cubren «vendí 2 de la 38…» (inventario) y precios; frases mixtas no.
8. El resumen del flujo anterior («📈 Resumen de pedidos · últimos 30 días») ya respondía «cómo van los pedidos»; el
   banco lo marca como fallo solo porque espera el formato corto con los pedidos de hoy.

## Reversión

- **Apagar solo pedidos (sin código nuevo):** desde `worker/`,
  `npx wrangler deploy -c wrangler.remote-staging.toml --keep-vars --var ASSISTANT_ORDERS_STORE_IDS:` (vacío).
  Desde el siguiente mensaje los pedidos vuelven al flujo anterior; texto y multimedia siguen igual. No hay datos que limpiar.
- **Volver al Worker del paso 2:** `npx wrangler rollback 46662eff-156b-4820-88fd-c91494e528b7 -c wrangler.remote-staging.toml`.
- **Esquema:** nada que revertir (este paso no tiene migraciones).
- Producción: nada que revertir.

## Cómo probar en staging (tiendas ficticias 1 y 94)

Con al menos un pedido de prueba en la tienda: «cómo van los pedidos» · «cuántos pedidos llegaron hoy» · «cuánto
vendí esta semana» · «qué pedidos tengo pendientes» → «el 1» → «confírmalo» → «sí» · «el último pedido» → «ya pagó»
→ «no» · «despacha el pedido <código>» → «Servientrega 700012345678» → «sí» · «qué es lo más vendido».

Repetir el banco: `npx vitest run src/services/assistant/agent/bank/orders.bank.test.ts` (modelo simulado) ·
`BANK_REAL=1 GEMINI_API_KEY=… ORDERS_BANK_OUT=<carpeta> BANK_RUN=1 npx vitest run …/orders.bank.test.ts` ·
`node scripts/agent-orders-bank-runs.mjs <carpeta> --fallos`.
