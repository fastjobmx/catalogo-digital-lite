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
3. Pedidos y reportes. 4. Marketing y Fábrica de Publicidad.
