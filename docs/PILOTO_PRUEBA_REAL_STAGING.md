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

---

## Resultado de la prueba real (verificado en D1 de staging el 2026-11-16, solo lectura)

La prueba se ejecutó por Telegram el **2026-11-13 entre 22:09 y 22:17 UTC** (tienda 1) y hubo una segunda sesión
libre el 2026-11-15 00:54–01:06 UTC en la tienda ficticia 95. 25 mensajes medidos después de la foto inicial.
Evidencia: `assistant_agent_turns` 2–26, `audit_log` 601–604 y 613, `telegram_operations` (4 aplicadas, 0 repetidas),
`inventory_movements` 25–26, `order_events` 80. Las respuestas del asistente no siempre se guardan, así que cada
punto se juzga por lo que quedó en la base.

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| 1 | Saludo y resumen | **Aprobado** | «Ayer no entraron pedidos, siguen 3 pendientes…» (3 pedidos pendientes reales); 1,1 s, sin IA |
| 2 | Inventario | **Aprobado** | «38: 6 · 39: 15 Total: 21»; 1,3 s, sin IA |
| 3 | Existencias con confirmación | **Aprobado** | Propuesta «de 6 pasarían a 11», «hagale» la aplicó: auditoría 601, movimiento +5 → 11. El mensaje se escribió con «…y luego hágale» pegado y aun así no se aplicó nada hasta el «hagale» aparte |
| 4 | Fotos + nota de voz | **Aprobado con un fallo** | 3 fotos guardadas (3 `used`, 0 huérfanas); la nota de voz real se transcribió bien; preguntó si era el mismo producto o uno nuevo; borrador con 38, 39 y 40 × 2 a $180.000 y 3 fotos. **Fallo:** «Es uno nuevo, ponle como nombre Adidas violeta» → el nombre pedido se ignoró y quedó «Tenis rojos de prueba». Un solo acuse por las fotos: no verificable en D1 |
| 5 | Corregir antes de guardar | **No ejecutado** | No se envió «cambia el precio a 170 mil»; el producto se guardó a $180.000 con el botón (auditoría 602, TEN-ROJ-4195) |
| 6 | Pedidos ficticios | **Aprobado (por medición)** | Turnos 11–12: `resumen_pedidos` y `listar_pedidos`, 0,8 y 1,0 s; el texto de la respuesta no quedó guardado |
| 7 | Estado con confirmación | **Aprobado** | «El 1» → «Confírmalo» → «Si»: pedido D8F63F34 pendiente → confirmado (auditoría 603, evento 80) y reserva de 2 unidades de la 39 (15 → 13) |
| 8 | Dos tareas en un mensaje | **Aprobado** | Mostró 38: 2 · 39: 2 · 40: 2 y propuso $250.000 → $255.000; aplicado 5 s después (auditoría 604). No hay un «sí» escrito: se confirmó con el botón |
| 9 | Cancelar y recuperar contexto | **Aprobado en parte** | No cambió ningún precio (correcto). Pero al existir ya dos «tenis de prueba» preguntó cuál, «no, déjalo así» cerró la pregunta, y «¿y cuántos quedan?» respondió sobre las KINETIK (último producto resuelto), no sobre los tenis de prueba que pedía el guion |
| 10 | Otras tiendas intactas | **Aprobado** | Tienda 94 idéntica a la foto inicial (CANARIO 38: 7 · TEN-BLA 34: 10, 35: 5, 36: 12, 37: 8 · ZAP 40: 10, 0 pedidos, auditoría 7). El cambio de precio hecho en la tienda 95 ($185.000 → $195.000) no tocó el mismo código en la tienda 1 (sigue en $185.000) |

**Repetición de webhook:** no probada en real. Sí se comprobó que ninguna de las 4 operaciones quedó aplicada dos veces.

### Latencia y costo reales dentro de Cloudflare (tienda 1, 18 mensajes)

- Sin IA (reglas, intérprete, pedidos): 0,6–2,1 s.
- Con el modelo (3 mensajes): **9,1 s, 8,0 s y 5,5 s**, bastante más que los 2–3 s medidos en local. Costo US$ 0,0005–0,0007 cada uno.
- Crear el borrador con las 3 fotos (descarga + visión): **23,5 s**.

### Hallazgos de la sesión libre en la tienda 95 (no eran parte del guion)

1. «cuantas unidadfes tengo en total?» → «No encontré «unidadfes»…»: una pregunta general con un error de tecleo se leyó como nombre de producto. Además el modelo falló en ese turno (`model_failed`, 5,2 s).
2. «qué me recomiendas para vender más esta semana» (dos veces): la capa lo pasó al motor anterior (`other`); no quedó respuesta guardada, así que no se puede confirmar qué recibió el comerciante.
3. **Se pegó una clave de API de Google en el chat** (01:06 UTC). El asistente la trató como texto (ruta `fallback`, 11,3 s) y **quedó guardada en claro** en la memoria de conversación de staging (`assistant_messages`, se borra sola a los 7 días). La limpieza automática de mensajes solo oculta lo que viene después de palabras como «contraseña» o «token», no una clave suelta. Esa clave debe darse por expuesta y revocarse.

### Pendientes que salen de esta prueba

- Corregir: renombrar el borrador con «ponle como nombre X»; no tomar una pregunta general por nombre de producto; ocultar claves sueltas (patrones `AIza…`, `sk-…`, etc.) antes de guardar mensajes.
- Revisar la latencia del modelo dentro de Cloudflare (5–9 s) antes de cualquier piloto.
- Repetir los puntos 5 y 9 del guion.
- WhatsApp sigue sin prueba real.
