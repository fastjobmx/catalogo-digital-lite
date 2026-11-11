# Publicación en producción (autorizada por el propietario, 2026-11-11)

Código: rama `feat/telegram-ia-planes` en `c08c55d` (incluye `main` 0bfbc03, es decir, los pedidos por WhatsApp con foto ya publicados). Sin push ni merge a `main`. Solo el Worker `catalogo-lite-api` y su D1; el panel, la landing, el correo, los dominios y MOSTRALO PUES! no se tocaron.

## Puntos de retorno

| Qué | Valor |
|---|---|
| **Worker anterior (retorno principal)** | `3c61c48a-52be-46b7-a522-cfc1c6c9ca9b` |
| Worker con la cuota en `off` | `ca3c5c23-a8a5-4a4b-ae8f-013d4dbbd3a7` |
| **Worker actual (cuota en `shadow`)** | `56b1450b-ebfc-4337-86e5-e1f3cb0897dd` |
| Bookmark Time Travel del D1 antes de migrar | `00000450-00000000-00005120-6f6eb56c8d093e794522d4d564aee5f9` |
| Copia SQL del D1 antes de migrar | 941.199 bytes, integridad `ok`, 0 violaciones; 6 tiendas, 167 productos, 23 pedidos |

## Lo que se hizo

1. Migración `0023` con el aplicador oficial (era la única pendiente; el historial de producción estaba completo hasta 0022). Aditiva. Después: 6 tiendas, 167 productos, 23 pedidos (iguales), 7 planes (4 activos iguales + 3 nuevos inactivos), 0 tiendas en planes nuevos, 23 migraciones registradas, 0 violaciones de relaciones.
2. Worker con `AI_MESSAGE_QUOTA_MODE` sin definir (`off`): humo correcto (salud, catálogo, 401/403 de rutas protegidas, webhooks sin secreto 403); bot maestro y asistente con 0 pendientes y sin errores.
3. Cuota en `shadow`: solo cuenta y avisa; **no bloquea**. `enforce` no se activa.

## Qué cambió para los comercios

Entienden mejor los mensajes y las notas de voz (tallas, referencias, precios en palabras), botón «Corregir», pregunta cuando un precio es ambiguo y `/consumo`. Corrección del fallo visto en el chat real: «Talla 30, 32, 34 y 36, cinco unidades cada una» (escrito o dictado) ahora se entiende al pedir el inventario del borrador.

## Reversión

1. **Rápida, sin tocar el código:** `npx wrangler deploy -c wrangler.production.toml` con `--var AI_MESSAGE_QUOTA_MODE:off`, o con `--var TELEGRAM_SMART_INTERPRETER_ENABLED:false --var TELEGRAM_VOICE_ENABLED:false` para volver al comportamiento anterior del bot.
2. **Código anterior:** `npx wrangler rollback 3c61c48a-52be-46b7-a522-cfc1c6c9ca9b -c wrangler.production.toml` (funciona con el esquema actual porque 0023 es aditiva).
3. **Esquema (solo después de 2, y solo si hace falta):** `database/rollback/0023_ai_message_quota.down.sql`. No restaurar el D1 sin evaluar qué datos se perderían y sin nueva autorización.
