# Cierre controlado de las fases 1 y 2 (validaciones)

Rama `feat/telegram-ia-planes`. Sin push, merge, despliegue ni cambios en producción. El D1 remoto de pruebas **no recibió ninguna migración nueva** en esta etapa.

## 1. Corrida remota del contador (D1 de pruebas)

| Dato | Resultado |
|---|---|
| Estado | **Terminó correctamente** (no estaba bloqueada: avanzaba; la salida solo aparece al final) |
| Pruebas | **15 correctas, 0 fallidas, 0 pendientes**; 711 s |
| Procesos atascados | Ninguno quedó vivo; no hizo falta detener nada |
| Costos | Sin llamadas de IA (solo SQL): costo de IA = 0. Consumo de D1 pequeño (cientos de sentencias) |
| Límite de ejecución | Cada prueba tiene tiempo máximo (15 min) y la espera se hizo con límite; el adaptador aborta si el ID del D1 no es el de pruebas |
| Limpieza | 0 tiendas `qa-staging-*`, 0 filas en `ai_message_ledger`, `ai_message_alerts`, eventos y uso; conteos del D1 iguales a los de antes (1 tienda, 2 productos, 24 operaciones, 3 eventos) |
| Incidente previo | Dos intentos anteriores fallaron por mi adaptador (consulta con `--file` no devuelve filas; comillas en Windows) y dejaron 15 tiendas sintéticas, que se borraron. No se repitió la prueba completa innecesariamente |

## 2. Simulación de las migraciones 0017 a 0022

Copia aislada: exportación del D1 de pruebas (ID `18ac228c-…`, no el de producción), cargada en una base local en memoria. Nada se ejecutó en el D1 remoto.

| Comprobación | Resultado |
|---|---|
| Orden 0017 → 0018 → 0019 → 0020 → 0021 → 0022 | Las seis aplican sin error |
| Tablas | 57 → 66 (las 9 que faltaban) |
| Datos preexistentes | Sin cambios: ninguna tabla existente cambió de filas ni de contenido |
| Relaciones | `foreign_key_check`: 0 antes y 0 después |
| Esquema final frente al esperado (todas las migraciones desde cero) | **Idéntico** (tablas, columnas) y 0 índices faltantes o sobrantes |
| Dependencias | 0017 stores/products; 0018 stores; 0019 email_messages (0014); 0020 ai_credit_ledger (0011); 0021 creative_jobs (0020), trial_sessions (0015), products; 0022 campaigns (0010), todas presentes. 0014, 0015 y 0016 ya están aplicadas a mano (esquema verificado); la 0023 también |
| Destructivas | Ninguna: no hay `DROP`, `DELETE`, `UPDATE` ni `RENAME` en 0014-0022 |

**Conflicto conocido (no se resolvió en el remoto):** el registro `d1_migrations` llega solo hasta 0013. El aplicador oficial (`wrangler d1 migrations apply`) empezaría por 0014 y fallaría (columna duplicada), igual que 0015, 0016 y 0023 si se reaplicaran. **No usarlo** hasta registrar esas migraciones.

**Orden seguro propuesto para sincronizar el staging (cuando lo autorices):**
1. Nueva exportación de respaldo y marcador de Time Travel.
2. Ejecutar por archivo, en este orden: `0017`, `0018`, `0019`, `0020`, `0021`, `0022` (`wrangler d1 execute … --file`).
3. Verificar tablas, índices, `foreign_key_check` y conteos.
4. Registrar en `d1_migrations` las migraciones 0014 a 0023 (sin ejecutarlas).
5. Desde ahí, el aplicador oficial vuelve a ser utilizable.

## 3. Pruebas locales

543 correctas, 0 fallidas, 17 omitidas (560). Los 49 archivos de prueba pasan; `tsc` limpio.

| Omitidas | Cantidad | Motivo |
|---|---|---|
| `src/testing/photo-real.test.ts` | 1 | Manual contra el modelo de imagen real (`RUN_REAL_AI=1`), gasta cuota |
| `src/testing/voice-real.test.ts` | 1 | Manual con Gemini real y audio sintético (`RUN_REAL_AI=1`, `VOICE_DIR`, `DEV_VARS`); se conserva como prueba técnica |
| `src/ai/messageQuota.staging.test.ts` | 15 | Opt-in contra el D1 remoto de pruebas (`STAGING_D1_VALIDATE=1`); ejecutadas aparte: 15/15 |

Voz: falta una prueba con **nota de voz humana enviada por Telegram** a un bot de pruebas; no se usan tiendas ni inventarios reales y no se crea ningún producto sin confirmación.

## 4. Estado de `/consumo`

Implementado y probado **localmente** (plan, usados, disponibles, ciclo, fotos y descripciones incluidas; sin IA, sin contar; solo la tienda del chat). **No** se probó contra el Worker de pruebas desplegado ni con Telegram real, porque ese Worker tiene código antiguo y el D1 está desactualizado (0017-0022).

## 5. Planes inactivos

Emprendedor, Negocio y Mayorista siguen `is_active = 0`, ninguna tienda los usa (comprobado local y en el D1 de pruebas). El marcador de productos ilimitados lo leen solo `productLimit`, el listado de plataforma y el bot maestro, los tres con protección (prueba de guarda). Los planes `basico`, `profesional`, `premium` y `legacy` no cambiaron.

## 6. Costos y riesgos

- Costo de IA medido en esta etapa: ≈ US$0,009 (4 llamadas de voz sintética) y 0 en la corrida remota.
- Método de medición de costos reales: `GET /api/platform/ai-costs` (conversaciones, voz y su parte de audio, fotos, descripciones, otros; infraestructura solo si se informa la factura). Falta correrlo con uso real: requiere activar `shadow` o una lectura agregada autorizada.
- Presupuestos de US$5 / 14 / 40 y US$0,077 por imagen: **siguen siendo estimaciones sin medir**.
- Riesgo económico: fotos y descripciones incluidas no se aplican; mitigación sin bloqueo: avisos 80/100 % (`AI_PHOTOS_*`, `AI_DESCRIPTIONS_*`), informe de costos, créditos y tope global.
- Orden de despliegue: la migración 0023 **debe ir antes** que el código nuevo (el código lee sus columnas); al revertir, primero el código y luego el esquema.
- La nota de voz humana y la confianza de transcripción siguen pendientes.

## 7. Bloqueos restantes

**Antes de staging completo:** autorizar el orden de la sección 2 (0017-0022 y registro), y redesplegar el Worker de pruebas.
**Antes de producción:** probar `/consumo`, API y voz humana en staging; medir costos reales; confirmar presupuestos de referencia y política de uso razonable; autorización expresa para migrar y desplegar; activar en `shadow`.
