# Prueba real de punta a punta en staging (con el teléfono autorizado)

Estado: **PENDIENTE DE EJECUTAR**. Ninguno de los 10 puntos está aprobado: hasta que se haga desde un teléfono real,
todo lo que existe son pruebas simuladas (webhook simulado, base en memoria, modelo real o simulado).

- Canal: bot de Telegram de **staging** (el mismo con el que se escribió hoy a las 8:49 a. m.), tienda ficticia 1
  «Tenis Manizales». WhatsApp/WAHA no se puede probar hoy: Docker no está corriendo en el PC y el túnel está caído.
- Worker de staging: `dc0d73d5-4ab7-4e77-b979-45efddc42329` (commit `e3ad5df`), capas de texto, multimedia y pedidos
  encendidas solo en las tiendas ficticias 1 y 94. `COMMERCE_ENABLED=true` en staging para poder crear pedidos de prueba.
- Datos preparados (2026-11-13 20:59 UTC), todos ficticios:
  - Productos: «Tenis de prueba» TEST-TRN-001 $185.000 (38: 6, 39: 15) · «Zapatillas KINETIK Premium»
    DEMO-FOTO-2026 $250.000 (38: 2, 39: 2, 40: 2).
  - Pedidos de prueba creados por la ruta real de la tienda, los tres pendientes: `B7F913FA` (1 × Tenis de prueba 39,
    $185.000) · `716D6E26` (1 × KINETIK 40, $250.000) · `D8F63F34` (2 × Tenis de prueba 39, $370.000).
- Foto inicial de D1: último turno medido 1 · auditoría 600 · fotos en espera 0 · movimientos de inventario 24 ·
  eventos de pedido 79 · operaciones 33 · mensajes 189.

## Guion (escribir tal cual, en este orden; ~15 minutos)

Cada bloque dice qué se envía y qué debe pasar. Si algo no coincide, seguir con el siguiente bloque y anotarlo: lo que
importa es lo que quede registrado.

| # | Qué probar | Qué enviar | Qué debe pasar |
|---|---|---|---|
| 1 | Saludo y resumen real | `Buenos días` | Saludo con cifras reales de la tienda (pedidos recibidos, productos con pocas unidades). Nunca «ventas» inventadas |
| 2 | Productos e inventario | `qué productos tengo` · `cuántos quedan de los tenis de prueba` · `y de las kinetik?` | Lista de los 2 productos; luego 38: 6 · 39: 15; luego 38: 2 · 39: 2 · 40: 2 |
| 3 | Fotos + voz en una operación | Enviar **3 fotos** de cualquier producto (juntas) y luego una **nota de voz**: «estos son tenis rojos de prueba, del 38 al 40, dos de cada talla, a ciento ochenta mil» | Un solo acuse por las fotos. Tras el audio: «Entendí…» y un resumen con tallas 38 a 40, 2 de cada una (6 en total), $180.000 y las 3 fotos. «Nada se publica todavía» |
| 4 | Corrección de precio y tallas | `cambia el precio a 170 mil` · `del 38 al 41, tres de cada una` | «Corregido: precio $170.000…» y luego tallas 38 a 41, 3 de cada una (12 en total). Nada publicado |
| 5 | Confirmación y creación | Responder lo que pregunte (código: `no`), y en la vista previa tocar **Guardar producto** | Producto nuevo en la tienda con 4 tallas × 3 unidades y precio $170.000 |
| 6 | Reposición | `me llegaron 5 de la 38 de los tenis de prueba` → `hágale` | Propone 38: 6 → 11 y pide confirmar; con «hágale» lo aplica |
| 7 | Pedidos reales de prueba | `cómo van los pedidos` · `qué pedidos tengo pendientes` · `el 1` | 3 pendientes de confirmar; lista numerada con los tres códigos; detalle del primero sin datos del cliente |
| 8 | Cambio de estado con confirmación | `confírmalo` → `sí` · luego `el pedido 716D6E26 ya pagó` → `no` | El primero pasa a Confirmado y se reservan existencias. El pago de 716D6E26 **no** cambia |
| 9 | Varias instrucciones | `cuántos quedan de las kinetik y súbeles 5 mil` → `sí` · luego `cómo van los pedidos y cuántos quedan de los tenis de prueba` | Muestra existencias y propone $250.000 → $255.000; con «sí» lo aplica. El segundo mensaje responde las dos cosas |
| 10a | Cancelación | `bájale 10 mil a los tenis de prueba` → `no, déjalo así` · luego `deshaz eso` | No cambia el precio. «Deshaz eso» propone revertir el último cambio aplicado (la subida de las KINETIK); responder `no` |
| 10b | Recuperación ante errores | `confirma el pedido ZZ99ZZ99` · `despacha el pedido D8F63F34` → `olvídalo` | «No encontré el pedido…» con la lista. El despacho pregunta la transportadora (o dice que no puede pasar de Pendiente a despachado) y no cambia nada |

**Lo que NO se puede probar desde el teléfono:** la repetición del webhook (punto 10). Telegram solo reenvía un
mensaje cuando el servidor no responde; no hay forma de provocarlo a mano. Se comprobará de dos maneras, y así se
informará: (a) en D1, que ningún mensaje del guion quedó aplicado dos veces; (b) la prueba automática existente
(misma confirmación entregada tres veces → un solo cambio), que es simulada.

## Cómo se verificará (lo hace Claude al terminar, solo lectura sobre D1 de staging)

1. `assistant_agent_turns` (id > 1): un turno por mensaje, con ruta (`rule`/`parser`/`model`/`media`/`orders`),
   herramienta, resultado, latencia real dentro de Cloudflare y tokens.
2. `audit_log` (id > 600) y `telegram_operations`: cada cambio aplicado con quién, cuándo y qué; los cancelados como cancelados.
3. `products` / `product_variants` de la tienda 1: producto nuevo con 4 tallas × 3; TEST-TRN-001 38 = 11; KINETIK $255.000.
4. `inventory_movements` (id > 24): reposición +5 y reserva del pedido confirmado.
5. `orders` / `order_events` (id > 79): un pedido confirmado, los otros dos pendientes, pago de 716D6E26 sin cambio.
6. `assistant_media_items`: 3 fotos en estado `used` ligadas al borrador; ninguna `open` huérfana.
7. Tienda 94 y cualquier otra: sin cambios.

Cada punto del guion quedará como **aprobado con evidencia**, **fallido** o **no ejecutado**. Nada se dará por
aprobado sin su fila en D1.
