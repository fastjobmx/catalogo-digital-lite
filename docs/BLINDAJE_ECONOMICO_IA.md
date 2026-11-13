# Blindaje económico de la IA — TiendIA Exprés

Rama `feat/blindaje-ia` (desde `main` b294592), sin push, sin merge, sin migraciones ni despliegues en producción.
Validado solo con modelo simulado: **ninguna prueba gastó créditos de Gemini**.

Convenciones: precios en USD por millón de tokens (o micro-USD); COP al cambio supuesto de 4.000 por dólar.

---

## 1. Arquitectura

```
Entrada (quién paga)                       Cliente de Gemini                     Libro de gasto (D1)
───────────────────────                    ──────────────────                    ───────────────────
Asistente Telegram  ─ withAiBudget ─┐
Créditos (panel, lotes, estudio,    │      callGeminiJson (texto)    ─┐
  guías, PDF, textos) ─ runWithCredits ┤──► editPhotoWithInstruction ─┼─► guardedGeminiFetch ─► 1. RESERVA (un INSERT
Bot maestro ─ runWithSpend(platform) ─┤      videoEngine (video)       ─┘     ▲                   que verifica todos los
Pruebas gratuitas ─ runWithSpend(trial)┘                                      │                   límites a la vez)
                                                                              │                2. llamada a Google
                                         sin contexto en staging/producción ──┘ ⛔ se niega     3. CONCILIA con el costo
                                                                                                  real (tabla oficial)
Cron cada 15 min: cierra reservas abandonadas por lo reservado.          Alertas 50/80/100 % → platform_events
```

- **Un solo punto de control.** Los tres clientes que hablan con la API (`callGeminiJson`, `editPhotoWithInstruction`,
  el motor de video) pasan por `guardedGeminiFetch`. No se cambió la firma de ninguna función: quién paga viaja con la
  solicitud (AsyncLocalStorage) desde los puntos de entrada.
- **Reserva atómica.** Antes de llamar se reserva el costo máximo posible (lo que declara la solicitud: texto, fotos,
  audio, `maxOutputTokens`, segundos de video). Un único `INSERT … SELECT … WHERE` comprueba a la vez: presupuesto global
  diario y mensual, presupuesto diario y mensual de la tienda, cupo mensual de fotos premium, presupuesto diario de
  pruebas gratuitas, costo máximo por operación e intentos por operación. D1/SQLite ejecutan esa sentencia de forma
  atómica: **dos solicitudes simultáneas no pueden pasar ambas por debajo del límite** (probado con 20 y 30 a la vez).
- **Conciliación.** Después de la llamada se cierra la reserva con el costo real medido (`usageMetadata`):
  respuesta correcta o cortada → se cobra lo medido; error HTTP (Google no lo cobra) → se libera en 0; corte de red →
  se conserva lo reservado (pudo cobrarse). Las reservas que un Worker caído deja abiertas expiran a los 10 minutos
  por lo reservado.
- **Duplicados y reintentos.** Cada operación tiene una clave estable (la actualización de Telegram, el trabajo de la
  cola, la clave de idempotencia). Como máximo **3 intentos pagados por operación**, aunque el webhook llegue repetido o
  el trabajo se reintente.
- **Modos** (`AI_SPEND_GUARD_MODE`): `off`, `shadow` (reserva, concilia y alerta sin bloquear) y `enforce` (además
  bloquea). Por defecto: **`shadow` en producción** hasta tu aprobación; `enforce` en staging, desarrollo y pruebas.
  Si el libro de gasto no responde: en `enforce` no se llama a Gemini; en `shadow` se sigue atendiendo.

## 2. Archivos

| Archivo | Cambio |
|---|---|
| `worker/src/ai/pricing.ts` | **Nuevo.** Tabla oficial versionada (`PRICING_VERSION = 2026-11-13`) por modelo y fecha: entrada, audio, salida con razonamiento, caché, imagen, contexto largo, Batch/Priority. Cambio de tarifa del 1‑ene‑2027 incluido. Modelos desconocidos → la tarifa más cara conocida. Correcciones auditables con `AI_PRICING_OVERRIDES`. |
| `worker/src/ai/spendGuard.ts` | **Nuevo.** Reserva, conciliación, límites, alertas, expiración, modos y resumen. |
| `database/migrations/0029_ai_spend_guard.sql` | **Nueva, aditiva**: `ai_spend_reservations`, `ai_spend_limits`, `ai_spend_alerts`. Número 0029 para no chocar con 0024–0028 de las ramas de WhatsApp y del asistente. Reversión en `database/rollback/0029_ai_spend_guard.down.sql`. |
| `worker/src/testing/realAiBudget.ts` | **Nuevo.** Presupuesto de pruebas con IA real: clave propia `GEMINI_TEST_API_KEY`, libro persistente `.tmp/ai-test-ledger.jsonl`, topes diario, mensual y por corrida. |
| `worker/src/ai/spendGuard.test.ts` | **Nuevo.** 23 pruebas (sección 3). |
| `worker/src/ai/usage.ts` | El estimador usa la tabla oficial (antes US$ 0,30 / 2,50; ahora 0,75 / 3,75 para gemini-3.8-flash). |
| `worker/src/ai/geminiClient.ts`, `imageStudio.ts`, `creative/videoEngine.ts` | Llaman a través de `guardedGeminiFetch`. |
| `worker/src/services/assistant/ai.ts` | `withAiBudget` declara tienda y operación; si se bloquea, responde con un mensaje claro y no cuenta el mensaje. |
| `worker/src/ai/credits.ts` | `runWithCredits` declara tienda y operación (`spendKey` estable para trabajos en cola); si se bloquea, **libera los créditos** y responde `budget_exhausted` / `platform_cap`. |
| `worker/src/services/master/bot.ts`, `services/trials.ts` | Bot maestro (alcance plataforma) y pruebas gratuitas (alcance pruebas) bajo el control. |
| `worker/src/services/telegramProductBatches.ts` | Si se agota el presupuesto en mitad de un lote, se detiene y conserva fotos y borradores. |
| `worker/src/creative/photoEngine.ts`, `services/aiCatalog.ts` | Sin los «trucos» de precio de imagen: el costo sale de la tabla por modelo. |
| `worker/src/index.ts` | Variables nuevas y limpieza de reservas en el cron. |
| `worker/wrangler.production.toml` | Declara `AI_SPEND_GUARD_MODE = "shadow"` (es el mismo valor por defecto; queda escrito para que nada lo cambie sin querer). |
| `worker/wrangler.remote-staging.toml.example`, `wrangler.toml`, `.dev.vars.staging.example` | Plantillas: staging con `enforce` y su propio entorno de presupuesto; clave de pruebas separada. Sin claves. |
| `voice-real.test.ts`, `photo-real.test.ts` | Pasan por el presupuesto de pruebas y exigen la clave de pruebas. |
| Pruebas existentes ajustadas | `plans.coherence`, `assistant`, `creative-photo`, `creative-pieces`: los costos esperados cambian a la tarifa oficial; se documenta (no se oculta) que la referencia del plan Negocio ya no cubre su oferta. |

## 3. Pruebas (todas con modelo simulado)

`npx vitest run` → **582 pasan, 0 fallan**, 17 omitidas (las que solo corren con modelo real). Escenarios pedidos:

| Escenario | Prueba | Resultado |
|---|---|---|
| Límite alcanzado | La llamada se bloquea **sin enviarse**; el gasto nunca supera el límite; alerta 100 % | ✅ |
| Reintentos duplicados | 4 entregas de la misma operación → 3 intentos pagados, el 4.º bloqueado | ✅ |
| Solicitudes simultáneas | 20 llamadas a la vez con cupo para 5 → exactamente 5 enviadas; 30 reservas directas → exactamente 5 | ✅ |
| Trabajos en cola | Lote de 3 fotos con cupo de 2 → 2 completadas, la 3.ª `BUDGET_EXHAUSTED`, **sin cobro de créditos**, original conservado; al ampliar el cupo se reintenta y se completa | ✅ |
| Fallo del modelo | Error HTTP → reserva liberada; corte de red → se conserva lo reservado; respuesta cortada → se cobra lo medido | ✅ |
| Consumo entre tiendas | Tienda A agotada no frena a B; el tope global sí cuenta a todas | ✅ |
| Generación de imágenes | Costo a US$ 60/M de tokens de imagen (US$ 0,0776 por foto); cupo mensual por tienda | ✅ |
| Presupuesto global agotado | Se detienen tiendas, bot maestro y pruebas gratuitas, con mensaje claro | ✅ |
| Continuidad del bot | Con la IA bloqueada, «cuántos quedan de las sandalias» sigue respondiendo con el inventario | ✅ |
| Alertas | 50, 80 y 100 % una sola vez por alcance y periodo | ✅ |
| Modo observación | No bloquea, registra «se habría bloqueado por…» | ✅ |
| Sin contexto | En staging/producción con control activo, una llamada sin dueño se niega | ✅ |
| Presupuesto de pruebas | Libro persistente entre corridas; la llamada que supera el tope diario no se envía; la clave compartida se rechaza | ✅ |

## 4. Presupuestos y límites propuestos (para tu aprobación)

Todos se pueden cambiar sin publicar código, en `ai_spend_limits`.

| Alcance | Día | Mes | Otros |
|---|---|---|---|
| **Producción — global** | US$ 2 | US$ 30, **y nunca más del 80 % del saldo prepago** (hoy ~US$ 2 → poner US$ 1,50 hasta recargar) | — |
| **Staging** (proyecto Google aparte) | US$ 0,50 | US$ 5 | — |
| **Pruebas locales** (proyecto Google aparte) | US$ 1 | US$ 10 | US$ 0,50 por corrida |
| Pruebas gratuitas (todas) | US$ 0,50 | — | ya existen topes por prueba e IP |
| Por operación | — | — | texto US$ 0,10 · imagen US$ 0,30 · video US$ 3 |
| Intentos por operación | — | — | 3 |

Por plan (mensual = lo que incluye la oferta usada al tope, a la tarifa 2026 + 10 %):

| Plan | Día | Mes | Fotos premium / mes |
|---|---|---|---|
| Emprendedor | US$ 1 | US$ 6,50 | 50 |
| Negocio | US$ 3,50 | US$ 20 | 150 |
| Mayorista | US$ 9 | US$ 55 | 400 |
| basico / profesional / premium / legacy (tiendas actuales) | 0,25 / 0,50 / 1,20 / 0,80 | 1 / 3 / 8 / 5 (los que ya tienen) | 20 / 50 / 100 / 60 |

## 5. Economía por plan (para decidir; no se cambió nada)

Costos unitarios con tokens **medidos**: mensaje de texto con IA US$ 0,0011 · nota de voz 0,0048 · descripción 0,0040 ·
foto → producto 0,0047 · **foto premium 0,0776** (todo se duplica en enero de 2027, salvo la foto premium).

Costo de IA como % del precio mensual del plan:

| Plan (precio) | Uso típico 2026 | Uso típico 2027 | Oferta al tope 2026 | Oferta al tope 2027 |
|---|---|---|---|---|
| Emprendedor ($59.900) | 15 % | 20 % | 41 % | 55 % |
| Negocio ($99.900) | 36 % | 45 % | **75 %** | **104 %** |
| Mayorista ($169.900) | 73 % | 87 % | **116 %** | **158 %** |

«Al tope» = todas las fotos premium incluidas + mensajes a la cifra de uso razonable propuesta (500 / 3.000 / 8.000, 20 % voz)
+ descripciones (200 / 300 / 600) + importaciones (100 / 100 / 200 fotos). Falta restar Cloudflare, WhatsApp, correo y soporte.

Lectura:
- **Las fotos premium son el riesgo principal**: al tope, 28 % del precio de Emprendedor, 50 % de Negocio y 79 % de Mayorista.
- **Mensajes «ilimitados» sin límite técnico**: una sola tienda con 50.000 mensajes al mes costaría ~446.000 COP en 2027
  y agotaría el saldo que comparten todas las tiendas. El control nuevo lo impide (tope mensual de la tienda y global).

Escenarios de ajuste (ninguno aplicado; necesitan tu aprobación):
1. **Mantener la oferta y fijar el uso razonable** de mensajes: Negocio 3.000 y Mayorista 8.000 al mes (los límites del § 4 ya lo reflejan).
2. **Bajar las fotos premium incluidas** (p. ej. Negocio 60, Mayorista 150) y vender paquetes adicionales con créditos
   a ≥ 800 COP por foto (costo ~310 COP).
3. **Subir precio de Negocio y Mayorista en enero de 2027** o limitar la IA de texto a un modelo más económico (Flash‑Lite
   cuesta ~1/3) si la calidad se mantiene en un banco de prueba.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| La reserva usa una estimación: si Google cuenta más tokens de entrada que los estimados, una llamada puede cerrar un poco por encima del límite | La estimación de salida usa el máximo declarado (domina el costo); el siguiente intento ya ve el gasto real. Probado: el gasto nunca superó el límite en las pruebas |
| Reservas grandes (p. ej. 8.192 tokens de salida) ocupan cupo mientras la llamada está en curso | Se liberan al terminar; con límites diarios pequeños pueden rechazar llamadas en ráfaga |
| Los trabajos de foto bloqueados gastan un intento de la cola | Quedan `BUDGET_EXHAUSTED` y se pueden reintentar; el original nunca se pierde |
| **Los bancos del asistente** (rama `feat/asistente-conversacional`) aún no usan el presupuesto de pruebas | Al integrar `main` en esa rama, envolver su `realFetch` con `budgetedRealFetch` (dos líneas por banco) |
| Precios de la tabla desactualizados | Versión y fecha en el código; `AI_PRICING_OVERRIDES` para corregir sin publicar; cada reserva guarda la versión usada |
| El tipo de cambio y el IVA no se modelan | Los límites están en dólares; dejar margen al fijar el global frente al saldo |
| Las alertas quedan en `platform_events`; no envían Telegram ni correo todavía | Siguiente paso: aviso al superadmin por el bot maestro |

## 7. Aislamiento de entornos (preparado, no ejecutado)

1. Crear en Google AI Studio **dos proyectos nuevos**: «TiendIA staging» y «TiendIA pruebas», cada uno con su propia
   clave y un saldo pequeño (p. ej. US$ 5).
2. Staging: `wrangler secret put GEMINI_API_KEY -c wrangler.remote-staging.toml` con la clave de staging, y en
   `[vars]` `AI_SPEND_GUARD_MODE = "enforce"` y `AI_BUDGET_ENVIRONMENT = "staging"` (plantilla incluida).
3. Equipo local: `GEMINI_TEST_API_KEY=` en `worker/.dev.vars` con la clave de pruebas. Las pruebas reales se niegan a
   usar la clave de producción salvo `AI_TEST_ALLOW_SHARED_KEY=1`.
4. Producción conserva su clave. **No se rotó ninguna clave.**
5. En Google Cloud Billing, una alerta de presupuesto por proyecto (aviso, no corte).

## 8. Plan de publicación (cada paso requiere tu autorización)

1. Aprobar presupuestos y límites (§ 4) y el modo de cada entorno.
2. Crear los proyectos y claves de staging y pruebas (§ 7).
3. Staging: aplicar la migración 0029, publicar la rama con `enforce`, cargar los límites aprobados y probar un bloqueo
   real con un límite de US$ 0,01 (una sola llamada).
4. Producción, fase observación: copia de seguridad de D1, migración 0029, publicar con `AI_SPEND_GUARD_MODE = "shadow"`,
   cargar el tope global (≤ 80 % del saldo). Revisar 3–7 días de reservas frente a AI Studio.
5. Producción, fase bloqueo: pasar a `enforce` con los límites aprobados.
6. Reversión: `AI_SPEND_GUARD_MODE = "off"` (inmediata, sin publicar código) o versión anterior del Worker; la
   migración es aditiva y tiene su archivo de reversión.
