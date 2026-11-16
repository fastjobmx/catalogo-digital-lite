# Prueba gratis real: staging aislado y preparación de Resend

Entorno `tiendia-prueba-staging`, independiente del staging del asistente (`sneakerhub-telegram-staging`, versión `64ad293f`, **no se tocó**) y de producción. Datos ficticios, Telegram, Meta y WAHA apagados (este Worker no tiene ningún secreto de esos servicios). Código: rama `feat/prueba-real`. Sin push, sin merge, sin cambios en producción, sin envíos reales y sin cambios de DNS.

## 1. URLs y recursos

| Pieza | Recurso | URL / ID |
|---|---|---|
| API | Worker `tiendia-prueba-staging` | https://tiendia-prueba-staging.catalogo-lite-worker.workers.dev |
| Panel | Worker `tiendia-prueba-panel` (enlace de servicio al API de pruebas) | https://tiendia-prueba-panel.catalogo-lite-worker.workers.dev (registro: `/registro`) |
| Landing | Worker `tiendia-prueba-landing` (estático, `noindex`, CTA al panel de pruebas) | https://tiendia-prueba-landing.catalogo-lite-worker.workers.dev |
| Base de datos | D1 `tiendia-prueba-staging-db` | `1fb6e305-f012-444a-9b80-d58695980dba` |
| Archivos | R2 `tiendia-prueba-staging-assets` | (propio) |
| Secretos propios | `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (generados para este entorno) | `RESEND_API_KEY` y `RESEND_WEBHOOK_SECRET` aún sin definir |

No existía un staging independiente y compatible, así que no se duplicó nada. Verificado: IDs distintos de producción (`10b10054…`) y del staging del asistente (`18ac228c…`); bindings solo a recursos propios; ningún secreto ni dato copiado.

Archivos de configuración: `worker/wrangler.prueba-staging.toml`, `frontend/wrangler.prueba.jsonc` + `frontend/.env.prueba`, `apps/tiendaiaexpress-landing/wrangler.prueba.jsonc` + `.env.prueba`.

Versiones desplegadas: API `8ec9427f`, panel `598e45bd`, landing `d943df07`.

## 2. Migraciones (D1 aislado)

La rama contiene 0001 a 0023 y `0033_trial_real_store.sql` (0024-0032 pertenecen a otras ramas y no son necesarias). Aplicadas con el aplicador oficial sobre la base vacía: **24 migraciones**, 70 tablas, 8 planes (los 4 activos + `emprendedor`, `negocio`, `mayorista` y `prueba`, todos inactivos), `foreign_key_check` 0; «No migrations to apply».

## 3. Defectos encontrados y corregidos en esta validación

| Defecto | Efecto | Corrección |
|---|---|---|
| `/registro` y `/activar` no estaban reconocidos por el Worker del panel | Se trataban como páginas de la tienda principal: metadatos de otra marca (y `404` sin tienda principal) | Pasan a pantallas privadas de plataforma (`noindex`); prueba añadida |
| Eliminar una tienda de prueba fallaba (`500`) | Las tablas `store_trials` y `store_plan_requests` no estaban en la purga | Incluidas, antes de las facturas; prueba añadida |
| No había lista de destinatarios para entornos de prueba | Un staging con copia de datos podría escribir a comerciantes reales | Nueva variable `EMAIL_ALLOWED_RECIPIENTS` (direcciones o `@dominio`): fuera de la lista no se envía nada y queda `RECIPIENT_NOT_ALLOWED`; sin variable (producción) no cambia nada; 2 pruebas |

## 4. Validación de la prueba en staging (24 + 7 + 13 comprobaciones)

Script reproducible: `scripts/prueba-staging-e2e.mjs` (fases 1, 2, 3) y `scripts/prueba-staging-purge.mjs`. Tienda ficticia «Flores Ficticias de Ana».

| # | Caso | Resultado |
|---|---|---|
| 1 | Registro (`POST /api/signup`) | 202; tienda **real** en borrador con plan inactivo `prueba` |
| 2 | Verificación y acceso | Enlace de un solo uso emitido por el mecanismo del superadministrador (el correo aún está apagado); activación 200; 7 días, límite 7. «Correo confirmado: no» (correcto: no pasó por correo) |
| 3 | Panel real | Mismos endpoints del comerciante de pago; estado de prueba, días restantes y planes |
| 4-5 | 7 productos y octavo | 5 secuenciales + ráfaga de 6 simultáneas: **entran exactamente 2**; el octavo responde `409 TRIAL_PRODUCT_LIMIT` |
| 6 | Personalización | Foto subida (PNG real), edición con foto, categoría, nombre y color; el comerciante **no** puede cambiar sus límites ni su plan |
| 7 | Catálogo y pedidos | 7 productos públicos; pedido recibido (201) y visible en el panel |
| 8 | Reenvío del enlace | Respuesta uniforme 202 |
| 9 | Vencimiento (controlado por SQL en la base ficticia) | Vitrina `TRIAL_EXPIRED`; el comerciante sigue viendo sus datos; productos nuevos bloqueados; el panel ofrece contratar; ampliación solo del superadministrador (el comerciante recibe 403), auditada; vuelve a publicarse |
| 10-12 | Contratación | Solicitud 201; repetida no duplica; **sin pago verificado no se activa** |
| 13 | Verificación de pago | Comerciante: 403; sin referencia ni confirmación: 400; 3 activaciones simultáneas: todas 200, una sola efectiva |
| 14-15 | Conversión | **Mismo ID de tienda**; plan `emprendedor`; mismos 7 productos (ID, SKU, nombre, precio y fotos), mismo pedido y misma configuración (comparación antes/después) |
| 17 | Nuevas capacidades | Producto número 8 permitido; tienda publicada y recibiendo pedidos; el panel pasa a «convertida» |
| 18 | Aislamiento | La tienda A no abre la B (403) ni sus pedidos (403) |
| 19 | Concurrencia y reintentos | Ráfagas de productos, solicitud repetida y activación triple |
| 16 y 20 | **Correo de activación: envío y entrega reales** | **No ejecutado** (ver §5). Con el correo apagado, los correos quedaron registrados como `fallido / RECIPIENT_NOT_ALLOWED` (la lista de destinatarios bloqueó el envío): `trial_signup`, `plan_requested`, `plan_activated` |

Pruebas automáticas de la rama: servidor **579 correctas** (17 omitidas previas), panel **140**; `tsc` limpio en servidor y panel.

## 5. Resend: auditoría sin secretos y preparación

**Estado actual de DNS (consulta pública de solo lectura):**

| Registro | Valor |
|---|---|
| `tiendiaexpres.com` MX | Cloudflare Email Routing (route1/2/3) |
| `tiendiaexpres.com` TXT | `v=spf1 include:_spf.mx.cloudflare.net ~all`, verificación de Resend y de Google |
| `resend._domainkey.tiendiaexpres.com` | DKIM (clave RSA) publicada |
| `send.tiendiaexpres.com` | SPF de Resend y MX de rebotes (`feedback.forge.rmta.net`) |
| `_dmarc.tiendiaexpres.com` | `v=DMARC1; p=none; rua=mailto:dmarc@tiendiaexpres.com; fo=1` |
| `mail-staging.tiendiaexpres.com` (y `resend._domainkey.`, `send.`) | **Sin registros** (no existe) |

Los registros que reciben `soporte@` y `ventas@` (MX y SPF de la raíz) **no se tocan**: el subdominio de pruebas no interfiere con ellos. El estado «verificado» en Resend no se puede leer sin una clave con permiso de lectura de dominios.

**Qué ya hace el código (comprobado por pruebas):** firma Svix verificada sobre el cuerpo original, eventos idempotentes por identificador, rebote permanente y queja a la lista de supresión, aceptación distinta de entrega (`enviado` ≠ `delivery_status`), idempotencia por mensaje, reintentos solo ante errores transitorios, y sin tokens, enlaces ni cuerpos en los registros.

**Pasos que requieren tu intervención** (yo no veo ni toco claves ni DNS):

1. **Resend → Domains → Add Domain:** `mail-staging.tiendiaexpres.com`. Resend mostrará los registros exactos.
2. **Cloudflare DNS de `tiendiaexpres.com`:** crea solo esos registros (normalmente `resend._domainkey.mail-staging` TXT para DKIM; `send.mail-staging` TXT con SPF y `send.mail-staging` MX de rebotes). Opcional: `_dmarc.mail-staging` TXT `v=DMARC1; p=none; rua=mailto:dmarc@tiendiaexpres.com; fo=1` (hereda de la raíz si no lo creas). **No modifiques ningún registro existente.** Pulsa *Verify* en Resend.
3. **Resend → API Keys:** crea una clave nueva «tiendia-prueba-staging» con permiso **Sending access** limitado a ese dominio (distinta de la de producción) y guárdala tú en la terminal:
   `cd worker` y `npx wrangler secret put RESEND_API_KEY -c wrangler.prueba-staging.toml`
4. **Resend → Webhooks → Add Endpoint:** URL `https://tiendia-prueba-staging.catalogo-lite-worker.workers.dev/api/email/webhooks/resend`, eventos de envío, entrega, retraso, rebote, queja y fallo. Copia el *signing secret* (distinto del de producción) y:
   `npx wrangler secret put RESEND_WEBHOOK_SECRET -c wrangler.prueba-staging.toml`
5. **Dime el buzón destinatario autorizado.** Yo cambio la configuración (`EMAIL_PROVIDER=resend`, `EMAIL_FROM="TiendIA Prueba <pruebas@mail-staging.tiendiaexpres.com>"`, `EMAIL_REPLY_TO=soporte@tiendiaexpres.com`, `EMAIL_REPLY_TO_SALES=ventas@tiendiaexpres.com`, `EMAIL_ALLOWED_RECIPIENTS=<tu buzón>`), despliego solo el Worker de pruebas y ejecuto el flujo completo con correo real (verificación, bienvenida, recuperación, activación) comprobando la **entrega** por el webhook, no solo la aceptación.

Mientras tanto la lista de destinatarios está en un valor que no corresponde a ningún buzón (`@tiendia-prueba.invalid`): **nada puede salir**.

## 6. Costos estimados (supuestos, a verificar en la cuenta)

| Recurso | Estimación |
|---|---|
| Workers (API, panel, landing), D1 y R2 en estos volúmenes de prueba | Dentro de los límites gratuitos de Cloudflare; sin costo adicional si la cuenta ya está en el plan gratuito o de pago (sin cargo por cada Worker) |
| Cron de 15 minutos | 96 ejecuciones al día (despreciable) |
| Resend (dominio de pruebas) | Plan gratuito (alrededor de 3.000 correos al mes y 100 al día, un dominio); un segundo dominio podría requerir el plan de pago. **Verificar en Resend antes de crear el dominio** |
| IA | Cero: la tienda de prueba nace con IA apagada |

## 7. Riesgos pendientes

1. El correo real (casos 16 y 20) sigue sin probarse: **NO GO** hasta ver entrega (`delivered`) en un buzón autorizado y respuestas recibidas en `soporte@` y `ventas@`.
2. DMARC en `p=none`: endurecer tras revisar los informes.
3. Resend podría no admitir un segundo dominio en el plan gratuito.
4. Los planes comerciales siguen inactivos: confirmar con qué derechos se venden antes de activar la conversión real.
5. Integración con ramas sin publicar (asistente, WhatsApp, IA por planes): la numeración reservada `0033` evita choques de migración, pero habrá conflictos de código esperables.
6. Limitador de registros (3 por hora y red): una persona real detrás de una red compartida podría toparse con él; evaluar Turnstile.
7. La clave de superadministrador de este staging existe solo como secreto del Worker; si quieres entrar tú, define una nueva con `wrangler secret put ADMIN_PASSWORD`.

## 8. Reversión y limpieza

- Todo el entorno es desechable: `wrangler delete` de los tres Workers, `wrangler d1 delete tiendia-prueba-staging-db` y `wrangler r2 bucket delete tiendia-prueba-staging-assets` (con tu autorización).
- Si solo hay que deshacer el código del API de pruebas: `wrangler rollback` a la versión anterior del Worker de pruebas.
- Producción y el staging del asistente no cambian en ningún caso.

## 9. Recomendación

**GO** para continuar la validación con correo real en este staging, una vez completados los pasos de §5. **NO GO** a producción hasta confirmar la entrega real de los correos, la recepción en `soporte@` y `ventas@`, los derechos de los planes y la política de retención.
