# Estudio Creativo IA · Fase 1

> **TiendIA Exprés** · metadatos «Tienda IA Express» · módulo **Estudio Creativo IA**
> «Crea contenido profesional, organiza campañas y descubre oportunidades para tu negocio».

Rama: `feat/estudio-creativo-fase1`. Sale de `feat/dominio-seo-correo` (y no de `main`) porque esa rama tiene la migración 0019, que `main` todavía no tiene. Sigue la numeración desde 0020.
Estado: **no se ha desplegado nada y no se ha aplicado ninguna migración remota.** Antes de publicar hace falta autorización expresa (ver «Despliegue»).

> **Fase 3 (fábrica de creativos y video comercial):** ver [FABRICA_CREATIVOS_FASE3.md](FABRICA_CREATIVOS_FASE3.md).
>
> **Fase 2 (estudio fotográfico, biblioteca y lotes):** ver [ESTUDIO_FOTOGRAFICO_FASE2.md](ESTUDIO_FOTOGRAFICO_FASE2.md). Algunos datos de este documento cambiaron allí: los límites de la cola de trabajos y el estado de los módulos de biblioteca y fotografía.

Los identificadores técnicos no cambian: Workers `catalogo-lite-api` y `catalogo-digital-ia`, D1 `catalogo-lite-production-db`, R2 `catalogo-lite-production-assets`. No se tocó MOSTRALO PUES! (`apps/mostralopues-landing`).

---

## 1. Diagnóstico (lo que ya existe)

| Área | Qué hay hoy | Dónde | Se reutiliza en el estudio |
|---|---|---|---|
| Frontend | React 19 + TS + Vite + Tailwind, en Workers Static Assets (`catalogo-digital-ia`) con service binding `API` | `frontend/`, `frontend/cloudflare/worker.js` | Sí: el estudio son páginas nuevas dentro del mismo panel |
| Backend | Hono en Workers (`catalogo-lite-api`), D1 `DB`, R2 `ASSETS`, cron `*/15` | `worker/src/index.ts` | Sí: una ruta nueva `/api/creative` |
| Panel admin | `/admin/*` con menú por grupos (`ADMIN_NAV_GROUPS`) | `frontend/src/admin/AdminLayout.tsx` | Sí: grupo nuevo «Estudio Creativo IA» |
| Autenticación | JWT (`jose`). Superadmin definido solo por secretos del Worker; usuarios en `platform_users`. Las sesiones caducan cuando cambia la contraseña | `worker/src/services/auth.ts`, `middleware/auth.ts` | Sí: `adminAuth` |
| Multi-tenant | `stores`, `store_memberships` (owner, admin, operator, seller, inventory), capacidades en `ROLE_CAPABILITIES`. La tienda la resuelve el backend (`X-Store-Slug` / dominio), nunca un id que mande el cliente | `worker/src/tenancy/` | Sí: capacidad existente `marketing.manage` (owner y admin) |
| Productos | `products`, `product_variants`, `categories` con `store_id` | migraciones 0001, 0007, 0009 | Sí (contratos de foto, video, creativos y oportunidades) |
| Biblioteca de imágenes | No existe como biblioteca. Las imágenes se suben a R2 en `stores/<id>/<carpeta>/…` y se sirven en público en `/api/assets/*` (salvo `telegram-drafts/`, `trials/`, `order-docs/`). `findForeignAssetUrl` impide usar imágenes de otra tienda | `routes/upload.ts`, `lib/assets.ts` | Sí: el logo del Brand Kit usa la subida existente (carpeta `store`) |
| «Estudio IA» actual | Mejora una foto de producto con 3 estilos fijos (Gemini image), con créditos e idempotencia. Nunca reemplaza el original | `ai/imageStudio.ts`, `services/aiCatalog.ts`, `admin/pages/Studio.tsx` | Se mantiene sin cambios. El motor fotográfico futuro lo reutilizará |
| Telegram | Bot por tienda y bot maestro, lotes de fotos → productos, guías de envío | `services/telegram*.ts`, `routes/telegram.ts` | No en la fase 1 |
| Créditos | Ledger con solo inserciones (`ai_credit_ledger`): reserva → consumo/liberación, idempotencia, recargas del superadmin, solicitudes. Precio por función en `ai_credit_costs` | `ai/credits.ts` (migración 0011) | Sí: es el único saldo. El estudio no crea otro |
| Consumo de IA | `ai_usage_events` y `ai_usage_monthly`, presupuesto mensual por tienda, tope de la plataforma | `ai/usage.ts` | Sí: hace las veces de `ai_usage_ledger` (no se crea esa tabla) |
| Modelos Gemini | Texto/visión: `GEMINI_MODEL` (por defecto `gemini-3.8-flash`). Imagen: `GEMINI_IMAGE_MODEL = gemini-3.1-flash-image` (producción). Clave en el secreto `GEMINI_API_KEY` | `ai/geminiClient.ts`, `wrangler.production.toml` | Sí: el enrutador los toma tal cual |
| Segundo plano | Solo cron cada 15 min (limpiezas, reservas vencidas, entregas de correo). **No hay Cloudflare Queues** | `index.ts` → `scheduled` | Sí: se agregó el mantenimiento de trabajos creativos |
| Métricas | Pedidos (`orders`, `order_events`) y estadísticas del panel. **No se registran visitas** en ninguna tabla | `routes/admin.ts /stats`, `routes/orders.ts` | La analítica futura leerá pedidos. Las visitas quedan pendientes |
| Planes | `plans` (basico, profesional, premium, legacy) con `features_json` y presupuesto de IA; precios en 0 hasta que el operador los defina | migración 0007 | Pendiente: decidir en qué planes entra el estudio |
| Marketing | `campaigns` (mensajes de WhatsApp con cupón, borrador → aprobada), `coupons`, `customer_contacts` | migración 0010 | La futura «campaña creativa» debe convivir con esta tabla, no duplicarla |
| Auditoría | `audit_log` con `store_id` | — | Sí |

## 2. Arquitectura propuesta

```
Panel (React)                     API catalogo-lite-api (Hono)
/admin/estudio-creativo  ──────►  /api/creative/*  ── adminAuth + requireCapability('marketing.manage')
/admin/estudio-creativo/brand-kit         │
                                          ├─ creative/brandKit.ts   BrandKitService      (implementado)
                                          ├─ creative/jobs.ts       CreativeJobService   (implementado)
                                          ├─ creative/aiRouter.ts   enrutador de IA      (implementado, puro)
                                          ├─ creative/modules.ts    estado real de cada módulo
                                          └─ creative/contracts.ts  contratos de los 10 servicios
                         reutiliza: tenancy/*, ai/credits.ts, ai/usage.ts, lib/assets.ts, audit_log, R2
```

### Contratos de servicio (`worker/src/creative/contracts.ts`)

Cada servicio recibe un `CreativeContext { storeId, actor, role }` construido por la ruta a partir de `adminAuth`. Ningún servicio conoce la implementación de otro.

| Servicio | Contrato | Fase 1 |
|---|---|---|
| Brand Kit | `BrandKitService.get/update` | **Implementado** |
| Trabajos | `CreativeJobService.create/get/list/cancel` | **Implementado** (sin motores conectados) |
| Biblioteca de recursos | `AssetLibraryService` (originales privados en `creative-private/stores/<id>/…`, lectura firmada) | Contrato. Ya está reservado el prefijo privado |
| Motor fotográfico | `PhotoEngine.enqueue` (reutilizará `ai/imageStudio.ts`) | Contrato |
| Motor de video | `VideoEngine.enqueue` | Contrato |
| Creativos publicitarios | `AdCreativeEngine.enqueue` (plantillas + render convencional) | Contrato |
| Oportunidades | `OpportunityEngine.scan/list` (solo datos reales: pedidos, inventario) | Contrato |
| Campañas | `CampaignEngine.draft/attachContent` (sobre la tabla `campaigns` existente) | Contrato |
| Analítica comercial | `CommercialAnalyticsService.summary` (`visits: null` mientras no se registren visitas) | Contrato |
| Aprobaciones | `ApprovalService.request/decide` | Contrato |
| Control de créditos | `CreativeCreditsService` sobre `ai/credits.ts` (no hay segundo saldo) | Contrato. Se usa el ledger existente |

### Enrutador de IA (`worker/src/creative/aiRouter.ts`)

- Tareas separadas: `texto`, `vision`, `edicion_foto`, `imagen`, `video`, `render` (convencional, sin IA).
- Catálogo efectivo = lo que ya está configurado (Gemini: `GEMINI_MODEL` para texto/visión y `GEMINI_IMAGE_MODEL` para edición/generación de imagen) + entradas opcionales en la variable `CREATIVE_AI_MODELS` (JSON **sin secretos**: solo el nombre del secreto que se necesita).
- `routeTask` elige según disponibilidad (credencial presente, modelo habilitado, no descontinuado, no preview salvo `allowPreview`), resolución mínima, costo máximo y preferencia (`calidad` | `costo` | `latencia`). Devuelve alternativas para usar si el primero falla. `maxConcurrent` deja definido el límite por modelo.
- **No cambia el proveedor actual**: `gemini.ts` e `imageStudio.ts` siguen funcionando igual. El enrutador solo se usará en los motores nuevos.
- Costo por unidad: queda en `null` (desconocido) para Gemini, porque el precio configurado es por millón de tokens y no por imagen. No se inventan precios; se medirá con `ai_usage_events`.

Ejemplo de `CREATIVE_AI_MODELS` (cuando se conecte un proveedor de video):
```json
[{"provider":"gemini","model":"gemini-omni-1.2-flash","tasks":["video"],"requiresSecret":"GEMINI_API_KEY","quality":2,"latency":3,"maxConcurrent":1}]
```

#### Verificación de modelos (documentación oficial de Gemini API, consultada el 2026-11-10)

`ai.google.dev/gemini-api/docs/models` redirige a `aistudio.google.com/docs/models`.

| Uso | Modelo | Estado según la documentación | Decisión |
|---|---|---|---|
| Texto / visión | `gemini-3.8-flash` (valor por defecto del código) | Nuevo, listado | Se mantiene |
| Edición / generación de imagen | `gemini-3.1-flash-image` (producción) | Estable | Se mantiene, ya cumple |
| Imagen (alternativas) | `gemini-3-pro-image`, `gemini-3.1-flash-lite-image`, `gemini-nano-banana-2.1` | Estable / estable / nuevo | Candidatos a evaluar por costo y calidad |
| Video | `gemini-omni-1.2-flash` (con audio nativo) | Nuevo | Candidato para el motor de video. Veo no aparece en esa página |
| Imagen (Imagen 4) | `imagen-4.0-generate` | **Apagado** | Bloqueado en `RETIRED_MODELS` |
| Otros retirados | `gemini-2.0-flash*`, `gemini-3-pro-preview`, `gemini-3.1-flash-lite-preview`; `gemini-2.5-flash` / `gemini-2.5-pro` (retirados, se redirigen el 1-dic-2026) | Apagados o en retiro | Bloqueados |

Límites de esta verificación: se hizo leyendo la documentación, **no con llamadas reales a la API** (no hay que manipular la clave de producción desde aquí). Antes de conectar un motor hay que hacer una llamada de prueba autorizada con la clave del entorno (por ejemplo `models.get`) y repasar la página de retiros (`aistudio.google.com/docs/deprecations`, que no se pudo consultar en esta sesión).

## 3. Modelo de datos

**Tablas que se reutilizan (no se duplican):** `stores`, `store_memberships`, `store_config` (logo y color de Apariencia se ofrecen como sugerencia), `products`/`product_variants`/`categories`, `ai_credit_ledger`/`ai_credit_costs` (créditos), `ai_usage_events`/`ai_usage_monthly` (en lugar de un `ai_usage_ledger` nuevo), `audit_log`, `campaigns` (la futura campaña creativa la extenderá), `orders`/`order_events` (analítica).

**Migración creada:** `database/migrations/0020_creative_studio.sql` (solo agrega cosas) · rollback `database/rollback/0020_creative_studio.down.sql`.

| Tabla | Contenido |
|---|---|
| `brand_kits` | Una fila por tienda (`store_id` PK, `ON DELETE CASCADE`): nombre de marca, eslogan, tono, público objetivo, logo, colores, tipografías, estilos visuales, plantillas favoritas y `revision` para detectar ediciones simultáneas |
| `creative_jobs` | `id` UUID, `store_id`, `kind` (foto/video/creativo/oportunidades/campana/analitica), `status` (pendiente/en_proceso/completado/fallido/cancelado), `UNIQUE(store_id, idempotency_key)`, `credit_reservation_id` → `ai_credit_ledger`, proveedor/modelo, intentos, fechas y `expires_at` (retención de 90 días) |

**Tablas evaluadas y no creadas todavía** (se crearán con su motor, en una migración 0021+): `creative_assets` (biblioteca), `creative_templates`, `campaign_content` (vínculo campaña ↔ trabajo/recurso sobre `campaigns`), `opportunities`, `content_approvals`, `metrics_daily` (pedidos agregados + visitas cuando existan). `ai_usage_ledger` no hace falta: ya existe `ai_usage_events`.

## 4. Seguridad

- **Aislamiento por tienda:** todas las consultas filtran por `store_id` tomado de `adminAuth`. Un trabajo de otra tienda responde 404 (no revela que existe). La misma clave de idempotencia en dos tiendas crea dos trabajos distintos.
- **Permisos en el backend:** `/api/creative/*` exige sesión, pertenencia activa y la capacidad `marketing.manage` (owner/admin; el superadmin pasa). Vendedor, operador e inventario reciben 403.
- **Originales privados:** el prefijo `creative-private/` está bloqueado en la ruta pública `/api/assets/*` (probado). La biblioteca servirá esos objetos solo con permisos y enlaces de corta duración.
- **Logo:** solo se acepta un recurso de la propia tienda o `https`. `javascript:` y recursos de otra tienda se rechazan.
- **Auditoría:** `brand_kit_updated`, `creative_job_created` y `creative_job_cancelled` quedan en `audit_log` con `store_id`.
- **Idempotencia:** `Idempotency-Key` obligatoria al crear trabajos. Si la clave se reutiliza con otro tipo de trabajo, se rechaza.
- **Concurrencia y abuso:** (valores de la fase 1; en la fase 2 pasaron a 100 en cola, 300 por hora y 2 ejecutándose a la vez) como máximo 3 trabajos activos por tienda y 30 por hora, verificados en la misma sentencia `INSERT … SELECT … WHERE` (dos solicitudes simultáneas no pasan el límite). Entrada de máximo 8 KB. Brand Kit con listas cerradas y longitudes máximas.
- **Créditos:** se usan la reserva y la liquidación existentes. Si un trabajo se cae (más de 30 min «en proceso») o se cancela, se libera su reserva y la tienda no paga.
- **Secretos:** ninguno nuevo. El resumen del panel dice si hay un modelo configurado, pero no muestra claves (probado).
- **Retención:** el cron borra los trabajos terminados cuando pasa su `expires_at` (90 días).
- **Caché:** las respuestas de `/api/creative/*` llevan `Cache-Control: private, no-store`.

## 5. Lo implementado en la fase 1

### Rutas de la API (`worker/src/routes/creative.ts`, montadas en `/api/creative`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/overview` | Nombre, descripción, estado real de cada módulo y qué tareas de IA tienen un modelo configurado |
| GET | `/brand-kit` | Brand Kit de la tienda (vacío al principio) + sugerencias de Apariencia + listas permitidas |
| PUT | `/brand-kit` | Guarda cambios parciales con `revision` (409 si alguien más lo cambió) |
| GET | `/jobs?status=` | Trabajos de la tienda |
| GET | `/jobs/:id` | Un trabajo de la tienda (404 si es de otra) |
| POST | `/jobs` | Responde **409 `ENGINE_UNAVAILABLE`**: aún no hay motores conectados, así que no se crean trabajos que nunca se ejecutarían |
| POST | `/jobs/:id/cancel` | Cancela un trabajo pendiente y libera su reserva |

### Panel

- Grupo nuevo de menú **«Estudio Creativo IA»**: «Estudio Creativo» (`/admin/estudio-creativo`) y «Brand Kit» (`/admin/estudio-creativo/brand-kit`).
- La página de inicio muestra el estado real de los módulos («Disponible», «Base lista», «Próximamente»), la lista de trabajos (vacía y explicada) y qué tareas de IA tienen modelo. No hay datos de ejemplo.
- El Brand Kit se puede editar: el logo usa la subida existente, hay hasta 6 colores, 3 tipografías permitidas, 5 estilos y el tono se elige de una lista. Los datos de Apariencia se ofrecen con un botón, nunca se copian solos. Plantillas favoritas: «próximamente».
- El «Estudio IA» actual (`/admin/estudio`) sigue intacto y no se confunde con el nuevo en el menú (probado).

### Archivos

Nuevos:
- `database/migrations/0020_creative_studio.sql`, `database/rollback/0020_creative_studio.down.sql`
- `worker/src/creative/contracts.ts`, `aiRouter.ts`, `aiRouter.test.ts`, `brandKit.ts`, `jobs.ts`, `modules.ts`
- `worker/src/routes/creative.ts`, `worker/src/routes/creative.test.ts`
- `frontend/src/admin/pages/creative/CreativeHome.tsx`, `BrandKit.tsx`
- `docs/ESTUDIO_CREATIVO_IA.md`

Modificados:
- `worker/src/index.ts`: monta `/api/creative`, agrega `maintainCreativeJobs` al cron y declara la variable opcional `CREATIVE_AI_MODELS`
- `worker/src/routes/upload.ts`: el prefijo `creative-private/` deja de ser público
- `frontend/src/App.tsx` (2 rutas), `frontend/src/admin/AdminLayout.tsx` (grupo de menú), `frontend/src/admin/AdminLayout.test.ts`, `frontend/src/services/api.ts` (`creativeApi`)

## 6. Pruebas ejecutadas (2026-11-10)

| Comando | Resultado |
|---|---|
| `worker`: `npx tsc --noEmit` | OK |
| `worker`: `npx vitest run` | **42 archivos, 432 pruebas OK** (14 nuevas: 10 de aislamiento/permisos/Brand Kit/trabajos/R2 y 4 del enrutador) |
| `frontend`: `npx tsc --noEmit` | OK |
| `frontend`: `npx vitest run` | **21 archivos, 88 OK, 1 omitida** (ya estaba omitida antes) |
| `frontend`: `npm run build` | OK |

El arnés de pruebas aplica las 20 migraciones sobre SQLite, así que la 0020 también se validó contra el esquema completo. No se revisó la interfaz en un navegador con una sesión real.

## 7. Despliegue (pendiente de autorización)

Cada paso necesita autorización expresa del usuario:
1. Aplicar la migración en producción: `npx wrangler d1 migrations apply catalogo-lite-production-db --remote --config wrangler.production.toml` (desde `worker/`). Solo agrega cosas; el rollback está en `database/rollback/0020_creative_studio.down.sql`.
2. Desplegar la API (`catalogo-lite-api`) **después** de la migración (la ruta nueva consulta las tablas nuevas; el cron toca `creative_jobs`).
3. Desplegar el frontend (`npm run deploy:cloudflare` en `frontend/`).

Si se despliega la API sin la migración, `/api/creative/*` y el mantenimiento del cron fallan (el cron registra el error, pero las demás tareas siguen). Por eso el orden es migración → API → frontend.

## 8. Dependencias pendientes, riesgos y límites

- **Motores:** no hay generadores conectados. Para conectarlos hace falta: la biblioteca de recursos (`creative_assets`), la ejecución en segundo plano (hoy solo hay cron cada 15 min; para trabajos largos conviene **Cloudflare Queues**, que es un binding nuevo y necesita autorización y quizá plan), y precios en créditos para las nuevas funciones (`AI_CREDIT_FEATURES` + `ai_credit_costs`, los define el superadmin).
- **Video:** `gemini-omni-1.2-flash` figura como nuevo en la documentación; hay que confirmar con una llamada autorizada su disponibilidad, precio y límites antes de ofrecerlo.
- **Visitas:** no se registran. La analítica y las oportunidades basadas en visitas necesitan primero un registro de visitas que respete la privacidad.
- **Planes:** falta decidir en qué planes entra el estudio (`plans.features_json`). Hoy el acceso depende solo del rol.
- **Campañas:** la tabla `campaigns` actual es de mensajes de WhatsApp. La campaña creativa debe extenderla (`campaign_content`) y no crear otra tabla paralela.
- **Límites fijos:** 3 trabajos activos y 30 por hora por tienda (ampliados en la fase 2), 90 días de retención. Están en el código (`creative/jobs.ts`) y se pueden convertir en ajustes de la plataforma.
- **Tipografías permitidas:** la lista es fija en el código (`ALLOWED_FONTS`). El render de plantillas deberá cargar esas mismas fuentes.
- **Riesgo bajo en producción:** las tablas nuevas empiezan vacías, ninguna ruta existente cambió de comportamiento (salvo que `creative-private/` ya no es pública, y ese prefijo no existe en R2) y el cron nuevo no hace nada mientras no haya trabajos.
