# IA por plan, créditos artísticos y API propia — entrega

Rama `feat/ia-planes-creditos` (worktree `.tmp/wt-planes`). Une `main` (4fb458d), `feat/blindaje-ia` y
`feat/asistente-conversacional`. **Sin push, sin merge a `main`, sin migraciones ni despliegues en producción.**
Validado solo con modelo simulado: ninguna prueba llamó a Gemini ni gastó créditos.

## 1. Qué quedó implementado

| Pieza | Dónde | Resumen |
|---|---|---|
| Fusión de ramas | commits de merge | 2 conflictos resueltos (`usage.ts`, `assistant/ai.ts`); la clave de operación separa Telegram (`tg:`) y WhatsApp (`wa:`) |
| Huecos del guardián | `whatsapp/photoBatch.ts`, bancos del asistente | El agrupador de fotos de WAHA pasa por el guardián (sin presupuesto: deja los grupos por álbum/foto, no pierde fotos). Los bancos con modelo real exigen la clave de pruebas y el presupuesto de pruebas |
| Consultas por sesión y por mes | `ai/planUsage.ts`, `ai/spendGuard.ts`, migración 0030 | Sesión de 5 h que abre la primera consulta de IA; cupo mensual por ciclo de facturación; pesos por complejidad en `ai_unit_weights`; todo dentro de la **misma reserva atómica** del guardián |
| Quién paga | `ai/spendGuard.ts` | Cada llamada se marca `plan`, `own_key`, `platform` o `trial`. Con API propia no cuenta consultas ni dinero de TiendIA, pero sí los límites técnicos |
| Límites técnicos | `ai/spendGuard.ts` | 3 tareas a la vez y 60 por minuto por tienda; fotos ≤ 5 MB, audio ≤ 2 MB (~2 min), documentos ≤ 10 MB; 3 intentos por operación; la misma solicitud en 2 min no se cobra otra vez y desde la 6.ª copia se rechaza |
| API propia | `ai/ownKey.ts`, migración 0031, rutas `/api/admin/ai/key` | AES‑256‑GCM con datos asociados a la tienda; clave maestra = secreto `AI_KEYS_MASTER_KEY`; validación gratuita (lista de modelos); solo el propietario la gestiona; nunca se devuelve ni se registra; sin caída silenciosa a la clave de TiendIA |
| Monedero de créditos | `ai/creditWallet.ts`, `ai/credits.ts`, migración 0032 | Origen por crédito (plan, cortesía, compra, ajuste); créditos del plan por ciclo (idempotente) que vencen con el ciclo; compras 12 meses; orden de consumo plan → cortesía → compra; vencimientos idempotentes en el cron; costos versionados (v2 = 10 créditos por imagen premium); paquetes 100/300/700 |
| Panel | `frontend/src/admin/pages/AiSettings.tsx`, ruta `/admin/ia`, menú «Inteligencia artificial» | Pestañas Consumo (sesión con hora de restablecimiento, mes, créditos por origen, estado de Mi API, historial, uso por tipo, paquetes), Mi API (conectar, validar, usos, respaldo, reemplazar, desconectar, historial) y Cómo se cuenta (pesos y uso razonable) |
| Telegram / WhatsApp | `services/assistant/consumption.ts` y mensajes del guardián | `/consumo` muestra consultas de la sesión y del mes y créditos; al llegar al límite se informa la hora o fecha de restablecimiento y la opción de conectar Mi API; los comandos sin IA siguen |
| API del panel | `GET /api/admin/ai/overview` | Resumen sin contenido de mensajes ni secretos |

## 2. Archivos

Nuevos: `worker/src/ai/planUsage.ts`, `ownKey.ts`, `creditWallet.ts`, `aiOverview.ts`, `planCredits.test.ts`;
`database/migrations/0030_ai_plan_usage.sql`, `0031_store_ai_keys.sql`, `0032_credit_wallet.sql` y sus reversiones en
`database/rollback/`; `frontend/src/admin/pages/AiSettings.tsx`.
Modificados: `ai/spendGuard.ts`, `ai/credits.ts`, `routes/admin.ts`, `index.ts` (variables y cron),
`services/assistant/consumption.ts`, `services/assistant/agent/orders.ts` (consultas de pedidos pesan 2),
`whatsapp/photoBatch.ts`, bancos del asistente, `testing/realAiBudget.ts`, `wrangler.production.toml` (solo comentarios
y `AI_FX_COP_PER_USD`), `frontend/src/services/api.ts`, `App.tsx`, `AdminLayout.tsx`; pruebas de planes actualizadas.

## 3. Pruebas

- Worker: **853 pasan, 0 fallan**, 229 omitidas (modos con modelo real y staging). `tsc` sin errores.
- Frontend: `tsc` y `vite build` sin errores. **No se revisó visualmente en el navegador** (requiere Worker local con datos y sesión).
- `planCredits.test.ts` (21 pruebas, modelo simulado): sesión que se abre con la primera consulta y bloquea a las 30 con
  la hora de restablecimiento sin llamar al modelo; nueva sesión a las 5 h; límite mensual aunque la sesión tenga
  saldo; pesos 1/2/4/2 por foto; devolución al fallar; reintento y duplicados sin doble cobro; 50 simultáneas con 3
  libres → exactamente 3 y una sola sesión; simultaneidad y tamaño; presupuesto interno en COP; contratos anteriores
  sin cupo; créditos del plan idempotentes y vencimiento; 10 créditos por imagen y sin doble cobro; contratos
  anteriores con su costo; créditos devueltos si falla; orden plan → cortesía → compra; cifrado ligado a la tienda;
  conexión solo con clave válida; la clave no aparece en respuestas, eventos, auditoría ni registros; aislamiento
  entre tiendas; solo el propietario; con API propia usa solo esa clave y no descuenta consultas ni créditos; usos
  por función; fallo de la API propia sin caída a TiendIA; con permiso expreso sí cae y cuenta consultas; reemplazar y
  desconectar con historial; clave sin modelo de imagen rechazada para el Estudio; presupuesto global agotado: la
  tienda con API propia sigue; panel con sesión, mes, créditos, paquetes, historial y pesos sin datos sensibles.
- Migraciones 0029–0032 aplicadas y revertidas sobre una **copia exportada de staging** (solo lectura de staging):
  filas de tiendas, productos, pedidos y créditos intactas; planes nuevos con sus cupos; reversión devuelve la cuota
  de mensajes de 0023. La copia se borró. **La prueba sobre una copia de producción no se hizo** (la exportación quedó
  bloqueada por permisos).

## 4. Valores cargados (aprobados en el diseño)

| Plan | Sesión (5 h) | Mes | Presupuesto interno | Créditos/mes | Costo imagen premium |
|---|---|---|---|---|---|
| Emprendedor | 30 | 300 | 6.000 COP | 30 | 10 créditos |
| Negocio | 80 | 1.000 | 15.000 COP | 80 | 10 |
| Mayorista | 200 | 2.500 | 35.000 COP (recomendado 40.000 desde ene‑2027) | 180 | 10 |
| Contratos anteriores (basico, profesional, premium, legacy) | sin cupo | se registran | su presupuesto actual | — | costos actuales (v1) |

Paquetes: 100 = 12.000 · 300 = 30.000 · 700 = 63.000 COP (12 meses). Límites técnicos: 3 simultáneas, 60/min,
3 intentos por tarea, duplicados 2 min.

## 5. Riesgos y pendientes

| Tema | Estado |
|---|---|
| Landing pública con la oferta anterior (500 mensajes, 50/150/400 fotos) | **Sin cambiar.** Debe actualizarse antes de vender con este modelo (requiere tu aprobación de textos) |
| Plan Promocional y condiciones de contratos anteriores | No están en el sistema; los contratos anteriores quedan intactos y solo se observan |
| Vigencia de cortesías nuevas (propuesta 90 días) y reembolsos de compras | Implementado como opción del superadmin (`validDays`); política comercial por definir |
| Prueba de migraciones sobre copia de producción | Pendiente (permiso) |
| Revisión visual del panel | Pendiente (solo build y tipos) |
| Pago en línea de paquetes | Fuera de alcance: la recarga sigue siendo solicitud + aprobación tras pago externo |
| Alertas al comerciante | Quedan en `platform_events` y en el panel; aviso proactivo por Telegram/correo pendiente |
| Interpretación del motor anterior (~3× más cara que 1 consulta) | Pesa 1: conviene limitar su razonamiento antes de vender planes nuevos |

## 6. Plan de publicación (cada paso con tu autorización)

1. Aprobar textos de la landing y la política visible.
2. Generar `AI_KEYS_MASTER_KEY` (32 bytes aleatorios) y guardarlo como secreto en staging y luego en producción.
3. Staging: migraciones 0029–0032, publicar la rama con `AI_SPEND_GUARD_MODE = "enforce"` y probar con una tienda
   Emprendedor ficticia (bloqueo de sesión real con 1 consulta, API propia de pruebas).
4. Producción: copia de seguridad de D1, migraciones 0024–0032 en orden, publicar en `shadow`; observar 7 días.
5. Activar planes nuevos y `enforce` cuando la landing esté actualizada.
6. Reversión: `AI_SPEND_GUARD_MODE = "off"` o versión anterior del Worker; archivos de reversión por migración.
