# Asistente TiendIA · capa conversacional · Paso 2: fotos y voz dentro de la conversación

Estado al 2026-11-13: **en STAGING** (Worker `46662eff-156b-4820-88fd-c91494e528b7`, migración 0028 aplicada), rama
`feat/asistente-conversacional`, sin push, sin merge, producción y `main` intactos. Multimedia encendida solo en las
tiendas ficticias 1 y 94. Paso 3 (pedidos y reportes) no empezado.

## Resumen de una página

**Qué cambia para el comerciante.** Fotos, nota de voz y texto del mismo comerciante forman una sola operación:

- Manda las fotos y luego dice (o escribe) qué son: un solo acuse por el grupo de fotos y **un solo resumen** que
  repite nombre, tallas, cantidades y precio («tallas 38 a 42, 5 de cada una (25 en total), a $180.000, con las 5
  fotos. Nada se publica todavía»). Antes: «¡Linda foto! ¿Qué hago con ella?» por cada foto y el audio se perdía.
- Si dice primero y manda las fotos después, las fotos entran al borrador con una sola línea.
- Solo pregunta lo que falta, una cosa a la vez (precio, tallas o código).
- Un precio que no cuadra con la tienda oído en un audio se confirma solo («lo escuché como $18.000. ¿Es ese, o son
  $180.000?»); una talla imposible («talla 83») no se guarda y se pregunta por nombre.
- Si el nombre se parece a un producto que ya existe pregunta «¿es el mismo o uno nuevo?» y no crea duplicados.
- Correcciones naturales del borrador: «cambia el precio a 170 mil», «quita la tercera», «listo».
- En WhatsApp (WAHA), la descripción por voz o texto se asocia al producto correcto del lote: con un solo producto
  va directo; si nombra el producto va a ese; **con varios productos abiertos pregunta con opciones cortas**
  («¿A cuál producto del lote te refieres? 1) … 2) …»); si las fotos aún se están organizando, la guarda y la aplica
  cuando sale el resumen.
- Otra consulta con fotos en espera se responde normal y se recuerda una sola vez que las fotos siguen ahí.

**Cómo está hecho.** Un módulo nuevo (`worker/src/services/assistant/agent/media.ts`) que solo decide *a qué
operación pertenece cada mensaje* y lo dice en corto. El trabajo lo siguen haciendo las piezas que ya existían, sin
reescribirlas: el borrador de producto del motor (fotos, vista previa, «Guardar producto»), los lotes de WAHA (R2,
Cloudflare Queues, agrupación con IA, recuperación), el intérprete determinista de precios y tallas, y el flujo de
documentos y CSV (resumen → confirmación). Tabla nueva `assistant_media_items` (0028, aditiva): guarda solo el
identificador del archivo en el canal, la tienda y el usuario.

**Reglas de asociación** (`associate()` en `media.ts`, explícitas y probadas). Todo se consulta por tienda y usuario:

1. Un borrador abierto es dueño del mensaje (sus preguntas y correcciones).
2. Fotos en espera dentro de la ventana (`ASSISTANT_MEDIA_WINDOW_SECONDS`, 30 min por defecto) toman un mensaje
   que describe un producto.
3. Un lote de WAHA abierto lo toma si tiene un solo producto o si el mensaje nombra exactamente uno; con varios y
   sin coincidencia clara, se pregunta.
4. Una petición sobre un producto que ya existe, una pregunta o un cambio pendiente no son la descripción de las
   fotos: siguen su camino normal y las fotos esperan.

**Herramientas nuevas** (`MEDIA_TOOLS`, mismo estilo de registro que `agent/tools.ts`; todas envuelven lo existente y
exigen rol de administrador): `borrador_desde_fotos`, `borrador_ajustar`, `asociar_descripcion_a_lote`,
`lote_agrupar`, `detectar_duplicados`, `lote_estado`, `lote_confirmar`, `lote_cancelar`. Ninguna escribe en el
catálogo: publicar sigue siendo la vista previa con «Guardar producto».

**Seguridad.**
- El texto dentro de fotos, PDF, CSV, pies de foto y textos reenviados es dato: el nombre que «lee» la visión nunca
  sustituye lo que dijo el comerciante, no cambia precios y no publica. Probado con instrucciones maliciosas en el
  pie de foto, impresas en la foto, en un PDF y en un CSV (con fórmula).
- Nada se modifica sin resumen y confirmación (el banco verifica en cada mensaje que el catálogo no cambió).
- Idempotencia: índice único (tienda, usuario, archivo) + el `update_id` del canal: foto o webhook repetidos no
  cuentan dos veces.
- Aislamiento: fotos en espera y lotes se consultan siempre con tienda y usuario/chat; el lote de otra tienda no se
  puede leer ni escribir.
- Límites: 10 fotos por producto (`ASSISTANT_MEDIA_MAX_PHOTOS`), 60 productos preparados desde fotos por tienda y
  día (`ASSISTANT_MEDIA_DAILY_PRODUCTS`), presupuesto de IA por tienda ya existente, límite por lote de WAHA ya existente.

**Interruptor.** `ASSISTANT_MEDIA_STORE_IDS` (ids separados por coma; vacío = apagado; `*` = todas), independiente
de `ASSISTANT_AGENT_STORE_IDS`. Apagado por defecto: sin la variable, fotos, voz y lotes van por el flujo anterior
exactamente como antes (hay prueba).

## Resultados

Banco multimodal: **29 escenarios** (`agent/bank/media.conversations.ts`), el mismo guion contra el flujo anterior
(interruptores apagados) y la capa nueva, por la ruta real del webhook de Telegram con base en memoria y tienda
ficticia. 25 son críticos. Cubre: fotos + audio posterior, audio o texto antes de las fotos, pie de foto, falta un
dato, producto existente (mismo / nuevo), reposición con fotos en espera, foto duplicada, webhook reenviado, precio y
talla mal transcritos, corrección a mitad, descartar fotos, cancelar borrador, lote grande (14 fotos), modelo caído,
canal caído, cambio de tema, lote de otra tienda, rol sin permiso, cambio pendiente + fotos, aviso de progreso, e
instrucciones maliciosas en el pie de foto, **dentro de la foto**, en un PDF y en un CSV. Además, 6 pruebas sobre los
lotes de WAHA (`whatsapp/waha.test.ts`): audio con un producto, **audio con dos productos abiertos**, descripción que
nombra el producto, descripción mientras se organizan las fotos, lote de otra tienda y de otro chat, interruptor apagado.

| Corrida | Flujo anterior | Capa nueva | Críticos (nueva) | Experiencia (nueva) |
|---|---|---|---|---|
| Modelo simulado (suite automática) | 8/29 | **29/29** | 25/25 | 29/29 |
| Real 1 | 10/29 | 28/29** | 24/25** | 29/29 |
| Real 2 | 10/29 | 28/29** | 24/25** | 29/29 |
| Real 3 | 10/29 | 28/29** | 24/25** | 29/29 |
| Real 4 | 10/29 | **29/29** | 25/25 | 29/29 |

\** El único fallo de las corridas 1–3 fue una expectativa mal escrita del propio banco: prohibía el aviso «Estoy
revisando las 5 fotos…» en un caso donde, con visión real, revisar tarda más de 4 s y el aviso es lo correcto. Se
corrigió la expectativa y la corrida 4 es la limpia. El comportamiento del asistente fue el mismo en las cuatro.

**«Real»** = visión y planificador reales (`gemini-3.8-flash`) sobre una foto real de producto del repositorio. La
**transcripción de las notas de voz siempre es simulada** (no hay audios grabados): se prueba lo que pasa después de
transcribir. La base de datos es en memoria.

**Ningún escenario donde el flujo anterior acierte y la capa nueva falle**, en ninguna corrida. Los 10 que el
anterior acierta son los que no dependen de asociar fotos con su descripción (audio o texto antes de las fotos,
reposición, otra tienda, las inyecciones, rol sin permiso).

Latencia y costo (4 corridas reales, 276 mensajes y 116 escenarios por flujo):

| Medida | Flujo anterior | Capa nueva |
|---|---|---|
| Latencia por mensaje p50 / p95 / máx | 5 ms / 13,5 s / 18,9 s | 5 ms / 13,1 s / 26,1 s |
| Tiempo hasta el primer acuse tras la primera foto p50 / p95 | 2 ms / 8 ms | 2 ms / 9,3 s |
| Costo por lote, promedio sobre todos los escenarios / máximo | US$ 0,0022 / 0,0066 | US$ 0,0022 / 0,0044 |
| Costo por lote, solo los que usan IA (92 de 116) | US$ 0,0028 | US$ 0,0027 |
| Llamadas al modelo por escenario | 1,6 | 1,0 |

- El costo incluye la visión (es casi todo el costo: una llamada que mira las fotos del producto). La capa nueva no
  agrega llamadas: reusa la visión del borrador y lee nombre, tallas y precio con el intérprete determinista.
- El p95 de ~13 s es el mensaje que crea el borrador: descargar las fotos y la visión del motor (igual en los dos
  flujos). Por eso se agregó **un aviso de progreso solo si tarda** más de 4 s (`ASSISTANT_MEDIA_PROGRESS_MS`); si
  responde antes, no se dice nada extra.
- El primer acuse es inmediato (2 ms) cuando llegan fotos solas. El p95 de 9,3 s corresponde a la foto que trae la
  descripción en el pie: ahí el primer mensaje ya es el resumen completo, con visión incluida.
- Latencias medidas en el equipo local contra la API real, no dentro de Cloudflare.

Suite completa: `npx vitest run` → **748 pasan**, 155 omitidas (solo corren con modelo real). Sin regresiones en
las pruebas de Telegram, WhatsApp Meta, WAHA, lotes, documentos, Fábrica de Publicidad ni Estudio.

## Conversaciones antes / después (mismo guion, modelo simulado)

**5 fotos y luego un audio**

| Antes | Después |
|---|---|
| 5 × «¡Linda foto! ¿Qué hago con ella?» | «📸 Recibí la foto. Si son varias, envíalas todas y luego dime qué producto es…» (una vez) |
| 🎙️ «Entendí: …» → «ok» (no se crea nada) | 🎙️ «Entendí: …» → «Listo, entendí: **Tenis rojos**, tallas 38 a 42, 5 de cada una (25 en total), a $180.000 COP, con las 5 fotos. Nada se publica todavía. Por último, ¿tiene un código o SKU? Si no, uso TEN-ROJ-7919.» |

**Audio con el precio mal transcrito («a dieciocho mil»)**

| Antes | Después |
|---|---|
| «ok» · luego «No pude entender bien la solicitud» | «Listo, entendí: Tenis rojos, tallas 38 a 40, 2 de cada una (6 en total), con las 2 fotos. Nada se publica todavía. El precio lo escuché como $18.000 COP. ¿Es ese, o son $180.000 COP?» → «son 180 mil» → «Precio: $180.000 COP.» |

**Fotos de un producto que ya existe**

| Antes | Después |
|---|---|
| «son las sandalias guess» → «No pude entender bien la solicitud» | «Eso se parece a **Sandalias Guess**, que ya tienes. ¿Es el mismo producto o uno nuevo?» → «es el mismo» → «Entendido… no creo otro producto. Si llegaron unidades dime cuántas por talla…» |

**Cambio de tema con fotos en espera**

| Antes | Después |
|---|---|
| Responde el inventario; la descripción posterior no se entiende | Responde el inventario + «Siguen esperando las 2 fotos que me enviaste: dime qué producto es o escribe «descarta las fotos».» → la descripción crea el borrador con las 2 fotos |

**WhatsApp (WAHA), audio con dos productos en el lote** (prueba automática con WAHA simulado)

> 🎙️ «son del 38 al 40, dos de cada talla, a 150 mil» → «¿A cuál producto del lote te refieres? 1) Tenis blancos
> urbanos 2) Chanclas de playa. O dime «a todos»…» → «el 2» → «Anotado para **Chanclas de playa**: tallas 38 a 40,
> 2 de cada una (6 en total), a $150.000 COP. Responde **sí** para preparar las fichas.»

## Lo que NO se pudo comprobar (dicho sin adornos)

- **Ningún mensaje real por Telegram, Meta o WAHA.** Staging está desplegado, sano (`/api/health` 200, webhook sin
  secreto → 403) y con las variables conservadas, pero nadie escribió: la tabla de medición de staging tiene 1 turno
  (de antes) y `assistant_media_items` está vacía. Enviar fotos y audios reales necesita un teléfono con el bot o el
  número de staging; no lo simulé falsificando webhooks con los secretos.
- **Ninguna nota de voz real**: la transcripción se simuló en todas las pruebas (banco y WAHA).
- **WAHA real**: las 6 pruebas de lotes usan WAHA y Gemini simulados; no hubo entregas por WhatsApp.
- **Costo y latencia dentro de Cloudflare** (staging): se medirán con `assistant_agent_turns` (ruta `media`) cuando
  haya tráfico.
- Botones «Es el mismo / Es uno nuevo» en WhatsApp: probado por texto, no por botón.
- La caída del canal se probó en Telegram (respuesta rechazada con 502). En WAHA la recuperación del lote es la que
  ya existía y sus pruebas siguen pasando; no se agregó un caso nuevo de caída con multimedia encendida.

## Riesgos y decisiones

1. **La transcripción no trae nivel de confianza.** La duda sobre un número se decide con reglas: precio muy por
   debajo de productos parecidos de la tienda y diez veces más sí encaja; talla que no existe. Un precio mal oído
   que resulte verosímil (150 → 160 mil) no se detecta: por eso el resumen repite siempre monto, tallas y cantidades.
2. **Producto existente: se detecta por el nombre que da el comerciante**, no comparando imágenes. Dos fotos
   idénticas de archivos distintos en Telegram no se detectan (en WAHA sí, por huella del contenido).
3. **En Telegram todas las fotos en espera son un producto** (máximo 10). Separar varios productos por IA sigue
   siendo el lote de WAHA o la importación masiva de Telegram, que no se tocaron.
4. Si el canal falla justo al responder, el borrador queda creado y el comerciante no ve el resumen; al repetir la
   descripción se le responde sobre el mismo borrador (probado), no se duplica.
5. La descripción para un lote de WAHA se guarda como texto de la primera foto del producto, ya normalizada
   («$150.000. 38:2, 39:2, 40:2»), y el lote la lee con su propio intérprete al abrir el borrador. El lote no se
   reescribió: si esa lectura fallara, pregunta precio y tallas como antes.
6. Staging lo comparte la sesión de WAHA: este despliegue incluye su código (`cdc1b96`) y conserva sus variables.

## Reversión

- **Apagar solo multimedia (sin código nuevo):** desde `worker/`,
  `npx wrangler deploy -c wrangler.remote-staging.toml --keep-vars --var ASSISTANT_MEDIA_STORE_IDS:` (vacío).
  Desde el siguiente mensaje, fotos, voz y lotes vuelven al flujo anterior; la capa de texto del paso 1 sigue igual.
  Las fotos que estuvieran en espera simplemente caducan; no hay nada que limpiar.
- **Volver al Worker del paso 1:** `npx wrangler rollback bae45c90-ee1b-45dd-9e2f-40ce0f487a12 -c wrangler.remote-staging.toml`
  (antes del paso 1: `77c327da-432b-47c7-b5c9-25172e6e56a5`).
- **Esquema (solo si hiciera falta):** `database/rollback/0028_assistant_media_items.down.sql`; marcador de staging
  previo a 0028: `0000047b-00000000-00005122-897b7c32af761b1fc662c542938bcade`.
- Producción: nada que revertir. Para publicarla harían falta las migraciones 0024→0028 antes del código y las dos
  variables vacías por defecto.

## Cómo probar en staging (tiendas ficticias 1 y 94)

Por el bot de Telegram de staging: enviar 3–5 fotos de un producto → nota de voz «estos son tenis rojos, del 38 al
42, cinco de cada talla, a ciento ochenta mil» → revisar el resumen → «cambia el precio a 170 mil» → «quita la
tercera» → cancelar o guardar. Por el WhatsApp de staging (WAHA): enviar fotos de dos productos → «listo» → nota de
voz con tallas y precio sin nombrar el producto → elegir «el 2» → «sí».

Repetir el banco: `npx vitest run src/services/assistant/agent/bank/media.bank.test.ts` (modelo simulado) ·
`BANK_REAL=1 GEMINI_API_KEY=… MEDIA_BANK_OUT=<carpeta> BANK_RUN=1 npx vitest run …/media.bank.test.ts` (visión y
planificador reales sobre una foto real) · `node scripts/agent-media-bank-runs.mjs <carpeta> --fallos`.
