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
