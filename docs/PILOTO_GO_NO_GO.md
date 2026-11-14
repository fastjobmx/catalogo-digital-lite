# TiendIA Exprés · agente conversacional · matriz GO / NO GO para el piloto

Fecha: 2026-11-13. Rama `feat/asistente-conversacional` (`a484fdf`, solo commits locales, sin push). Staging:
Worker `64ad293f`. Producción: sin cambios (API `3c53c1d8` del 2026-11-12, migraciones 0024–0028 sin aplicar).

**Resumen:** hoy ninguno de los tres escenarios está APTO. El piloto interno por Telegram (A) tiene toda la
validación técnica en verde y le falta una sola cosa: la prueba real con el teléfono (`docs/PILOTO_PRUEBA_REAL_STAGING.md`).
WAHA (B) y comerciantes reales (C) tienen bloqueos de infraestructura y de producto que no se resuelven con pruebas.

## Evidencia técnica (común a los tres)

| Qué | Resultado | Tipo de evidencia |
|---|---|---|
| Banco Paso 1 (34 conversaciones, 27 críticas), 5 corridas con modelo real, código final | Capa nueva **34, 34, 34, 34, 34** · motor anterior 15–16 | Modelo real, base en memoria |
| Banco de reserva (10, no usadas para afinar), 5 corridas | Capa nueva **10/10 en las cinco** · anterior 6–7 | Modelo real, base en memoria |
| Banco multimodal (29 escenarios, 25 críticos), 3 corridas | Capa nueva **29, 29, 29** · anterior 10 | Visión y planificador reales; **voz simulada** |
| Banco de pedidos (33 conversaciones, 27 críticas), 3 corridas | Capa nueva **33, 33, 33** · anterior 9 | Modelo real, base en memoria |
| Casos donde el flujo anterior acierta y el nuevo falla | **Ninguno**, en ninguna corrida | — |
| Suite del servidor | **809 pasan, 0 fallan**, 229 omitidas (modos con modelo real y staging) | Automática |
| Suite del panel | 132 pasan; 1 archivo no carga en este worktree por una dependencia sin instalar (`mp4-muxer`); en la carpeta principal ese mismo código pasa (37/37) y es idéntico a `main` | Automática |
| Ningún archivo de pruebas eliminado respecto a `main` | Verificado con git | — |
| Interruptores independientes (8 combinaciones + por tienda + sin variables) | 10/10 | Automática, sin IA |
| Migraciones 0024–0028 y sus reversiones sobre copia de producción | **OK** (6 tiendas, 25 pedidos, hashes idénticos tras revertir) | Copia local del **2026-11-11** |
| Rama contiene `main` actual, Telegram IA, WAHA, Meta y Fábrica | 0 commits faltantes de `main`, `feat/whatsapp-admin-bot`, `feat/telegram-ia-planes`, `feat/motor-publicitario` | git |
| Compilación de producción sin desplegar (`--dry-run`) | Correcta; una sola `AI_MESSAGE_QUOTA_MODE`; WhatsApp apagado | — |

Suite por áreas (todas sin fallos): Telegram 136 · WhatsApp oficial 52 · WAHA 37 · agente de texto 107 · fotos y voz
44 · inventario y catálogo 35 · pedidos y guías 82 · Fábrica de Publicidad y Estudio 56 · cuotas y créditos de IA 15 ·
aislamiento entre comercios 24 · resto (correo, SEO, plataforma) 251.

Medidas con modelo real (equipo local contra la API, no dentro de Cloudflare):

| Banco | Mensajes que usan IA | Latencia todos p50 / p95 | Latencia con IA p50 / p95 | Costo por mensaje (todos) | Costo por mensaje con IA |
|---|---|---|---|---|---|
| Paso 1 | 13 % | 4 ms / 2,3 s | 2,2 s / 9,1 s | US$ 0,00009 | US$ 0,00071 |
| Reserva | 39 % | 6 ms / 2,6 s | 2,1 s / 3,8 s | US$ 0,00020 | US$ 0,00051 |
| Pedidos | 3 % | 3 ms / 13 ms | 14,1 s / 16,9 s | US$ 0,00007 | US$ 0,00253 |
| Multimodal | — | 4 ms / 11,8 s por mensaje | primer acuse 1 ms (p50) | US$ 0,0021 por lote | US$ 0,0027 por lote con IA |

Correcciones de esta ronda (todas con prueba y validadas con modelo real):
- Varias tareas en un mensaje se leen con reglas cuando falla la llamada al modelo; un error de transporte rápido se reintenta una vez.
- «Súbele / bájale …» es un cambio de precio exacto; «súbele el precio a X» → «¿cuánto?» → «cinco mil» ya no depende del modelo.
- La capa de pedidos reparte los mensajes mixtos (pedidos + catálogo) y no responde totales cuando se nombra un producto.
- En cada corrida real hubo entre 5 y 7 errores del modelo (cortes y fallos de petición) y aun así la capa nueva no falló ninguna conversación.

**Lo que sigue siendo solo simulado:** toda conversación por canal real con las capas encendidas; las notas de voz;
WAHA con multimedia y pedidos; la repetición de webhook; latencia y costo dentro de Cloudflare. Observación abierta:
los pocos mensajes de pedidos que llegan al modelo tardan ~14 s; son mensajes mixtos o de un producto, que pasan al
intérprete general.

## A. Piloto interno por Telegram

| | |
|---|---|
| **Verificado** | Catálogo e inventario, fotos + descripción, pedidos y reportes, confirmaciones, deshacer, varias tareas, caída del modelo, aislamiento, roles, idempotencia: todo en bancos con modelo real y suite. Staging desplegado y sano con datos ficticios. Migraciones y reversión validadas sobre copia. Interruptores independientes |
| **Pendiente** | **La prueba real de 10 puntos con el teléfono** y su verificación en D1. Una nota de voz real. Copia fresca de producción el día de migrar (la validada es del 11 de noviembre) |
| **Fallos críticos** | Ninguno abierto |
| **Riesgos operativos** | El despliegue cambia código que hoy usan los seis comercios por Telegram (con los interruptores apagados las pruebas muestran el flujo anterior intacto, pero es código nuevo en producción). «Hoy» usa UTC−5 para todas las tiendas. El alcance del Paso 3 lo definí yo. Dos arreglos de la Fábrica (`8123094`, `2b531ab`, solo panel) viven en `integracion/motor-publicitario` y no están en `main` ni en esta rama: hay que decidir si entran |
| **Infraestructura** | Ninguna nueva: Cloudflare Worker, D1 y R2 actuales. Sin VPS, sin cola, sin secretos nuevos |
| **Resultado** | **NO APTO hoy** → pasa a **APTO** si los 10 puntos de la prueba real quedan aprobados con evidencia en D1 |
| **Evidencia** | Tabla de arriba; `docs/ASISTENTE_CONVERSACIONAL_PASO1/2/3.md`; `docs/PILOTO_PRUEBA_REAL_STAGING.md` |

## B. Piloto interno por WAHA

| | |
|---|---|
| **Verificado** | Código de WAHA integrado y con 37 pruebas (firma, vinculación, lotes, cola, recuperación). Las capas nuevas sobre WAHA: 8 pruebas con WAHA simulado. Pruebas reales anteriores de WAHA (lotes de 12, 30 y 65 fotos, voz, reposición) hechas con el flujo anterior, no con las capas nuevas |
| **Pendiente** | Probar por WhatsApp real las capas de texto, multimedia y pedidos. Lote de 100 fotos, CSV real, cambio de número |
| **Fallos críticos** | **1. La vinculación depende del interruptor de Meta:** con `WHATSAPP_ADMIN_BOT_ENABLED=false` el panel no entrega el código de vinculación (responde 503) aunque WAHA esté encendido, y el enlace usa el número de Meta (`WHATSAPP_DISPLAY_NUMBER`). Comprobado con un experimento. Arreglo: permitir el código cuando cualquiera de los dos canales esté activo y usar un número propio de WAHA; es pequeño pero es código del trabajo de WAHA y no lo toqué. **2. WAHA está apagado ahora mismo** (Docker Desktop no corre; túnel caído) |
| **Riesgos operativos** | WhatsApp no oficial: el número puede ser suspendido. Corre en tu PC: si se apaga o suspende, el asistente no responde y los mensajes de más de 15 minutos se descartan. El túnel rápido cambia de dirección al reiniciarse y expira al suspender el equipo. Sin respaldos de la sesión ni monitoreo |
| **Infraestructura para un piloto interno** | Lo mínimo: tu PC encendido con Docker, túnel recreado y staging apuntando a él (sirve para probar, no para operar). Para un piloto estable: servidor 24/7 (2 CPU, 4 GB), túnel con nombre en el dominio propio con Cloudflare Access, cola de producción (`WHATSAPP_JOBS`, no creada ni declarada en `wrangler.production.toml`), secretos de WAHA en producción (`WAHA_API_KEY`, `WAHA_GATEWAY_TOKEN`, `WAHA_WEBHOOK_HMAC_KEY`, `WAHA_API_URL`, `WAHA_SESSION`), respaldo cifrado de la sesión, alerta cuando la sesión cae o el túnel no responde, número dedicado. **No se contrató nada** |
| **Resultado** | **NO APTO** |
| **Evidencia** | `docs/WAHA_PROVEEDOR_WHATSAPP.md` (§3, §11, §14); `docker ps` sin motor; experimento de vinculación con Meta apagado; `whatsapp/waha.test.ts` |

**Telegram frente a WAHA:** el piloto de Telegram no necesita nada de lo anterior. Todo lo de esta fila es
exclusivo de activar WhatsApp por WAHA, y puede hacerse después sin frenar a Telegram.

## C. Comerciantes reales

| | |
|---|---|
| **Verificado** | Lo mismo que en A, en entorno de pruebas. Aislamiento entre comercios y roles con prueba. Cuotas de IA separadas por tienda (hoy en modo sombra: cuentan y avisan, no bloquean) |
| **Pendiente** | Resultado del piloto interno (días de uso real, no una sesión). Medición de latencia y costo dentro de Cloudflare. Notas de voz reales con acento y ruido. Zona horaria por tienda. Política escrita de conservación de fotos y mensajes. Guía para el comerciante y canal de soporte. Decidir el modo de la cuota de IA. Revisar contigo el alcance de pedidos y reportes |
| **Fallos críticos** | Ninguno conocido en el código; el bloqueo es la falta de uso real |
| **Riesgos operativos** | Un comerciante real tiene catálogos, nombres y formas de hablar que los bancos no cubren. Un error aquí toca inventario y pedidos de un negocio. Los cambios siempre piden confirmación y hay «deshaz eso» para precio e inventario, pero no para pedidos |
| **Infraestructura** | La de A para Telegram. Para WhatsApp, además, todo lo de B |
| **Resultado** | **NO APTO** hasta completar el piloto interno |
| **Evidencia** | Ausencia de tráfico real: en staging hay 1 turno medido; en producción, ninguno |

## Plan de despliegue por etapas (preparado, **nada ejecutado ni autorizado**)

Ninguna etapa enciende el agente para un comercio. Cada una requiere tu autorización expresa.

| Etapa | Qué | Cómo se comprueba | Cómo se revierte |
|---|---|---|---|
| 0 | Prueba real en staging (10 puntos) y decisión sobre los dos arreglos de la Fábrica que no están en `main` | D1 de staging | — |
| 1 | Copia fresca de producción y marcador de D1. Repetir `node scripts/verify-d1-migration.mjs <copia> --rollback` | `RESULTADO: OK` | — |
| 2 | Migraciones **0024 → 0025 → 0026 → 0027 → 0028**, en ese orden y antes del código (desde 0025 el registro de uso de IA escribe una columna nueva) | Lista de migraciones sin pendientes; Telegram y Fábrica responden | Scripts `database/rollback/0028…0024` (validados) o marcador de D1 |
| 3 | API desde la rama integrada, con **todo apagado**: sin variables `ASSISTANT_*`, `WHATSAPP_ADMIN_BOT_ENABLED=false`, sin WAHA | Humo: Telegram de un comercio (solo lectura), Fábrica de Publicidad, panel, pedidos de la tienda | `wrangler rollback 3c53c1d8-5be7-4cb4-85f9-74479869f698` |
| 4 | Panel (trae la tarjeta de vinculación de WhatsApp, oculta mientras el canal esté apagado) | Humo del panel y de la Fábrica | Versión anterior del panel |
| 5 | Piloto Telegram: `ASSISTANT_AGENT_STORE_IDS=<id de UNA tienda interna que tú elijas>` | Guion de la prueba real en esa tienda; revisión diaria de `assistant_agent_turns` | Variable vacía y redesplegar: el siguiente mensaje ya va por el flujo anterior |
| 6 | Mismo comercio: `ASSISTANT_MEDIA_STORE_IDS`, y después `ASSISTANT_ORDERS_STORE_IDS`, uno por vez | Igual | Cada variable por separado |
| 7 | WAHA: solo cuando B esté resuelto (servidor, túnel con nombre, cola, secretos, arreglo de vinculación) | — | `WAHA_ENABLED=false` |
| 8 | Comerciantes reales: solo tras el piloto, de a uno, agregando su id a las listas | — | Quitar su id |

Secretos: Telegram y Gemini ya están en producción; el piloto de Telegram no necesita ninguno nuevo. Colas: ninguna
para Telegram; WAHA necesita crear la de producción. Las tres variables de activación no existen hoy en
`wrangler.production.toml`: mientras no se agreguen, las tres capas están apagadas para todos.

Dudas que no pude cerrar: no confirmé si exportar la base de producción la deja unos segundos sin atender consultas
(por eso no pedí una copia fresca; la validación usa la del 11 de noviembre); y no sé qué versión del panel está
publicada hoy ni si incluye los dos arreglos de la Fábrica mencionados.
