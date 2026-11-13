# Asistente TiendIA — capa conversacional · Paso 0 y Paso 1 (2026-11-13)

Rama `feat/asistente-conversacional` (worktree `.tmp/wt-agente`), creada desde `feat/whatsapp-admin-bot` (e09de91, que
ya contiene Telegram, Meta, WAHA y la Fábrica de Publicidad) + `main` (c8e82ef). Sin push, sin merge, producción intacta.
**Staging:** Worker `sneakerhub-telegram-staging` versión `bae45c90` (anterior `77c327da`), migración 0027 aplicada,
capa encendida solo en las tiendas ficticias 1 y 94.

## Paso 0 — Qué hace hoy el asistente (solo lo que toca este paso)

| Función | Estado real | Fuente |
|---|---|---|
| Consultar existencias y precios por nombre o código | Probada de verdad: Telegram (producción), Meta (staging, número de prueba), WAHA (staging) | registros del proyecto + sesión del 11–12 nov |
| Cambiar precio / existencias con vista previa y confirmación atómica | Probada de verdad en Telegram y Meta staging (`update_price` real el 12 nov) | D1 de staging |
| Intérprete determinista (tallas, «180 mil», «de cada talla», docenas) | Probado con 120+ pruebas automáticas; en real por Telegram | suite |
| Aclaraciones (qué producto, sumar o dejar, color) y corrección antes de guardar | Automáticas; corrección sin prueba real por WhatsApp | suite |
| Producto nuevo guiado (borrador) | Real por foto en WAHA y Telegram; por texto solo automático | memoria WAHA |
| Notas de voz | Real en Telegram staging y WAHA; **solo simulada** en Meta | memoria WAHA |
| Lotes de fotos (cola, recuperación) | Real en WAHA (12, 30 y 65 fotos); 100 fotos pendiente | memoria WAHA |
| CSV | **Solo simulado** | — |
| Pedidos, guías, cupones, campañas | Telegram en producción; por WhatsApp solo simulado | — |
| Confirmaciones naturales («hágale», «listo»), «espera», varias tareas, deshacer, resumen al saludar, «¿la sigo o la cancelo?» | **No existían** | banco (motor anterior falla) |
| Memoria de conversación | Existía parcial: producto en foco y últimos 8 turnos, 30 min | código |

## Paso 1 — Qué cambió

Capa nueva en `worker/src/services/assistant/agent/` (el motor anterior no se reemplaza ni se reescribe):

- **`orchestrator.ts`**: decide en este orden — reglas (confirmar, cancelar, esperar, reiniciar, saludo) → intérprete
  determinista existente (exacto con precios, tallas y cantidades) → modelo, solo si el mensaje es libre, trae varias
  tareas o el intérprete terminó en duda. Si el modelo falla o tarda, responde el motor anterior.
- **`planner.ts`**: una llamada al modelo que **solo elige herramientas** (esquema con campos obligatorios por
  herramienta, sin razonamiento extendido, plazo de 9 s, un reintento si la respuesta llega cortada). El modelo no ve
  la base, no escribe SQL y no redacta cifras.
- **`tools.ts`**: registro de 17 herramientas (nombre, descripción, lectura/modificación, confirmación, permiso,
  auditoría). Todas envuelven funciones que ya existían; las modificaciones se convierten en la misma intención
  validada del intérprete y pasan por vista previa → confirmar → aplicación atómica → auditoría.
- **Experiencia**: una línea con el efecto («Sumo 5 a la talla 38 de Tenis Blancos Air (de 8 pasarían a 13). ¿Confirmas?»),
  máximo 3 opciones numeradas («la 2»), lecturas sin confirmación, lectura + cambio en un mensaje, varios cambios en
  un resumen con una sola confirmación, «Tienes pendiente… ¿La sigo o la cancelo?», «olvida eso», «deshaz eso»
  (10 min, precio y existencias), saludo con cifras reales («pedidos recibidos», nunca ventas ni pagos).
- **Estado**: dentro de la sesión existente por (canal, usuario, tienda): producto en foco, última lista numerada,
  cambio o grupo pendiente. Caduca a los 30 min (sesión) y 15 min (cambios). No guarda conversaciones, tokens ni contraseñas.
- **Interruptor**: `ASSISTANT_AGENT_STORE_IDS` (ids separados por coma; vacío = apagado en todas; `*` = todas).
- **Medición**: tabla `assistant_agent_turns` (migración 0027, aditiva): ruta, herramientas, latencia, tokens y costo por mensaje. Sin texto de mensajes.
- Cambios mínimos al motor: `say()` puede capturar la respuesta en vez de enviarla (para responder una sola vez y en
  corto), `dispatch` exportado, `thinkingBudget` opcional en el cliente de Gemini (las demás llamadas no cambian).

## Banco de pruebas (30 conversaciones, `agent/bank/conversations.ts`)

Mismo archivo contra los dos motores. Modelo real `gemini-3.8-flash`, base en memoria, tienda ficticia. Conversaciones
completas antes/después: `docs/ASISTENTE_CONVERSACIONAL_CONVERSACIONES.md`.

| Motor | Datos y seguridad | Críticos | Experiencia | Llamadas IA | Costo (63 mensajes) | Costo/mensaje | Mensajes sin IA | Latencia con IA (p50) |
|---|---|---|---|---|---|---|---|---|
| Anterior | 16/30 | 15/24 | 14/30 | 13 | US$ 0,0166 | US$ 0,00026 | 52/63 | 5,7 s |
| Capa nueva | **30/30** | **24/24** | **30/30** | 18 | US$ 0,0085 | US$ 0,00014 | 46/63 | 3,0 s |

- Sin IA los dos responden en milisegundos. El p95 con IA (≈13 s) corresponde al caso que simula un modelo colgado
  (9 s de plazo + respuesta del motor anterior).
- La capa nueva acierta y el anterior falla en 14 casos (lenguaje libre, «hágale», dos tareas, corrección, «espera»,
  cancelación natural, deshacer, precio ambiguo, «ya no quedan»…). **Ningún caso donde el anterior acierte y la nueva falle.**
- El modelo varía entre ejecuciones: en 4 corridas la capa nueva obtuvo 29, 29, 30 y 30 de 30; los fallos fueron respuestas
  cortadas del modelo, ya cubiertas con reintento y con la respuesta del intérprete.
- Regresión automática: `npx vitest run` → **700 pasan** (669 anteriores + 31 del banco con modelo simulado), 77 omitidas.
- Repetir: `BANK_REAL=1 GEMINI_API_KEY=… BANK_OUT=<carpeta> npx vitest run src/services/assistant/agent/bank` y
  `node scripts/agent-bank-report.mjs <carpeta>/banco-real.json --fallos`.

## Cierre del paso 1 (2026-11-13): 5 corridas reales, reserva y pruebas de cierre

Cinco corridas completas con el modelo real (`gemini-3.8-flash`), una tras otra, con el código del commit `c761d00`:
el banco de 30 conversaciones más **10 conversaciones de reserva** que no se usaron para afinar la capa
(`set: 'reserva'` en `agent/bank/conversations.ts`), contra los dos motores. Base en memoria, tienda ficticia.

| Conjunto | Motor | Aciertos por corrida | Promedio | Peor caso | Críticos (peor corrida) |
|---|---|---|---|---|---|
| Banco (30) | Anterior | 15, 15, 16, 15, 15 | 15,2/30 | 15/30 | 15/24 |
| Banco (30) | **Capa nueva** | 29, 29, 30, 30, 29 | **29,4/30** | **29/30** | 23/24 |
| Reserva (10) | Anterior | 6, 6, 6, 6, 6 | 6,0/10 | 6/10 | 3/7 |
| Reserva (10) | **Capa nueva** | 10, 10, 10, 10, 10 | **10,0/10** | **10/10** | 7/7 |

**Latencia** (5 corridas; 315 mensajes del banco y 90 de la reserva por motor):

| Conjunto · motor | Todos los mensajes p50 / p95 | Solo mensajes que usan IA p50 / p95 / máx |
|---|---|---|
| Banco · anterior | 3 ms / 6,5 s | 5,2 s / 11,7 s / 14,3 s |
| Banco · capa nueva | 3 ms / 4,1 s | 2,7 s / **9,0 s** / 19,1 s |
| Reserva · anterior | 3 ms / 13,3 s | 5,6 s / 16,3 s / 16,5 s |
| Reserva · capa nueva | 5 ms / 3,6 s | 2,7 s / **9,0 s** / 21,9 s |

El p95 con IA incluye el caso que simula un modelo colgado (plazo de 9 s + respuesta del motor anterior) y las
respuestas que el modelo cortó y se pidieron de nuevo. El máximo (19–22 s) son esos reintentos.

**Costo: sobre qué se promedia.** El banco mide el costo total de la corrida. Se informa de las dos formas:

| Conjunto · motor | Mensajes con IA | Costo por mensaje, **promediado sobre todos los mensajes** | Costo por mensaje, **solo los que usan IA** |
|---|---|---|---|
| Banco · anterior | 17 % | US$ 0,00024 | US$ 0,00136 |
| Banco · capa nueva | 21 % | US$ 0,00012 | US$ 0,00059 |
| Reserva · anterior | 28 % | US$ 0,00058 | US$ 0,00208 |
| Reserva · capa nueva | 39 % | US$ 0,00022 | US$ 0,00058 |

La cifra de la primera entrega (US$ 0,00014 por mensaje) era el promedio **sobre todos los mensajes**, incluidos los
que se resuelven sin IA (cuatro de cada cinco). Un mensaje que sí llega al modelo cuesta unos US$ 0,0006. «Usa IA»
se cuenta por el plan del modelo registrado o por una latencia mayor a 400 ms (aproximación del agregador
`scripts/agent-bank-runs.mjs`).

**Fallos de la capa nueva (uno por corrida, tres conversaciones distintas, ninguno modificó el catálogo):**

- `incompleta` (corrida 1): la llamada al modelo falló y la respuesta de respaldo no era una pregunta. Corregido
  después de medir (`dd6a2a7`): ahora pregunta «¿Qué le cambio?».
- `dato-ambiguo` (corrida 2, crítico): el modelo preguntó «¿180 pesos o 180 mil?» con sus palabras en vez de la
  pregunta exacta con los dos valores y el precio actual. No aplicó nada. Corregido después de medir (`dd6a2a7`):
  ante un monto sin «mil» queda siempre la pregunta exacta.
- `lectura-y-cambio` (corrida 5, crítico): mensaje con dos tareas y la llamada al modelo falló por transporte; el
  motor anterior respondió «No encontré el producto». No aplicó nada. **Sigue abierto**: dos tareas en un mensaje
  dependen del modelo y un fallo de transporte no se reintenta (decisión del paso 1 para no duplicar la espera).

Las dos correcciones posteriores tienen prueba con modelo simulado, pero **no se repitieron las 5 corridas reales
después de ellas**.

**Fallo de seguridad que destapó la reserva.** En la primera corrida de la reserva, ante «cambia el precio de SAN-1
a 185» el modelo podía decidir por su cuenta que eran $185.000, y dar por confirmado un cambio cuando el comerciante
solo repetía el monto o lo comentaba, sin decir que sí. Corregido en `7bc04ee`:
el modelo nunca confirma por el comerciante (el propio mensaje debe decir que sí) y un monto sin «mil» siempre se
pregunta. Prueba: las conversaciones de reserva `r-precio-185` y `r-cancelar-todo`, que pasan en las 5 corridas
reales (y en la suite con modelo simulado).

**Lecturas que ya no dependen del modelo** (`c761d00`, con prueba sin IA en `agent/closing.test.ts`): «deja la 39 de
las sandalias en 10» es inventario (no un precio dudoso) y «productos agotados» es la lista de agotados.

**Pruebas de cierre** (`agent/closing.test.ts`, 12 pruebas, sin IA):

1. *Mensaje duplicado por reintento del webhook*: la misma petición entregada tres veces prepara un solo cambio y
   responde una vez; la misma confirmación entregada tres veces aplica el cambio una sola vez.
2. *«Deshaz eso» cuando el inventario cambió entretanto*: revierte solo la diferencia (con una venta de 1 par en
   medio, de 5 baja a 0 en vez de volver a 1); si revertir dejaría el inventario en negativo se rechaza y no toca
   nada; un precio que alguien volvió a cambiar no se pisa. Nunca escribe el valor anterior a ciegas.
3. *Fallo parcial a propósito en un cambio múltiple*: si el segundo ya no es posible, el primero se aplica y el
   informe dice exactamente cuál no; si ninguno es posible no se aplica nada; un «sí» repetido no vuelve a aplicar.

Suite completa: `npx vitest run` → **748 pasan**, 155 omitidas (las que solo corren con modelo real).
Repetir: `BANK_REAL=1 GEMINI_API_KEY=… BANK_OUT=<carpeta> BANK_RUN=<n> npx vitest run src/services/assistant/agent/bank/bank.test.ts`
(una vez por corrida) y `node scripts/agent-bank-runs.mjs <carpeta> --fallos`.

## Lo que NO se pudo comprobar

- **Ningún mensaje real por Telegram, Meta o WAHA con la capa encendida**: el banco corre sobre el manejador real del
  asistente, pero en una base en memoria. Staging está desplegado y listo; falta que alguien escriba.
- Botones del grupo de cambios (`ag:…`) en WhatsApp Meta/WAHA: solo probados por texto («sí»/«no»).
- Instrucción maliciosa dentro de una **foto o archivo**: queda para el paso 2 (hoy la cubren las pruebas existentes de
  PDF hostil y CSV con fórmula del motor anterior). En texto y texto reenviado: cubierto.
- Costo y latencia en producción: se medirán con `assistant_agent_turns`.

## Riesgos y decisiones

1. **Varios cambios en un mensaje** se confirman juntos pero se aplican uno por uno (cada uno atómico). Si uno falla,
   el informe dice cuál se aplicó y cuál no; no hay reversión automática del grupo.
2. La elección entre varios productos por **botón** muestra la vista previa larga del motor anterior; por texto («la 2») la corta.
3. `confirmar`/`cancelar` propuestos por el modelo solo se aceptan como respuesta única; «mejor súbele…» nunca cancela solo.
4. Las notas de voz y las fotos siguen por el flujo anterior (paso 2).
5. El intérprete anterior tiene lecturas equivocadas conocidas («súbele…» = producto nuevo, «deja la 39 en 10» = precio):
   la capa las detecta y consulta al modelo; con el modelo caído pregunta en vez de crear un borrador.
6. Staging lo comparte la sesión de WAHA: este despliegue incluye todo su código (`cdc1b96`) y conserva sus variables.

## Reversión

- **Apagar la capa (sin desplegar código nuevo):** redesplegar staging con `--keep-vars --var ASSISTANT_AGENT_STORE_IDS:`
  (vacío). El asistente vuelve al motor anterior en el siguiente mensaje.
- **Volver al Worker anterior:** `npx wrangler rollback 77c327da-432b-47c7-b5c9-25172e6e56a5 -c wrangler.remote-staging.toml`.
- **Esquema (solo si hiciera falta):** `database/rollback/0027_assistant_agent_turns.down.sql`; marcador previo de staging
  `0000046f-00000000-00005122-3aebfd5ac215d04df97bed63a43052ae`.
- Producción: nada que revertir. Para publicarla hará falta 0024→0027 antes del código y la variable vacía por defecto.

## Cómo probar en staging (tiendas ficticias 1 y 94)

Por el bot de Telegram de staging o por el WhatsApp de staging: «Buenos días» · «cuántos quedan de …» · «me llegaron 5
de la 38 de …» → «hágale» · «bájale diez mil a …» → «la 2» · «ponle 90 mil a … y súmale 2 a …» → «sí» · «deshaz eso» ·
«olvida eso». Medición: `SELECT path, tools, outcome, latency_ms, cost_micros FROM assistant_agent_turns ORDER BY id DESC LIMIT 20`.

## Pendiente (siguientes pasos, cada uno con aprobación)

2. Fotos y voz en el mismo contexto (lotes de WAHA, cola y recuperación intactos; foto + audio = una operación).
3. Pedidos y reportes: en staging (`docs/ASISTENTE_CONVERSACIONAL_PASO3.md`). 4. Marketing y Fábrica de Publicidad.
