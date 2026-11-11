# Fase 2: cuota de mensajes con IA por plan (implementada en la rama aislada)

Rama `feat/telegram-ia-planes` (carpeta `catalogo-lite-bot`). **No está desplegada, no se aplicó ninguna migración en producción ni en staging remoto, y no se modificó ningún dato real.** Las decisiones D1 a D7 aprobadas por el propietario están aplicadas como se describe aquí. Complementa a [TELEGRAM_IA_PLANES.md](TELEGRAM_IA_PLANES.md) (auditoría y fase 1).

## 1. Estado

| Entregable | Estado |
|---|---|
| Tabla `ai_message_ledger` y `ai_message_alerts` (migración `0023`, aditiva) | Implementado y probado en SQLite local con las mismas migraciones de D1 |
| Rollback `0023_ai_message_quota.down.sql` | Implementado y probado (con datos, y volviendo a aplicar la migración) |
| Registro de interacciones por tienda, sin conteo doble | Implementado y probado |
| Cálculo del ciclo de consumo | Implementado y probado |
| Consulta del consumo actual | Implementado y probado |
| Comando `/consumo` (y «¿cuántos mensajes me quedan?») | Implementado y probado |
| Avisos al 80 % y al 100 % | Implementado y probado |
| API administrativa de consumo | Implementado y probado |
| Monitoreo de consumo anómalo, bucles y costos | Implementado y probado (solo observa; no bloquea) |
| Modo `off / shadow / enforce` | Implementado y probado; **por defecto `off`** |
| Panel gráfico | Solo propuesta (sección 7) |
| Aplicar la migración en un D1 remoto de pruebas | Pendiente: requiere tu orden (no se hizo) |
| Despliegue, activar `shadow` o `enforce` en producción | **Requiere tu autorización** |

Suite completa: **523 pruebas pasan, 1 omitida** (la prueba manual con IA real, `RUN_REAL_AI=1`); `tsc` limpio.

## 2. Producción (solo lectura, agregada)

Consulta autorizada y de solo lectura (sin correos, teléfonos ni datos privados; no se modificó nada):

| Plan | Estado | Tiendas |
|---|---|---|
| `basico` | borrador | 1 |
| `profesional` | activa | 1 |
| `premium` | activa | 3 |
| `legacy` | activa | 1 |

La tabla `plans` de producción tiene solo `basico`, `profesional`, `premium` y `legacy`, todos activos. **No existe ningún plan «Promocional» ni tienda con cuota de 300 mensajes**, y producción tiene 6 tiendas en total. Si hay clientes históricos con ese derecho, no están registrados en la base: habría que indicarlos para fijarles `monthlyMessagesOverride = 300` (ya existe el mecanismo, auditado, sin migrar a nadie).

## 3. Cómo funciona

**Modo** (`AI_MESSAGE_QUOTA_MODE`):

| Valor | Efecto |
|---|---|
| `off` (por defecto, y cualquier valor desconocido) | No cuenta nada. Comportamiento actual. |
| `shadow` | Cuenta, avisa y registra, **nunca bloquea**. |
| `enforce` | Además rechaza la interpretación con IA al agotar la cuota del plan. No se activa en producción sin tu autorización. |

**Qué cuenta (una interacción = una fila):** un mensaje de texto o de voz del comerciante que necesita IA (`interpretacion`, `voz`, `descripcion`, `consejos`, `pregunta`) y que la IA procesó con éxito.

- Un mensaje que necesita varias llamadas al modelo (por ejemplo el lector de comercio y el intérprete general) **cuenta una sola vez**: la clave `(tienda, evento de Telegram)` es única.
- Una nota de voz es **una** interacción: una sola llamada transcribe e interpreta. El costo estimado de la parte de audio se guarda aparte (`transcription_cost_micros`, calculado con ~32 tokens por segundo de audio).
- Un reintento técnico del mismo evento no cuenta de nuevo. Una llamada fallida **libera** la reserva (no cuenta).
- No cuentan: botones, Confirmar/Corregir/Cancelar, ayuda, comandos, consultas deterministas, ni fotos, documentos y análisis de marca (esos se administran con créditos).
- Reserva atómica: el cupo y la inserción son una sola sentencia, así que mensajes simultáneos no superan el límite. Una reserva abandonada vence a los 10 minutos.
- Si el contador falla, el asistente sigue funcionando sin contar y queda el error en el registro.
- El libro **no guarda el contenido** de los mensajes; solo un hash corto del texto para detectar bucles.

**Ciclo (D1):** se usa el ciclo real cuando existe, en este orden: (1) `stores.ai_cycle_anchor_day` (1 a 28), (2) el día de inicio del servicio mensual o anual activo `asistente_ia` o `mantenimiento_mensual`, (3) mes calendario en `America/Bogota`, marcado como **provisional** (solo observación). Casos excepcionales: el día 29, 30 o 31 se ajusta al último día de los meses cortos; un servicio cancelado, suspendido o de cobro único no define ciclo; Bogotá es UTC-5 todo el año. No se tocan fechas de facturación ni contratos.

**Límite:** `stores.ai_monthly_messages_override` (derechos particulares) tiene prioridad sobre `plans.ai_monthly_messages`; vacío significa sin tope numérico.

**Planes (D2):** `emprendedor` (500 mensajes, política `quota`), `negocio` y `mayorista` (sin tope, política `monitored`), con los precios indicados (setup, mensual, anual). Se crean **inactivos**: no aparecen en `/api/platform/plans`, en el bot maestro ni en la conversión de pruebas, y ninguna tienda se migra. Los planes `basico`, `profesional`, `premium` y `legacy` no cambian. El presupuesto de costo (US$2, 6 y 10) y el tope de productos (500, 2.000, 5.000) son **valores provisionales** que hay que confirmar antes de activarlos.

**Avisos y monitoreo (D4):**
- 80 % y 100 %: un solo aviso por umbral y ciclo, enviado **después** de la respuesta; se registra también en eventos de plataforma (`AI_QUOTA_80`, `AI_QUOTA_100`). Solo para planes con tope numérico.
- Observación (nunca bloquea): `AI_USAGE_ANOMALY` si una tienda supera `AI_MONITOR_DAILY_MESSAGES` en 24 h (por defecto 300 en planes `monitored` y 150 en los demás) y `AI_LOOP_SUSPECTED` si el mismo mensaje se repite `AI_MONITOR_LOOP_REPEATS` veces (por defecto 6) en 10 minutos. Los umbrales son **provisionales**; la política de uso razonable se propondrá con costos reales.
- La protección contra llamadas duplicadas y la concurrencia están en el contador; el límite de 20 mensajes por minuto por chat ya existía.

## 4. API

| Ruta | Quién | Contenido |
|---|---|---|
| `GET /api/platform/ai-messages` | Superadministrador | Todas las tiendas: plan, ciclo, usados, límite, porcentaje, costos estimados, señales de 7 días y totales |
| `GET /api/platform/stores/:slug/ai-messages` | Superadministrador | Detalle: últimas 50 interacciones (sin contenido), avisos, eventos |
| `PUT /api/platform/stores/:slug/ai-messages` | Superadministrador | `cycleAnchorDay` (1-28 o null) y `monthlyMessagesOverride` (≥ 0 o null); validado y auditado |
| `GET /api/admin/ai-messages` | Administrador de la tienda | Solo el consumo de su propia tienda |

## 5. Pruebas nuevas (31 de cuota + 11 de seguridad del inventario)

Cubren: ciclos (ancla, servicio, calendario, Bogotá, día 31), planes inactivos y sin migración, límite por plan y por excepción, no contar botones ni consultas deterministas, no contar fallos, no contar dos veces el mismo evento, voz como una interacción con costo aparte, `shadow` sin bloquear, `enforce` bloqueando solo la IA, concurrencia, reservas liberadas o vencidas, aislamiento entre tiendas, fallo del contador, avisos 80/100 una sola vez, monitoreo de volumen y bucles, privacidad del libro, `/consumo`, permisos de la API, validación y auditoría de la configuración, y migración con rollback.

## 6. Despliegue y reversión (cuando lo autorices)

1. Aplicar `0023` en un D1 de pruebas remoto (no hecho) y verificar.
2. Desplegar el Worker con `AI_MESSAGE_QUOTA_MODE` sin definir (= `off`): no cambia nada para nadie.
3. Activar `shadow` durante al menos un ciclo y revisar el consumo y los costos reales.
4. `enforce` solo para tiendas con plan de cuota y con tu autorización expresa.

Reversión: poner `AI_MESSAGE_QUOTA_MODE=off` (inmediato, sin desplegar); o ejecutar `database/rollback/0023_ai_message_quota.down.sql` (borra el libro y los avisos, quita los planes nuevos solo si ninguna tienda los usa y elimina las columnas agregadas).

## 7. Propuesta de interfaz de administración (no implementada)

- **Superadministrador, «Consumo de IA»:** tabla por tienda (plan, ciclo, usados/límite con barra, costo estimado, última actividad, señales), filtros por plan y por «cerca del límite», y ficha de la tienda con la línea de tiempo diaria, avisos enviados y eventos. Edición de ciclo y cuota con confirmación y registro.
- **Comerciante, en su panel:** tarjeta «Mi asistente» con mensajes usados y disponibles, fecha de renovación y enlace a recargar o cambiar de plan; en lenguaje cotidiano, sin términos técnicos.
- Se construye sobre la API de la sección 4, sin cambios de backend.

## 8. Pendiente o por decidir

- Autorizar aplicar la migración en un D1 remoto de pruebas, y después el despliegue y la activación en `shadow`.
- Confirmar presupuesto de costo, tope de productos y funciones de los tres planes antes de activarlos.
- Indicar si existen clientes históricos con 300 mensajes (no hay rastro en la base).
- Política de uso razonable de Negocio y Mayorista: se propondrá con costos reales tras el período en `shadow`.
- Confianza de transcripción por valor dudoso y prueba con nota de voz real (de la fase 1).
