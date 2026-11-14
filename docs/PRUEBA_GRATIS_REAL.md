# Prueba gratis real, conversión a plan y correos (TiendIA Exprés)

Rama `feat/prueba-real` (worktree `.tmp/wt-prueba`), creada desde `main` c8bfd5e. Sin push, sin merge, sin migraciones ni despliegues en staging o producción.

## 1. Diagnóstico de la prueba anterior

| Pieza | Cómo funcionaba | Problema |
|---|---|---|
| Creación | `/prueba` creaba una fila en `trial_sessions` (sin usuario ni tienda), con un token de edición guardado solo en el navegador. | No era una tienda: otro modelo de datos, otro editor, otra vitrina. |
| Productos | JSON dentro de `trial_sessions.content_json` (hasta 7, una foto, sin variantes, sin categorías ni inventario). | Nada de eso existía en el catálogo real. |
| Pedidos | `trial_orders`, aparte de `orders`. | No aparecían en el panel real. |
| Panel | Editor propio de la prueba. | No era el panel de los comercios. |
| Conversión | El superadministrador pulsaba «Convertir»: se creaba una tienda **nueva** en borrador y se **copiaban** productos y fotos (SKU `PRUEBA-1…7`). | Cambiaba de ID y URL, perdía pedidos, variantes y configuración; la landing tenía que decir «la prueba no se convierte en tienda por sí sola». |
| Registro y acceso | Usuarios en `platform_users`, membresías por tienda, invitación de un solo uso (`/activar`), recuperación solo para correos verificados. | Reutilizable tal cual. |
| Planes y pagos | `plans` (básico, profesional, premium, legacy activos; emprendedor, negocio y mayorista **inactivos** desde 0023). Pagos manuales: facturas `store_invoices` que la plataforma marca como pagadas (panel o `/pagada` del bot maestro). | Reutilizable: es el «procedimiento autorizado» de verificación. |
| Migraciones | `main` llega a 0023; otras ramas reservan 0024–0032. | La nueva es **0033** para no chocar. |

Piezas reutilizadas sin construir un segundo sistema: `provisionStore`, `platform_users`/`store_memberships`, tokens de activación con hash, `sendEmail` (idempotente, reintentos, supresión, webhooks), `productLimit`, `store_invoices`/`setInvoiceStatus`, `audit_log`, `platform_events`, el panel y la vitrina.

## 2. Auditoría del correo (Resend)

| Punto | Estado |
|---|---|
| Dominio de envío | `tiendiaexpres.com`; TXT `resend-domain-verification` publicado. El estado «verificado» en Resend no se puede leer con la clave de solo envío: confirmarlo en el panel de Resend. Hay evidencia de entregas reales (evento `email.delivered` registrado en producción). |
| SPF | `send.tiendiaexpres.com` (sobre de envío de Resend) con SPF propio; la raíz solo autoriza Cloudflare Email Routing. Correcto: DMARC se alinea por DKIM. |
| DKIM | `resend._domainkey.tiendiaexpres.com` publicado (clave RSA). |
| DMARC | `v=DMARC1; p=none; rua=mailto:dmarc@…; fo=1`. **Pendiente** endurecer a `p=quarantine` tras revisar 2–4 semanas de informes. |
| MX | Raíz → Cloudflare Email Routing (recepción de soporte@ y ventas@); `send.` → rebotes de Resend. |
| Remitentes | Se envía desde `notificaciones@tiendiaexpres.com` (dominio verificado). `soporte@` y `ventas@` se usan como **Reply-To**, no como remitente: así las respuestas llegan a buzones con reenvío real y no se suplanta un buzón de personas. Nuevo `EMAIL_REPLY_TO_SALES=ventas@…` para los correos comerciales. **Pendiente**: probar la recepción real en ventas@ y soporte@. |
| API y secretos | `RESEND_API_KEY` y `RESEND_WEBHOOK_SECRET` solo como secretos; nunca en código ni registros. |
| Webhooks y eventos | Firma Svix verificada; entregado, retrasado, rebotado, queja y fallido; doble entrega ignorada; rebote permanente y queja → lista de supresión; sondeo de respaldo cada 15 min. |
| «Enviado» ≠ «entregado» | `status = enviado` solo significa aceptado por Resend; la entrega es `delivery_status`. El panel lo muestra así («aceptado por el proveedor»). |
| Tokens y enlaces | Solo se guarda el hash SHA-256; nunca el enlace ni el cuerpo del correo. Verificado por pruebas automáticas. |
| Reintentos y duplicados | Clave de idempotencia por mensaje (también enviada a Resend); 3 intentos solo para errores transitorios. |
| Registro de errores | `email_messages.error_code`, `audit_log` (`email_sent`) y `platform_events` (`TRIAL_SIGNUP_EMAIL_NOT_SENT`). |

Hallazgos corregidos en las plantillas: marca mezclada («Tienda IA Express» frente a «TiendIA Exprés»), paleta antigua verde/lima distinta de la identidad violeta actual, logo servido desde el dominio workers.dev (ahora `app.tiendiaexpres.com`), «Bienvenido» con género (ahora «Te damos la bienvenida»), pie sin correo de soporte.

Plantillas (responsive, 560 px, una columna, sin contraseñas): 1 `trial_signup` verificación de correo, 2 `trial_welcome` bienvenida, 3 `password_reset` recuperación, 4 `trial_expiring` por vencer, 5 `trial_ended` finalizada, 6 `plan_requested` contratación recibida, 7 `plan_activated` pago verificado y plan activado; además `signup_existing` (registro con un correo que ya tiene cuenta, sin enlaces de acceso). Vistas previas en `docs/correos-prueba-real/`. Las de prueba y contratación son esenciales (no se pueden pausar).

## 3. Arquitectura de la nueva prueba

```
/registro ──► provisionStore(trial) ──► tienda normal en BORRADOR + plan inactivo «prueba» (7 productos, sin IA,
              (misma creación de tiendas)   sin servicios, sin Telegram) + store_trials(pendiente)
          └─► correo «Confirma tu correo y entra» (enlace de un solo uso, 72 h)
abrir enlace ─► crea contraseña + verifica el correo ─► store_trials(activa, 7 días) ─► tienda publicada
panel normal ─► aviso: días restantes · productos x/7 · «Activar mi tienda»
cron 15 min ─► avisos 3 días · 1 día · fin ─► vencida: privada, sin pedidos ni productos nuevos, datos intactos
«Activar mi tienda» ─► store_plan_requests(pendiente_pago) + factura pendiente ─► correo «Contratación recibida»
plataforma verifica el pago (botón con referencia y confirmación, o factura marcada como pagada)
          └─► UNA transacción idempotente: solicitud activada · factura pagada · MISMA tienda con el plan
              (límites de prueba fuera, IA según el plan) · prueba convertida · auditoría ─► correo «Plan activado»
```

Reglas en el backend (nunca solo en la interfaz):

- Límite de 7 productos dentro del `INSERT` (dos clics simultáneos no superan el límite); también al restaurar archivados.
- Prueba vencida: `stores.trial_ends_at` vencido ⇒ la vitrina responde 404 `TRIAL_EXPIRED` (el equipo la sigue viendo), los pedidos 409 y los productos nuevos 409, aunque el cron no haya corrido.
- IA: la tienda de prueba nace con `ai_enabled = 0` y presupuesto 0; las solicitudes de créditos premium se rechazan (`TRIAL_FEATURE_UNAVAILABLE`). No se habilitó ninguna IA de prueba; si se decide incluir alguna, la política separada sería: presupuesto propio por tienda en prueba con tope diario de plataforma (como `photoEnhancePerTrial` de la prueba anterior).
- Antiabuso: honeypot, 3 registros por red y hora, 200 por día, correos temporales bloqueados, una prueba por correo (hash), Turnstile opcional (`TURNSTILE_SECRET_KEY`), respuestas iguales exista o no la cuenta, enlace solo por correo.
- Aislamiento: la tienda sale del selector validado por membresía; cambiar la URL o la cabecera devuelve 403.
- Contratar: solo el propietario. Activar: solo el superadministrador, con referencia del pago y confirmación explícita. Extender: solo el superadministrador, 1–14 días por vez, máximo 30, con motivo en la auditoría.
- Facturación: el generador mensual existente no cobra otra vez el mes pagado en la activación ni las mensualidades de un pago anual (12 meses).

Retención propuesta (sujeta a la política legal): 30 días recuperables después de vencer. **Nada se borra automáticamente**: al cumplirse, la tienda solo aparece marcada «Retención cumplida (revisar)» en la plataforma.

La prueba anterior (`/prueba/:id`) sigue funcionando para los enlaces existentes; `/prueba` redirige a `/registro`.

## 4. Archivos

| Parte | Archivos |
|---|---|
| Migración | `database/migrations/0033_trial_real_store.sql`, reversión `database/rollback/0033_trial_real_store.down.sql` |
| Servidor | `worker/src/services/freeTrial.ts` (nuevo), `worker/src/routes/signup.ts` (nuevo), cambios en `provisioning.ts`, `business.ts`, `billing.ts`, `middleware/tenant.ts`, `routes/{admin,auth,orders,platform}.ts`, `tenancy/stores.ts`, `email/{send,templates}.ts`, `index.ts` (cron), `services/master/bot.ts` |
| Panel | `frontend/src/pages/SignupPage.tsx`, `admin/pages/ActivateStore.tsx`, `admin/PlatformTrialStoresPage.tsx` (nuevos); `AdminLayout.tsx`, `App.tsx`, `ActivationPage.tsx`, `PlatformPage.tsx`, `services/api.ts` |
| Landing | `apps/tiendaiaexpress-landing/src/{config/site.ts,content/copy.ts,sections/*}`, `public/llms.txt`, pruebas |
| Configuración | `worker/wrangler.production.toml`: `EMAIL_REPLY_TO_SALES` (no desplegado) |

Rutas nuevas: `POST /api/signup`, `POST /api/signup/resend`, `GET /api/signup/config`; `GET /api/admin/trial`, `POST /api/admin/trial/plan-request`; `GET /api/platform/trial-stores[/summary|/incidents|/:slug/emails]`, `POST /api/platform/trial-stores/:slug/extend`, `GET /api/platform/plan-requests`, `POST /api/platform/plan-requests/:id/{activate,cancel}`. Panel: `/registro`, `/admin/activar-tienda`, `/plataforma/prueba-gratis`.

## 5. Pruebas

Automáticas (todas en verde): servidor **576** (17 omitidas que ya lo estaban), panel **140**, landing **47** en escritorio y móvil (incluye accesibilidad WCAG 2.2 A/AA), typecheck limpio en los tres. `worker/src/routes/free-trial.test.ts` cubre 17 escenarios.

| # | Caso | Automática | Navegador local |
|---|---|---|---|
| 1 | Registro de un comercio nuevo | ✅ | ✅ |
| 2 | Verificación de correo | ✅ (enlace por correo ⇒ verificado) | ✅ con enlace manual (muestra el aviso «correo sin confirmar») |
| 3 | Acceso al panel | ✅ | ✅ |
| 4–5 | 7 productos y rechazo del 8.º | ✅ (también ráfaga concurrente) | ✅ |
| 6 | Edición, archivado y restauración | ✅ | — |
| 7 | Configuración de la tienda | ✅ | — |
| 8 | Recepción de pedidos | ✅ | ✅ |
| 9 | Vencimiento, avisos 3 d / 1 d / fin, extensión | ✅ | — |
| 10 | Reenvío seguro del enlace | ✅ | — |
| 11 | Recuperación de cuenta | ✅ | — |
| 12–13 | Selección de plan y verificación de pago | ✅ (botón y factura pagada) | ✅ |
| 14–15 | Mismo ID y conservación de productos, imágenes, variantes, pedidos y configuración | ✅ | ✅ (`docs/capturas-prueba-real/datos-antes.txt` vs `datos-despues.txt`) |
| 16 | Correo de activación (una sola vez) | ✅ | (en local no se envía: enlaces http) |
| 17 | Nuevas capacidades (8.º producto, IA del plan) | ✅ | ✅ |
| 18 | Aislamiento entre comercios | ✅ | — |
| 19 | Reintentos y solicitudes concurrentes | ✅ | — |
| 20 | Envío y entrega real de correos | ❌ **pendiente** (requiere staging con Resend y un buzón autorizado) | — |

Migración 0033 aplicada sobre el motor D1 local, revertida y reaplicada sin errores; la reversión conserva las tiendas existentes.

Capturas: `docs/capturas-prueba-real/` (registro, «Revisa tu correo», panel con aviso, 7 de 7, rechazo del 8.º, «Activar mi tienda», solicitud, plataforma antes y después de verificar el pago, comerciante con plan activo, registro y correo en móvil, landing).

## 6. Despliegue (cuando se autorice)

Orden obligatorio: (1) respaldo D1 + Time Travel; (2) aplicar `0033` — el servidor nuevo lee `stores.trial_ends_at` en cada tienda y fallaría sin la columna; (3) servidor; (4) panel; (5) landing (sus enlaces a `/registro` necesitan el panel nuevo). Reversión: servidor y panel anteriores, después `0033.down`.

## 7. Riesgos pendientes

1. **Planes inactivos**: emprendedor, negocio y mayorista tienen `is_active = 0`; la conversión los asigna igual (lista en `platform_settings.trial_upgrade_plans`). Confirmar que ya se venden con esos derechos (150/500/ilimitados productos, IA según 0023). La rama `feat/ia-planes-creditos` redefine la IA por plan: habrá que integrar.
2. **Integración con ramas sin publicar** (asistente, WhatsApp, IA por planes): conflictos esperables en `index.ts`, `admin.ts`, `platform.ts` y plantillas.
3. **Correo real sin probar** en este flujo (caso 20) y recepción de ventas@/soporte@ sin probar. DMARC en `p=none`.
4. **Retención de 30 días** pendiente de la política legal; nada se borra.
5. Renovación anual: el generador de facturas no emite la renovación del año 2 de un plan anual (limitación previa).
6. Telegram: la tienda de prueba puede vincular el asistente desde el panel (sin IA). Decidir si se oculta durante la prueba.
7. El panel muestra las secciones de IA aunque estén apagadas en la prueba; y las pantallas de acceso aún dicen «Tienda IA Express».
8. Turnstile no configurado (solo honeypot y límites).
9. La prueba anterior sigue viva para enlaces existentes; retirarla cuando venzan.

## 8. Recomendación

**NO GO a producción hoy.** **GO a staging**, con autorización, para: aplicar 0033, desplegar servidor y panel, y probar el envío y la entrega real con un buzón autorizado (caso 20). Luego GO a producción si: el correo llega (evento `email.delivered`), ventas@ recibe respuestas, se confirma el punto 1 y la política de retención.
