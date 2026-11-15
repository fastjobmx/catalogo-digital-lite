# IA por plan — cupo mensual único (decisión del 2026-11-15)

Rama `feat/ia-planes-creditos`, implementación local con commit local. **Sin push, merge, migraciones ni despliegues
en producción.** Staging sigue con la versión anterior (sesiones de 5 h) hasta que autorices actualizarlo.
Todo se validó con el modelo simulado: no se gastó saldo de Gemini.

## 1. Qué cambió

| Antes | Ahora |
|---|---|
| Sesión de 5 h (30 / 80 / 200) + mes | **Solo el mes: 300 / 1.000 / 2.500 consultas**, usables cuando el comerciante quiera |
| Tope de dinero diario y mensual por tienda | El dinero **no recorta el cupo**: solo frena una anomalía a 3 veces el presupuesto interno |
| Cupo de imágenes por mes (50 / 150 / 400) | Las imágenes se limitan solo por los **créditos** (incluidos o comprados) |
| Sin avisos al comerciante | Avisos al **50, 75, 90 y 100 %**, una sola vez por ciclo |
| API propia: solo «activa / sin cuota» | Nivel detectado (gratuito / con facturación), capacidad real de imágenes, último límite de Google en palabras simples, privacidad de compradores |
| Panel con contador de sesión | Panel con **consumo mensual**, créditos, Mi API, ampliar capacidad, historial y cómo se cuenta |

Migración **0034** (aditiva): pone en NULL las sesiones de los planes nuevos, crea `ai_quota_notices` y agrega
`tier`, `image_capability` y `last_error_detail` a la API propia. Las tablas de sesiones de 0030 quedan sin uso
(no se borra nada). Número 0034 para no chocar con 0033 de la prueba gratis.

## 2. Cómo se cuenta (política transparente)

| Tarea | Consultas |
|---|---|
| Ver existencias, precio exacto, confirmar, deshacer, menú, pedidos sin IA | **0** |
| Mensaje interpretado con IA, preguntas, consejos, textos comerciales | 1 |
| Consulta o reporte de pedidos con IA | 2 |
| Organizar fotos de un lote | 2 por foto |
| Nota de voz (hasta 2 min), foto a producto, descripción, página de PDF, guía de envío | 4 |
| Imagen premium | 10 créditos artísticos (no consultas) |

- **Tareas complejas:** una tarea se cobra **una sola vez** por su peso aunque la IA haga varios pasos o reintentos
  (por ejemplo, leer el mensaje y repetir si la respuesta llegó cortada). Un lote cuenta por foto.
- **Sin doble cobro:** el reintento de la misma tarea, el mensaje que Telegram o WhatsApp entrega dos veces y la
  misma solicitud repetida en 2 minutos no se cobran otra vez. Si la tarea falla, se devuelven las consultas.
- **Si la tarea pesa más de lo que queda** (voz = 4 con 3 libres), se dice así: «Esta tarea necesita 4 consultas y te
  quedan 3…». Una tarea pequeña sí pasa.

## 3. Avisos y cupo agotado

| % | Aviso (chat y panel, una vez por ciclo) |
|---|---|
| 50 | Informativo: llevas la mitad, fecha de renovación |
| 75 | Sugiere conectar API propia (o recuerda que ya está conectada) |
| 90 | Advertencia: te quedan N |
| 100 | Terminó el cupo incluido; fecha exacta de renovación; lo que no usa IA sigue; opción de API propia |

Al 100 % el **backend** pausa las nuevas tareas que gastarían consultas del plan, sin llamar al modelo. Catálogo,
inventario, pedidos, comandos y borradores siguen; los lotes de fotos se conservan. Si dos avisos se cruzan a la vez
(por ejemplo 50 y 75 en una tarea grande), se muestra solo el más alto.

## 4. API propia

- Se acepta **gratuita o con facturación**. Formulario con 5 pasos (AI Studio → Get API key → copiar → opcional
  facturación → pegar y validar).
- **Verificación:** clave válida y modelos disponibles (sin gastar tokens). Las **imágenes** se confirman en la
  primera generación real (no hay forma gratuita de probarlas): si Google responde con el límite del nivel gratuito,
  la clave queda «imágenes: no disponible» y las siguientes imágenes **no se envían** a ella (se pagan con créditos, a la
  vista del comerciante). Una imagen generada confirma imágenes y facturación.
- **Nivel detectado:** Google marca sus límites gratuitos como `free_tier`; con eso la clave queda «nivel gratuito».
  El panel muestra el último límite en palabras simples (por ejemplo, «Límite del nivel gratuito de Google
  (solicitudes por minuto): 15. Google sugiere esperar 37s.»).
- **Privacidad (evaluación aplicada):** en el nivel gratuito Google puede usar y revisar el contenido para mejorar
  sus productos. Por eso **los pedidos y las guías de envío (datos personales de compradores) nunca se envían a una
  clave gratuita o sin confirmar**: se procesan con TiendIA y cuentan del plan. Solo con facturación confirmada usan
  la clave propia. Los mensajes del comerciante, notas de voz y fotos de productos sí pueden ir a su clave gratuita,
  con el aviso visible antes de conectar. *Pendiente de tu revisión:* si quieres extender la restricción a cualquier
  conversación que pueda mencionar clientes.
- **Sin respaldo automático:** viene desactivado. Solo con autorización expresa del dueño, y entonces esas tareas
  cuentan consultas del plan. Nunca se usa respaldo cuando los créditos se exoneraron por la API propia.
- **Tiempo máximo:** 25 s por tarea de texto; si la API propia no responde, aviso de «API lenta».

## 5. Revisión económica (costos medidos, US$ 1 = 4.000 COP)

Costo de usar el **cupo completo** más los créditos del plan:

| Plan | Motor | 2026 | 2027 | Presupuesto interno | Margen peor caso |
|---|---|---|---|---|---|
| Emprendedor | asistente nuevo | 2.491 | 4.051 | 6.000 | 79 % |
| | motor anterior* | 4.651 | **8.371** | 6.000 | 70 % |
| Negocio | asistente nuevo | 7.683 | 12.883 | 15.000 | 75 % |
| | motor anterior* | 14.883 | **27.283** | 15.000 | 58 % |
| Mayorista | asistente nuevo | 18.587 | 31.587 | 35.000 | 71 % |
| | motor anterior* | **36.587** | **67.587** | 35.000 | 45 % |

\* El motor anterior razona sin límite: mide ~US$ 0,0031 por mensaje frente a ~US$ 0,0011 del asistente nuevo.

**Conclusión:** con el asistente nuevo, los presupuestos internos cubren el cupo completo en 2026 y 2027
(Mayorista 2027 al 90 %). Con el motor anterior **no alcanzan** desde 2027 (y Mayorista ya en 2026).
Para cumplir la regla de «no recortar el beneficio prometido», el presupuesto interno **ya no bloquea**: es una
referencia con alerta para la plataforma, y el único tope de dinero por tienda es la anomalía a 3 veces (que cubre
todos los casos de la tabla). El negocio sigue siendo rentable en todos los casos (margen mínimo 45 %), pero conviene:

1. **Activar el asistente nuevo en las tiendas de planes nuevos** (ya validado en staging).
2. **Limitar el razonamiento del motor anterior** (requiere una prueba pequeña con modelo real, con tu permiso).
3. Subir el presupuesto de referencia de Mayorista a **40.000 COP** desde enero de 2027.
4. **Tope global:** debe ser ≥ la suma del costo esperado de los cupos de las tiendas activas y ≤ el saldo prepago de
   Google. Si no, el tope global recortaría cupos: recargar saldo antes de activar planes nuevos.

100 consultas en un día cuestan ~520 COP con el asistente nuevo (2026).

## 6. Compatibilidad

- Las 9 tiendas actuales (planes anteriores) no cambian: sin cupo de consultas, se registran; mismos créditos y costos.
- Telegram, WAHA, Meta, Fábrica de Publicidad y demás funciones siguen igual.
- **Landing:** textos actualizados **solo en la rama**, sin publicar: 300 / 1.000 / 2.500 consultas al mes sin límite
  por día, 30 / 80 / 180 créditos artísticos, API propia; tabla comparativa y Estudio ajustados. Las 7 comprobaciones de
  la landing pasan. Requieren tu aprobación antes de publicarse.

## 7. Pruebas (modelo simulado)

Servidor: **861 pasan, 0 fallan** (229 omitidas: modos con modelo real y staging). Escenarios pedidos, en `worker/src/ai/planCredits.test.ts`:
100 consultas en un día · las 300 de Emprendedor y la 301 pausada con fecha · avisos 50/75/90/100 una sola vez ·
tarea más grande que lo que queda · renovación mensual · API gratuita (free_tier, imágenes no disponibles, pedidos con
TiendIA) · API con facturación (imágenes y pedidos con su clave) · API inválida · modelo no disponible · reintentos y
duplicados · 50 simultáneas con 3 libres · anti-ráfaga · tope solo por anomalía · contratos anteriores · créditos
separados · API lenta · panel sin sesiones. Continuidad sin IA y bloqueo global en `spendGuard.test.ts`.

Capturas en `docs/capturas-ia-mensual/` (consumo al 75 %, consumo al 100 %, Mi API, capacidades).
