# Prueba real en staging con el teléfono autorizado

Estado: **PENDIENTE DE EJECUTAR**. Ninguno de los 10 puntos está aprobado. Todo lo validado hasta hoy son pruebas
automáticas (webhook simulado y base en memoria, con modelo real o simulado); eso no cuenta como conversación real.

## Dónde escribir

- **Telegram (listo ahora):** el bot de Telegram de **staging**, el mismo chat donde escribiste hoy a las 8:49 a. m.
  y donde llegaron tres avisos «Nuevo pedido en Tenis Manizales». Administra la tienda ficticia 1 «Tenis Manizales».
- **WhatsApp (todavía no se puede):** WAHA está apagado (Docker Desktop no está corriendo en el PC y el túnel está
  caído). Para probar por WhatsApp hay que encender WAHA, recrear el túnel y actualizar su dirección en staging; eso
  necesita tu autorización y tu PC encendido. Ver «WhatsApp» al final.

Staging: Worker `64ad293f-c05a-4189-9d1b-68ad5409dfcc` (commit `a484fdf`), capas de texto, multimedia y pedidos
encendidas solo en las tiendas ficticias 1 y 94.

Datos ficticios preparados en la tienda 1:
- Productos: «Tenis de prueba» TEST-TRN-001 $185.000 (38: 6 · 39: 15) y «Zapatillas KINETIK Premium» DEMO-FOTO-2026
  $250.000 (38: 2 · 39: 2 · 40: 2).
- Pedidos de prueba, los tres pendientes: `B7F913FA` ($185.000) · `716D6E26` ($250.000) · `D8F63F34` ($370.000).
  Compradores ficticios («Cliente Prueba 1–3», sin correo). No se envió ningún mensaje ni correo a compradores: el
  único aviso es el de Telegram al equipo de la tienda.

## Guion por Telegram (unos 12 minutos; escribir tal cual y en orden)

| # | Qué compruebas | Envía | Debe pasar |
|---|---|---|---|
| 1 | Saludo y resumen | `Buenos días` | Saludo con cifras reales: pedidos recibidos y productos con pocas unidades |
| 2 | Inventario | `cuántos quedan de los tenis de prueba` | 38: 6 · 39: 15 |
| 3 | Existencias con confirmación | `me llegaron 5 de la 38 de los tenis de prueba` y luego `hágale` | Propone 38: 6 → 11 y pide confirmar; con «hágale» lo aplica |
| 4 | Fotos + nota de voz | **3 fotos** de cualquier producto, y luego una **nota de voz**: «estos son tenis rojos de prueba, del 38 al 40, dos de cada talla, a ciento ochenta mil» | Un solo acuse por las fotos; tras el audio, un resumen con tallas 38 a 40, 2 de cada una (6 en total), $180.000 y las 3 fotos. «Nada se publica todavía» |
| 5 | Corregir antes de guardar | `cambia el precio a 170 mil` · si pregunta el código responde `no` · en la vista previa toca **Guardar producto** | «Corregido: precio $170.000». Producto creado con 3 tallas × 2 unidades a $170.000 |
| 6 | Pedidos ficticios | `cómo van los pedidos` y luego `qué pedidos tengo pendientes` | 3 pendientes de confirmar; lista numerada con los tres códigos |
| 7 | Estado con confirmación | `el 1` · `confírmalo` · `sí` | Detalle sin datos del cliente; propone Pendiente → Confirmado; con «sí» queda confirmado |
| 8 | Dos tareas en un mensaje | `cuántos quedan de las kinetik y súbeles 5 mil` y luego `sí` | Muestra 38: 2 · 39: 2 · 40: 2 y propone $250.000 → $255.000; con «sí» lo aplica |
| 9 | Cancelar y recuperar contexto | `bájale 10 mil a los tenis de prueba` · `no, déjalo así` · `y cuántos quedan?` | No cambia el precio. La última pregunta responde sobre los tenis de prueba (38: 11 · 39: 15), sin volver a nombrarlos |
| 10 | Otras tiendas intactas | Nada que enviar | Lo verifico yo en D1: la tienda 94 y cualquier otra deben quedar idénticas |

Si algo no coincide, sigue con el punto siguiente; lo que cuenta es lo que quede registrado. Al terminar escríbeme
«listo» (y cualquier cosa rara que hayas visto).

## Cómo lo verifico (solo lectura sobre D1 de staging)

Foto inicial tomada el 2026-11-13 22:05 UTC: último turno medido 1 · auditoría 600 · mensajes 189 · eventos de
pedido 79 · movimientos de inventario 24 · operaciones 33. Tienda 94: CANARIO-001 38: 7 · TEN-BLA-3995 34: 10, 35: 5,
36: 12, 37: 8 · ZAP-BLA-3140 40: 10 · sin pedidos · auditoría 7 filas.

1. `assistant_agent_turns`: un turno por mensaje con su ruta (reglas, intérprete, modelo, multimedia, pedidos),
   herramienta, resultado, latencia real dentro de Cloudflare y tokens.
2. `audit_log` y `telegram_operations`: cada cambio aplicado (quién, qué, antes y después); lo cancelado como cancelado.
3. `products` / `product_variants`: producto nuevo a $170.000 con 38, 39 y 40 en 2; TEST-TRN-001 38 = 11; KINETIK $255.000.
4. `inventory_movements`: +5 de la reposición y la reserva del pedido confirmado.
5. `orders` / `order_events`: un pedido confirmado, dos pendientes.
6. `assistant_media_items`: 3 fotos en estado `used`; ninguna `open` huérfana.
7. Tienda 94 idéntica a la foto inicial.

Cada punto quedará como **aprobado con evidencia**, **fallido** o **no ejecutado**.

**Repetición de webhook:** no se puede provocar desde el teléfono (Telegram solo reenvía cuando el servidor no
responde). Se informará como *no probado en real*; lo que sí se revisará en D1 es que nada quedó aplicado dos veces.

## WhatsApp

Para repetir los puntos 1–9 por WhatsApp hace falta, en este orden y con tu autorización: (1) abrir Docker Desktop en
el PC; (2) levantar WAHA desde `waha-tiendia` y recrear el túnel; (3) redesplegar staging con la dirección nueva del
túnel (`WAHA_API_URL`), conservando las demás variables; (4) escribir al número del asistente de staging desde el
teléfono vinculado (hay dos vinculados: uno terminado en 3472 a la tienda 1 y otro en 2734 a la tienda 94). En
WhatsApp el punto 4 usa los lotes de fotos: enviar las fotos, escribir `listo`, y después la nota de voz.
