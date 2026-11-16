# Prueba gratis real: publicación en producción (autorizada por el propietario, 2026-11-15)

Código: rama `feat/prueba-real` en `be02535`, que es `main` c8bfd5e más la prueba gratis. Sin push ni merge a `main`.

## Puntos de retorno

| Pieza | Versión anterior (retorno) | Versión nueva |
|---|---|---|
| API `catalogo-lite-api` | `3c53c1d8-5be7-4cb4-85f9-74479869f698` | `92f36985-ba7e-4438-ac29-694a4ba53636` |
| Panel `catalogo-digital-ia` | `952e7114-5582-42c2-8ba7-7c3fca98d4e1` | `479934a3-be92-4127-84e2-555c3a6e62be` |
| Landing (Pages `tiendaiaexpress`) | despliegue `174c07fe` (c8bfd5e) | despliegue `376ebf39` (be02535) |
| D1 antes de 0033 | bookmark `00000667-00000000-00005124-e204562b6d9e2ae7e0e63d27ead47d80`; copia SQL 1.673.439 bytes, integridad ok | — |

## Lo que se hizo

1. Ensayo de la migración 0033 sobre una copia local de producción: solo agrega la fila del plan inactivo `prueba` y las tablas o columnas nuevas; 0 violaciones.
2. Migración `0033` con el aplicador oficial. Después: 9 tiendas, 595 productos y 30 pedidos (sin cambios), 4 planes activos iguales, 0 tiendas en prueba, 24 migraciones, 0 violaciones.
3. Despliegue en orden: servidor, luego panel, luego landing.
4. Humo: salud 200; `/api/signup/config` = 7 días, 7 productos, sin tarjeta; rutas de plataforma y de prueba sin token 401; `/registro` 200 con `noindex`. Las **9 tiendas reales responden 200**. La landing enlaza a `https://app.tiendiaexpres.com/registro` con los textos nuevos.

## Pendiente

- El correo real de la prueba (verificación, bienvenida, contratación y activación) no se probó con un buzón: en producción sale por Resend con el dominio ya verificado. Primera prueba recomendada: un registro con tu propio correo, comprobando la entrega en Plataforma → Correos.
- `EMAIL_ALLOWED_RECIPIENTS` no está definida en producción (sin restricción, como debe ser).
- Los planes comerciales siguen inactivos; la conversión los asigna igual tras el pago verificado.

## Reversión

1. `cd worker` y `npx wrangler rollback 3c53c1d8-5be7-4cb4-85f9-74479869f698 -c wrangler.production.toml`
2. `cd frontend` y `node ../worker/node_modules/wrangler/bin/wrangler.js rollback 952e7114-5582-42c2-8ba7-7c3fca98d4e1`
3. Landing: en Cloudflare Pages, «Rollback» al despliegue `174c07fe`.
4. Esquema solo después y si hace falta: `database/rollback/0033_trial_real_store.down.sql` (la reversión conserva las tiendas). No restaurar el D1 sin nueva autorización.

## Actualización 2026-11-15: 20 productos, 14 días y checklist «listo para vender»

| Pieza | Retorno | Nueva |
|---|---|---|
| API | `92f36985-ba7e-4438-ac29-694a4ba53636` | `b55fd691-e08c-4672-823d-dc1f46a24b02` |
| Panel | `479934a3-be92-4127-84e2-555c3a6e62be` | `d1e2ad7f-5f6f-4f28-bb7c-991896d386bf` |
| Landing | `376ebf39` | `df5a85da` |
| D1 antes de 0034 | bookmark `000006bd-00000000-00005124-31b32d377a10d6240a35f047607d9ef5`, copia de 1.723.072 bytes (integridad ok) | — |

Migración 0034 (ensayada antes en una copia de producción): plan `prueba` a 20 productos; la única prueba activa («Ositos y ositas») pasó a 20 productos y 14 días (vence el 29 de noviembre). Sin otros cambios: 10 tiendas, 595 productos, 30 pedidos, 0 violaciones. Humo: registro ofrece 14 días y 20 productos, landing actualizada, checklist protegido (401 sin sesión) y las 10 tiendas responden 200.

Correos: los dos correos de confirmación de «Ositos y ositas» figuran como entregados por Resend; la prueba ya está activa, así que el enlace sí se abrió.

## Actualización 2026-11-16: verificación de correo (para que lleguen recuperación y avisos)

Problema: 7 de 8 usuarios nunca verificaron su correo (se activaron con un enlace entregado a mano), y por seguridad la recuperación de contraseña, la bienvenida y el aviso de contraseña cambiada solo se envían a correos verificados. Dos solicitudes de recuperación del 5 de noviembre no llegaron por ningún canal.

Corrección (commit `e910a8a`): al activar una cuenta con enlace manual se envía el correo de verificación (solo confirma la dirección, no da acceso); y con `EMAIL_VERIFICATION_BACKFILL=true` el cron envía UNA sola vez la verificación a las cuentas activadas sin confirmar (6 en producción). API `bcad5c18` (retorno `b55fd691`). La variable queda activa: no reenvía a quien ya lo recibió.
