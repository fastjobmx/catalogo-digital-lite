# Estabilización y validación de las fases 1 y 2

Rama `feat/telegram-ia-planes` (carpeta `catalogo-lite-bot`). **No hay despliegue de producción, push ni merge. No se tocó ninguna tienda, ningún plan existente, el bot publicado, la landing, la rama `feat/landing-planes-seo`, el correo, Resend, los dominios ni MOSTRALO PUES!.** Complementa [TELEGRAM_IA_PLANES.md](TELEGRAM_IA_PLANES.md) y [TELEGRAM_IA_PLANES_FASE2.md](TELEGRAM_IA_PLANES_FASE2.md).

## 1. Correspondencia entre la oferta comercial y lo que aplica el backend

Los tres planes siguen **inactivos** y ninguna tienda está en ellos.

| Capacidad de la oferta | Emprendedor | Negocio | Mayorista | Dónde se guarda | ¿Qué hace realmente el backend? |
|---|---|---|---|---|---|
| Productos | 150 | 500 | Ilimitados | `plans.max_products`, `plans.products_unlimited` | **Bloquea** al llegar al tope (`PLAN_PRODUCT_LIMIT`) en panel, Telegram, lotes e importaciones. Con `products_unlimited = 1` no impone tope y no se inventó ningún número |
| Mensajes con IA por ciclo | 500 | Uso ampliado | Uso ampliado | `plans.ai_monthly_messages`, `ai_usage_policy` | Cuenta en `shadow`/`enforce`; solo `enforce` bloquea, y solo con tope numérico. Negocio y Mayorista: solo monitoreo |
| Mejoras de fotos con IA al mes | 50 | 150 | 400 | `plans.ai_photo_monthly` | **Solo se observa** (se muestra en `/consumo` y en la API). No bloquea; el consumo de fotos sigue regido por los créditos |
| Descripciones con IA al mes | 200 | Uso razonable | Uso razonable | `plans.ai_description_monthly` | **Solo se observa.** Ya no consumen la cuota de mensajes |
| Presupuesto de costo | Referencia de alerta | Referencia de alerta | Referencia de alerta | `plans.ai_monthly_budget_micros`, `ai_budget_policy = 'observe'` | **Solo alerta**; no interrumpe. Los planes existentes siguen en `enforced` |
| Funciones (`features_json`) | catálogo, pedidos, panel, Telegram, asistente, fotos IA, voz | + documentos | + documentos | `plans.features_json` | **No se aplica** salvo `dominio_propio` (ya existía). La voz se controla con la bandera global, no por plan |

Cambios de esta etapa respecto a la propuesta anterior: Emprendedor pasa de 500 a **150** productos, Negocio de 2.000 a **500**, Mayorista de 5.000 a **ilimitados**; se agregan las cifras de fotos y descripciones; y los presupuestos de US$2 / 6 / 10 dejan de ser límites.

### Diferencias detectadas entre las siete capas

| Capa | Hallazgo | Tratamiento |
|---|---|---|
| Oferta comercial | Incluye fotos y descripciones por mes; el sistema no tenía cuota mensual para ellas | Columnas nuevas y observación en el consumo |
| Configuración de planes | `max_products` es `NOT NULL` y `> 0`: no puede representar «ilimitado» | Marca `products_unlimited`; el valor 2147483647 de Mayorista es solo un marcador que el backend ignora y que la API nunca muestra |
| Límites del backend | Los topes de producto salen de `plans.max_products` vía `productLimit` (un solo punto) | `productLimit` respeta la marca; probado con 150, 500 y 501+ |
| Presupuesto de IA | Un solo presupuesto por tienda, mes calendario UTC, compartido por **todas** las funciones (mensajes, voz, descripciones, fotos). Con `budget <= 0` o gasto ≥ presupuesto **bloquea todo** | Política por plan: `enforced` (existentes) / `observe` (nuevos) |
| Consumo de mensajes | Ciclo de facturación; el presupuesto usa mes calendario UTC: **los dos se reinician en fechas distintas** | Documentado; el presupuesto de los planes nuevos ya no bloquea |
| Créditos fotográficos | Es un saldo manual (recargas) con costo por función; no hay cuota mensual incluida | La cuota de 50/150/400 se observa; convertirla en bloqueo requeriría decidir si se carga como recarga mensual (pendiente, requiere tu criterio) |
| Funciones habilitadas | `features_json` casi no se lee | Se documenta; no se finge control que no existe |

## 2. ¿Puede el presupuesto de costo cortar un plan antes de su cuota de mensajes?

**Sí, con los planes existentes y con los valores provisionales anteriores.** El presupuesto es único y lo gastan por igual mensajes, voz, descripciones y fotos.

Supuestos verificables (precios por defecto del código: US$0,30 por millón de tokens de entrada y US$2,50 de salida; imagen: US$60 por millón de tokens de salida, valor de `wrangler.production.toml`):

| Concepto | Valor | Cómo se verificó |
|---|---|---|
| Interacción de texto típica (900 entrada + 60 salida) | 420 micro-USD (US$0,00042) | Prueba `plans.coherence.test.ts` (cálculo con las funciones reales) |
| Nota de voz real, una llamada (transcribe e interpreta) | **1.423 a 3.209 micro-USD** (US$0,0014 a 0,0032), 4 llamadas medidas con voz sintética de 4 y 12 s | Prueba manual con Gemini real, libro `ai_message_ledger` |
| Parte de audio de esa llamada (estimada a ~32 tokens/s) | 39 a 116 micro-USD | Cálculo; es una estimación, no una medición del proveedor |
| Una imagen (supuesto: ~1.290 tokens de salida) | ~77.400 micro-USD (US$0,077) | **Supuesto sin medir**; el propio código reconoce que el costo por imagen se mide con trabajos reales |

Consecuencias:

- Con los presupuestos provisionales (US$2 / 6 / 10), 50 / 150 / 400 fotos costarían ~US$3,9 / 11,6 / 31 y **cortarían el bot antes de llegar a la cuota** de mensajes. Se comprueba en una prueba.
- Solo con chat, 500 mensajes cuestan entre US$0,21 (estimación por defecto) y ~US$1,6 (si cada uno cuesta lo que costó la voz medida); el límite de US$2 quedaría muy ajustado. Una medición con texto real está pendiente.
- Las **referencias de alerta** nuevas (US$5 / 14 / 40) cubren las fotos incluidas más los mensajes de la oferta (y 3.000 / 10.000 mensajes de uso ampliado con la estimación por defecto). Son referencias de alerta, no límites comerciales.
- Los planes `basico`, `profesional`, `premium` y `legacy` **no cambian**: siguen `enforced` y se cortan al agotar su presupuesto (probado).
- Las protecciones duras siguen valiendo para todos: IA apagada por tienda, tienda suspendida y tope global de plataforma `PLATFORM_AI_MONTHLY_CAP_MICROS` (probado).

## 3. Migración 0023 en el D1 de pruebas

Se aplicó **solo** al D1 de pruebas. Comprobaciones previas:

| Verificación | Resultado |
|---|---|
| Base de pruebas | `sneakerhub-telegram-staging-db`, ID `18ac228c-c142-45c7-b801-6ae0c6e1f8eb` |
| Base de producción | `catalogo-lite-production-db`, ID `10b10054-9e28-4346-8b2b-a19323ed27f3`. **Distinta** |
| Bindings del Worker de pruebas (`wrangler.remote-staging.toml`) | D1 de pruebas y bucket R2 `sneakerhub-telegram-staging-assets`; producción usa `catalogo-lite-production-assets` |
| Datos | 1 tienda de configuración, 2 productos de prueba (`TEST-TRN-001 «Tenis de prueba»`, `DEMO-FOTO-2026`), 0 usuarios, 0 pedidos, 24 operaciones de un bot de pruebas del 2-3 nov. Etiqueta `STAGING - CATALOGO FICTICIO`. La configuración de tienda lleva el nombre «Tenis Manizales» (copia de la instalación original): no hay clientes ni pedidos |
| Copia de seguridad | Exportación SQL completa antes de tocar nada (212 KB, en la carpeta temporal de la sesión) y marcador de Time Travel `00000383-00000000-00005120-0e4374b3a54906107d6269815b0fde45` |
| Aditiva | La migración solo agrega columnas con valor por defecto, tablas nuevas y tres filas de plan inactivas; ninguna sentencia borra o modifica datos existentes |

**Hallazgo:** el D1 de pruebas estaba en un estado intermedio (registrado hasta 0010; de hecho con 0014 y 0015 aplicadas a mano y 0016-0022 sin aplicar). Al intentar el aplicador oficial, aplicó 0011-0013 (todas con `IF NOT EXISTS`, sin efecto sobre datos) y se detuvo en 0014 por columna duplicada. Para no tocar más de lo autorizado, **la 0023 se ejecutó directamente desde su archivo** (depende solo de tablas de la 0007) y no se aplicaron 0016-0022 ni se alteró el registro de migraciones. Esta deriva es previa y hay que resolverla antes de desplegar el Worker de pruebas con el código nuevo.

Resultado en el D1 de pruebas, después de aplicar: 7 planes (4 existentes idénticos y activos, 3 nuevos inactivos con los valores de la oferta), tiendas 1, productos 2, operaciones 24 (sin cambios), `foreign_key_check` con 0 violaciones, columnas nuevas presentes, libro vacío.

## 4. Pruebas del contador

Las ejecuta el código real (`messageQuota.ts`, `usage.ts`, `aiMessageAdmin.ts`) contra el D1 remoto de pruebas con tiendas sintéticas `qa-staging-*`, que se crean y se borran al final (`STAGING_D1_VALIDATE=1`, adaptador con guardia que aborta si el ID no es el de pruebas).

**Resultado verificado: 15 pruebas correctas, 0 fallidas, 0 pendientes (711 s).** Cubren: modo `off`; 1 mensaje; varias llamadas del modelo en una interacción; duplicados y reintentos; fallo del proveedor con liberación y reintento; 8 solicitudes simultáneas con tope 3 (entran exactamente 3); `shadow` sin bloquear; `enforce` solo en tiendas de prueba; avisos 80 % y 100 % una sola vez; cambio de ciclo y reinicio de periodo; cambio de plan; aislamiento entre tiendas; presupuesto de costo por separado (plan antiguo bloqueado, plan nuevo solo alerta); y la API administrativa. Las tiendas y filas sintéticas se borraron al final (verificado: 0 tiendas `qa-staging-*`, 0 filas en libro, avisos y eventos; conteos del D1 iguales a los de antes). Detalle del cierre en [TELEGRAM_IA_PLANES_CIERRE.md](TELEGRAM_IA_PLANES_CIERRE.md).

Además, 33 pruebas locales del contador y 10 de coherencia de planes (SQLite con las mismas migraciones). Nota de alcance: el Worker de pruebas **no se redesplegó** (es un despliegue y la base está en estado intermedio), por lo que `/consumo` y la API por HTTP se validan con las pruebas locales y las funciones de la API se ejecutan contra el D1 remoto.

## 5. Voz real

Prueba con **voz sintética en español (Windows, voz «Helena»)** convertida a OGG/Opus y procesada por el manejador real de Telegram y por **Gemini real**, con Telegram simulado y base en memoria con una tienda ficticia. No hay grabación humana ni bot conectado: eso requiere que grabes tú una nota (ver pendientes).

| Paso | Resultado |
|---|---|
| Nota 1 (12 s): «Agrega unos tenis Adidas blancos, referencia A D dos dos tres, tallas treinta y ocho, treinta y nueve y cuarenta, cinco pares de cada una, precio ciento ochenta mil pesos» | Transcrita: «…referencia AD223, tallas 38, 39 y 40, cinco pares de cada una, precio 180.000 pesos.» Propuesta: **Tenis Adidas blancos, ref. AD223, Adidas, $180.000, 38/39/40 × 5 = 15 u.** |
| Confirmación | Nada se guarda: queda un borrador pendiente |
| Nota 2 (4 s): «No, las treinta y nueve son seis, no cinco» | Transcrita «No, las 39 son 6, no 5.». **Fallo encontrado y corregido:** el borrador ignoraba la corrección (el punto final de la transcripción ocultaba el último número, y el borrador no admitía correcciones de cantidad). Ahora corrige la talla 39 a 6 (total 16) y el precio, sin guardar nada |
| Contador | 2 notas = 2 interacciones (`telegram_voice`, una llamada cada una), costo de audio aparte |
| Seguridad | El audio no se guarda; inventario real sin cambios; no se usó ningún bot ni tienda real |

Costo de la prueba: 4 llamadas, ≈ US$0,009 (estimado con los precios por defecto) con la clave local de pruebas. No se contrató ningún proveedor.

## 6. Diseño funcional del panel de consumo (sin interfaz todavía)

**Comerciante** (`GET /api/admin/ai-messages`, solo su tienda):

| Bloque | Contenido |
|---|---|
| Resumen | Plan; mensajes usados y disponibles con barra; fotos y descripciones usadas frente a lo incluido |
| Ciclo | Fecha de renovación y, si es mes calendario, aviso «ciclo provisional» |
| Historial resumido | Por día del ciclo: cantidad de interacciones (texto/voz), sin contenido |
| Advertencias | 80 %, 100 %, y mensaje claro de qué sigue funcionando (botones, ayuda, consultas) |

**Superadministrador** (`GET /api/platform/ai-messages` y detalle por tienda):

| Bloque | Contenido |
|---|---|
| Estado | Modo de cuotas (`off/shadow/enforce`) visible y destacado |
| Tiendas por plan | Conteo por plan y estado |
| Consumo por tienda | Usados/límite, fotos, descripciones, costo estimado, última actividad |
| Costos de IA | Costo por tienda y total del ciclo (siempre rotulado «estimado») |
| Alertas y anómalos | 80/100 %, volumen diario, bucles; fallos de procesamiento desde eventos de plataforma |

Privacidad: ningún bloque muestra texto de conversaciones ni audio; el libro guarda solo un hash corto del texto para detectar bucles. Aislamiento: cada tienda solo ve la suya (probado) y las rutas de plataforma exigen superadministrador.

## 7. Riesgos pendientes

1. **El presupuesto de costo único** es el principal riesgo de coherencia: los planes existentes lo conservan; los nuevos solo alertan, así que sin cuota de fotos aplicada no hay freno propio al gasto de fotos (solo créditos y el tope global).
2. Costos de imagen y de texto reales **sin medir**; hay que medirlos en `shadow` o con una lectura agregada autorizada.
3. El D1 de pruebas está en estado intermedio y su registro de migraciones no refleja la realidad.
4. Los reinicios del presupuesto (mes UTC) y de la cuota (ciclo de facturación) no coinciden.
5. Las cuotas de fotos y descripciones son solo informativas; convertirlas en límite requiere decisión comercial.
6. Mayorista guarda 2147483647 como marcador interno; cualquier código futuro debe usar `products_unlimited`.
7. Voz: probada con voz sintética; falta una nota humana real y la confianza de transcripción.
8. La política de uso razonable de Negocio y Mayorista sigue por definir.

## 8. Plan de publicación gradual

1. Resolver la deriva del D1 de pruebas (aplicar 0016-0022 en pruebas con tu orden) y redesplegar el Worker **de pruebas**; repetir `/consumo`, alertas y voz con un bot de pruebas real y tu nota de voz.
2. Revisar costos reales con una lectura agregada de `ai_usage_events` (requiere tu autorización) y confirmar presupuestos de referencia.
3. Con tu autorización: aplicar 0023 en producción (aditiva, sin efecto con el modo `off`) y desplegar el Worker con `AI_MESSAGE_QUOTA_MODE` sin definir.
4. Activar `shadow` al menos un ciclo y revisar consumo, costos y señales.
5. Activar los planes (uno a uno, solo para tiendas que contraten) tras confirmar la oferta y la política de uso razonable.
6. `enforce` solo para planes con tope numérico y con tu autorización expresa.

## 9. Reversión

- Inmediata: `AI_MESSAGE_QUOTA_MODE=off` (o quitar la variable).
- Planes nuevos: siguen inactivos; para retirarlos, el rollback `0023` los borra si ninguna tienda los usa.
- Esquema: `database/rollback/0023_ai_message_quota.down.sql` (probado con datos y volviendo a aplicar la migración).
- Código: volver a la versión anterior del Worker; la fase 1 se apaga con sus dos banderas.
- Datos de pruebas: restaurar con el marcador de Time Travel o la exportación guardada.
