# TiendIA Exprés: bot inteligente y control de mensajes por plan

Rama de trabajo aislada: `feat/telegram-ia-planes` (carpeta `catalogo-lite-bot`, creada desde `main` = `2f0c411`). No se desplegó nada ni se leyó ni se modificó ningún dato real.

Leyenda del estado: **Implementado y probado** · **Propuesto, requiere autorización** · **Pendiente**.

## 1. Auditoría del bot actual (fase 0)

### 1.1 Lo que ya existe y se conserva

| Área | Estado en `main` |
|---|---|
| Recepción | `POST /api/telegram/webhook`: exige el secreto de Telegram (403 sin él), solo chats privados, autoriza por el **ID numérico** (nunca por nombre de usuario), limita a 20 mensajes por minuto y chat, e ignora los reenvíos de un mismo `update_id` (`processed_updates`). |
| Vinculación y tiendas | Código de un solo uso. La tienda activa sale de las membresías del usuario, nunca de un dato que envíe él. Una conversación por usuario y tienda. |
| Seguridad de cambios | Toda modificación pasa por vista previa, confirmación y aplicación atómica con token de ejecución: no se aplica dos veces, se rechaza si los datos cambiaron, y deja auditoría e historial de inventario. |
| IA | Gemini, solo desde el servidor. La salida se valida con esquemas; la IA **no ve identificadores ni ejecuta**, y no puede proponer acciones internas (`update_variant_stocks`, `update_product_images`). |
| Voz | Existe. Valida que sea OGG real, máximo 10 MB y 120 s. El audio **nunca se guarda**: pasa en memoria. Una sola llamada a Gemini transcribe e interpreta. |
| Intérprete comercial | Motor determinista (`assistant/commerce/`): cantidades, precios, tallas y colores, resolución del producto real, preguntas de aclaración, correcciones, cambio de tema. |
| Pedidos y guías | Estados, historial y guías por foto (ya en producción). |
| Consumo de IA | Presupuesto mensual por tienda **en costo estimado** (`stores.ai_monthly_budget_micros`, tabla `ai_usage_monthly`). Interruptor por tienda (`ai_enabled`) y alerta de porcentaje. Créditos aparte para fotos y PDF (`ai_credit_*`). |
| Errores | `platform_events` (sin contenido privado) y registro del uso por llamada. |

### 1.2 Problemas encontrados

Se midieron contra los ejemplos exactos de la especificación, sin IA.

| # | Problema | Gravedad |
|---|---|---|
| 1 | **9 de los 13 mensajes de la especificación no se interpretaban** (rangos «de la 38 a la 42», «M 5, L 8, XL 3», «28 dos, 30 cinco y 32 una», números en palabras). | Alta |
| 2 | «Llegaron 10 camisetas negras talla M y 8 talla L» **perdía las 10 de la talla M** y preguntaba por unidades que no faltaban. | Alta |
| 3 | `ciento ochenta mil` se leía como **80.000** (debía ser 180.000). Se mostraba en la vista previa, pero el error estaba. | Alta |
| 4 | Un precio «180» sin escala se aceptaba en silencio como $180 al crear un producto. | Media |
| 5 | «Agrega unos tenis Nike…, referencia NK203, tallas…, cinco de cada una» no capturaba referencia, tallas ni cantidades. | Media |
| 6 | Una referencia que ya existía no se detectaba antes de crear el borrador. | Media |
| 7 | Las propuestas de inventario y precio no tenían botón **Corregir**. | Media |
| 8 | La voz y el intérprete no se podían apagar con una bandera. | Baja |
| 9 | **Las funciones por plan no se aplican.** `features_json` (incluida «voz» y «asistente_ia») solo se comprueba para el dominio propio. Hoy cualquier tienda con IA activa usa voz; lo único que limita es el presupuesto en costo. | Informativo (fase 2) |
| 10 | **No existe un contador de mensajes** ni un ciclo de facturación por tienda: el periodo es el mes calendario en UTC. El plan «Promocional» no existe en el código ni en las migraciones, así que **no hay constancia de la cuota de 300 mensajes** que mencionas. | Informativo (fase 2) |

### 1.3 Riesgos de compatibilidad

- Los planes que existen son `basico`, `profesional`, `premium` y `legacy`. La conversión de pruebas a tienda (`trialConversion`) y el bot maestro los usan por código, así que **no se renombran ni se reemplazan**.
- Los planes Emprendedor, Negocio y Mayorista **no existen en el backend** (la rama de la landing con esos planes está sin publicar). Si se agregan filas activas a `plans`, aparecerían de inmediato en el bot maestro y en el panel de plataforma. Por eso se propone crearlas **inactivas**.
- Cualquier restricción nueva de mensajes toca contratos vigentes: debe empezar en modo **sombra** (cuenta sin bloquear).

## 2. Fase 1: bot más inteligente

### Implementado y probado

| Mejora | Detalle |
|---|---|
| Números en palabras | «treinta y ocho» → 38; «ciento ochenta mil» → 180.000; «doscientos cincuenta mil», «treinta y cinco mil». |
| Disposiciones de tallas | Rango con «de cada una» (`38 a 42, tres de cada talla`), lista con «de cada una» (`tallas 38, 39 y 40, cinco pares de cada una`), talla primero (`M 5, L 8, XL 3`, `talla M, 5 unidades`, `28 dos unidades, 30 cinco y 32 una`) y cantidad primero con tallas dichas en palabras. |
| Cantidad sin talla propia | «10 camisetas negras talla M y 8 talla L» → M:10, L:8. Si las tallas suman el total («10 camisetas, 4 M y 3 L») se sigue leyendo como total. |
| Crear de una frase | Nombre, marca, color, referencia, tallas con unidades y precio. Se muestra el resumen con el total y el borrador pide solo lo que falta (foto, descripción, categoría). |
| Verbos | «Créame/registra/publica» = producto nuevo. «Agrega/añade» es producto nuevo **solo con artículo** («agrega unos tenis…»); «agrega 3 negras talla 38» es reposición. |
| Referencia duplicada | Si la referencia existe, no se crea otro producto: se pregunta si son unidades del mismo («Sumar a …») y la suma pasa por la confirmación normal. |
| Referencia como identificador | «tenis AD223» identifica ese producto con certeza; solo busca en la tienda activa. |
| Precio ambiguo | «precio 180» o «180» no se asume: se pregunta «¿$180 o $180.000?» con botones, tanto al crear como al cambiar un precio. |
| Botón **Corregir** | En propuestas de inventario, precio y producto: la propuesta sigue pendiente, la corrección se escribe o se dicta («las M son 5, no 3») y se muestra un resumen nuevo antes de guardar. La propuesta anterior se descarta sin aplicarse. |
| Banderas | `TELEGRAM_SMART_INTERPRETER_ENABLED=false` y `TELEGRAM_VOICE_ENABLED=false` devuelven el comportamiento anterior sin tocar datos. Por defecto, ambas están activas (como hoy). |

**Prueba omitida:** `src/testing/photo-real.test.ts` es una prueba manual contra el modelo de imagen real; solo corre con `RUN_REAL_AI=1` y gasta cuota de la clave local. No forma parte de la suite normal y no depende de esta rama.

**Seguridad del inventario (`safety.conversation.test.ts`, 11 pruebas):** producto nuevo vs reposición, sumar vs fijar el total, doble confirmación y reenvío del mismo mensaje, propuesta vencida por cambio de inventario o de precio, corrección por una nueva instrucción («no, eran 5»), aislamiento entre tiendas (referencia ajena, `store_id` falso en botones) y contenido hostil.

**Pruebas:** 481 en total (las 469 anteriores intactas, más 12 de lenguaje y 11 de conversación nuevas). Todas en fictícias; ninguna toca inventarios reales.

### Pendiente en la fase 1

| Tema | Situación |
|---|---|
| Notas de voz reales | Probadas con audio simulado. Hace falta una prueba con una nota de voz real en un entorno autorizado (criterio de aceptación 3). |
| Confianza de la transcripción | Gemini no devuelve un nivel de confianza. Hoy el bot **muestra siempre lo que entendió** y pide confirmación antes de guardar. Una confirmación «específica» por valor dudoso (por ejemplo cantidades dichas en palabras) se puede agregar, pero necesita una regla acordada. |
| Respuestas rápidas asíncronas / colas | La conversación responde dentro del webhook (una llamada a la IA). Las colas de Cloudflare no se usan; solo se justifican si se miden tiempos lentos. **No se prometen tiempos.** |
| Máquina de estados de «Interpretando/Ejecutando» visible | Los estados existen internamente (pendiente, aplicando, aplicada, vencida, cancelada) y una operación pendiente vence a los 15 minutos. No hay un mensaje de «estoy procesando» separado. |

## 3. Fase 2: planes y cuota de mensajes (propuesta, nada implementado)

Tu especificación pide expresamente proponer antes de migrar, contratar o restringir. Todo lo siguiente **requiere tu autorización**.

### 3.1 Modelo de cuota

**Contador.** Una tabla nueva `ai_message_ledger` registra una fila por mensaje con IA:

- Clave única `(tienda, ciclo, identificador del mensaje de Telegram)`. Así un reintento de Telegram o dos llamadas a la IA dentro del mismo mensaje cuentan **una sola vez**.
- Estados: `reservado` → `consumido`, o `liberado` si el proveedor falla antes de responder (no cuenta).
- Reserva atómica en **una sola sentencia** (`INSERT … SELECT … WHERE conteo < límite`), así dos mensajes simultáneos cerca del límite no lo superan.

**Qué cuenta.**
- Cuenta: un mensaje de texto o de voz del comerciante que necesita IA (interpretación, descripción, consejos, preguntas).
- No cuenta: ayuda, comandos, botones, consultas deterministas, confirmaciones de una operación ya procesada, ni los avisos del bot.
- Una nota de voz es **un mensaje** (una sola llamada transcribe e interpreta).
- Se administran por separado, sin mezclar: mensajes de Telegram, fotos (créditos), descripciones con IA, lectura de guías (créditos) y costo de transcripción (informativo).

**Ciclo.** Hoy no existe. Propuesta: columna `stores.ai_cycle_anchor_day` (1 a 28). Si está vacía, **mes calendario en hora de Colombia**, que es el comportamiento equivalente al actual. Permite alinear el ciclo con la fecha de activación de cada tienda **sin migrar datos**.

**Límite.** Columnas nuevas `plans.ai_monthly_messages` (vacía = sin tope) y `stores.ai_monthly_messages_override` (para casos contractuales).

**Planes.** Filas nuevas en `plans`, **inactivas** hasta que apruebes los valores, con el código y el precio propuestos:

| Plan | Código | Setup | Mensual | Anual | Mensajes IA/mes |
|---|---|---|---|---|---|
| Emprendedor | `emprendedor` | $149.000 | $59.900 | $599.000 | **500** |
| Negocio | `negocio` | $199.000 | $99.900 | $999.000 | sin tope numérico, con uso razonable |
| Mayorista | `mayorista` | $299.000 | $169.900 | $1.699.000 | sin tope numérico, con uso razonable |

Los planes `basico`, `profesional`, `premium` y `legacy` **no se tocan**.

**Modos de despliegue** con una variable `AI_MESSAGE_QUOTA_MODE`:
- `off`: no cuenta (hoy).
- `sombra`: cuenta y registra, **sin bloquear** (para medir uso real antes de restringir).
- `aplicar`: bloquea al llegar al tope.

**Avisos.** Al 80 % y al agotarse, una sola vez por ciclo. Consulta con `/consumo` o «¿cuántos mensajes me quedan?». Al agotarse siguen funcionando la ayuda, las consultas deterministas, la cancelación y las confirmaciones pendientes (nunca queda una operación confirmada a medias).

### 3.2 Negocio y Mayorista: política de uso razonable (para tu aprobación)

El beneficio comercial es «conversaciones ilimitadas». Para no contradecirlo, **no se propone ningún bloqueo**:

| Control | Propuesta |
|---|---|
| Técnico (ya existe) | 20 mensajes por minuto por chat. |
| Monitoreo | Alerta interna cuando una tienda supere un umbral diario de mensajes con IA (propuesta inicial: 300 por día para Negocio y 1.000 para Mayorista), **solo para revisión**, sin cortar el servicio. |
| Aviso al comerciante | Mensaje amable y de soporte si el uso mensual supera un umbral de revisión (propuesta inicial: 3.000 Negocio y 10.000 Mayorista). **No suspende nada.** |
| Medida real | Solo ante abuso técnico demostrable (automatizaciones, bucles), con aviso previo y soporte, y con condiciones que tú apruebes por escrito. |

### 3.3 Plan «Promocional»

El código no tiene huella de ese plan ni de una cuota de 300. Para respetar los derechos vigentes hay que **identificar esas tiendas**, lo que requiere consultar producción (la consulta de lectura quedó sin autorizar en esta sesión). Una vez identificadas, se les puede fijar `ai_monthly_messages_override = 300` con un cambio de datos autorizado. No se migran automáticamente.

### 3.4 Panel y superadministrador

- El comerciante vería: estado del bot, plan, Telegram vinculado, mensajes usados y disponibles, ciclo, última actividad y errores recientes.
- El superadministrador vería los mismos datos de todas las tiendas, además de costos anómalos y auditoría de operaciones, sin el contenido de las conversaciones.
- Propuesta: primero la API y el comando `/consumo`, y después las pantallas.

## 4. Fase 4: arquitectura de IA (propuesta)

El flujo actual ya cumple casi todo: identificar la intención sin IA cuando es posible, usar la IA solo si hace falta, convertir a datos estructurados, validar, pedir confirmación, ejecutar con los servicios existentes y registrar. **No se recomienda cambiar de proveedor.** La voz ya usa Gemini con una sola llamada, así que no se introduce un servicio de transcripción adicional ni un costo nuevo.

### Estimación de costo (supuestos, no medición)

Con los precios por defecto del código (US$0,30 por millón de tokens de entrada y US$2,50 por millón de salida) y una llamada típica de ~900 tokens de entrada y ~80 de salida:

| Concepto | Costo estimado |
|---|---|
| Un mensaje de texto con IA | ≈ US$0,0005 |
| Una nota de voz de ~20 s (el audio suma ~650 tokens) | ≈ US$0,0007 |
| 500 mensajes al mes (Emprendedor) | ≈ US$0,25 |
| 3.000 mensajes al mes (uso intenso de Negocio) | ≈ US$1,5 |
| 10.000 mensajes al mes (uso intenso de Mayorista) | ≈ US$5 |

**Pendiente validar** con el consumo real (`ai_usage_events`) y el modelo y precio vigentes de producción. La lectura de ese dato en producción necesita tu autorización.

## 5. Resumen de decisiones que necesito

| # | Decisión | Mi recomendación |
|---|---|---|
| 1 | Modelo de ciclo: ancla por tienda (día de activación) o mes calendario | Columna de ancla opcional; vacía = mes calendario en hora de Colombia |
| 2 | Crear los planes Emprendedor, Negocio y Mayorista como filas inactivas y activarlas luego | Sí, inactivas |
| 3 | Autorizar una lectura de solo consulta en producción: tiendas por plan y consumo real | Sí |
| 4 | Política de uso razonable de Negocio y Mayorista (§3.2) y umbrales | Monitoreo y avisos; sin bloqueos |
| 5 | Contar una nota de voz como un mensaje | Sí |
| 6 | Empezar la cuota en modo sombra antes de aplicarla | Sí, al menos un ciclo |
| 7 | Orden: ¿API y `/consumo` primero y las pantallas después? | Sí |

## 6. Despliegue y reversión

- **Esta rama no está desplegada.** Las mejoras de la fase 1 no necesitan migración: es solo el servidor. Para publicarlas se despliega `catalogo-lite-api`; el panel no cambia.
- **Reversión:** volver a la versión anterior del servidor, o apagar `TELEGRAM_SMART_INTERPRETER_ENABLED` y `TELEGRAM_VOICE_ENABLED` sin desplegar.
- **Fase 2 (cuando se apruebe):** migración aditiva `0023`, con su rollback. Solo agrega columnas y una tabla; no borra nada. Se aplica primero en staging.
