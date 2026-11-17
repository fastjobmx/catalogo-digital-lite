# Revisión integral y publicación — 2026-11-17

Producción vuelve a estar completa: backend `catalogo-lite-api` versión `3fdd2a8f-0cb7-4c89-9ec8-020b6be6cc82`, publicado desde `fix/revision-integral` (`2ae9f78`). Punto de retorno: `bcad5c18-95f7-4969-af91-3f956728892d`.

## Qué pasó

El 2026-11-16 a las 12:35 se publicó la versión con IA por plan, créditos y API propia (`5ce35af`, versión `053397fe`). A las 12:37 se publicó encima la verificación de correo desde `feat/prueba-real` (`e910a8a`, versión `bcad5c18`), que no contenía ese código ni sus variables. El panel quedó en `5ce35af` y su sección «Inteligencia artificial / Mi API» respondía 404.

`fix/revision-integral` contiene `5ce35af`, `e910a8a`/`f1c0cc0` y el asistente conversacional y rápido (`feat/asistente-rapido`, apagado: `ASSISTANT_AGENT_STORE_IDS` y `ASSISTANT_FAST_MODEL` vacíos).

## Correcciones (commit 2ae9f78)

| Hallazgo | Evidencia | Corrección |
| --- | --- | --- |
| Backend sin API propia, créditos ni guardia de gasto | `/api/admin/ai/key` 404 en producción | Publicación desde la rama integrada; ahora 401 sin sesión |
| Notas de voz cortadas | 5 × `GEMINI_TRUNCATED · voz` (tiendas 4 y 5) | `maxOutputTokens` 4096 para audio (`worker/src/ai/gemini.ts`) |
| Colores del logo vacíos | 2 × `GEMINI_TRUNCATED · identidad_visual` | `thinkingBudget: 0`, límite 256 (`services/assistant/ai.ts`) |
| Modelo rápido cobrado al plan con API propia | Revisión de código | Se verifica al conectar la clave; si falta, se salta el atajo (`ai/ownKey.ts`, `agent/planner.ts`) |
| Activar el Estudio en clave solo de texto apagaba el asistente | Revisión de código | 409 sin cambios (`updateOwnKeyUses`) |
| JWT aceptaba cualquier HMAC | Revisión de código | Solo HS256 (`services/auth.ts`) |

Pruebas: Worker 906/906 (229 omitidas por diseño: modelo real o staging), frontend 142/142, `tsc --noEmit` sin errores. Sin migraciones nuevas (35/35 aplicadas). Panel sin cambios (código idéntico a `5ce35af`).

## Verificación en producción

`/api/health` 200 (production); tienda pública 200; `/api/admin/ai/key` y `/api/admin/credits` 401; webhooks sin firma rechazados (Telegram 403, maestro 403, Resend 401, WhatsApp 403); CORS ajeno sin `Access-Control-Allow-Origin`; login erróneo 401.

## Regla para la próxima publicación

Publicar solo desde una rama que contenga el commit que está en producción (`git merge-base --is-ancestor <commit> HEAD`) y anotar el commit y el punto de retorno en `--message`.
