# Términos v1.1 y servicios adicionales — entrega (2026-11-13)

Rama `feat/terminos-y-servicios`, solo commit local: **sin push, merge ni despliegue**.

## Qué se hizo

| Pieza | Dónde |
|---|---|
| `/terminos-y-condiciones`: documento completo v1.1 con índice y anclas, versión y fecha, botón de impresión | `src/legal/TermsPage.tsx`, texto en `src/legal/terminos-v1.1.md` |
| `/servicios-adicionales`: dominios, tarjetas SEO, tarifario, controles antes de contratar y preguntas frecuentes | `src/legal/ServicesPage.tsx`, datos en `src/legal/services.ts` |
| Footer: enlaces «Términos y condiciones» y «Servicios adicionales» (en todas las páginas); en las páginas legales los anclajes `#…` van a `/#…` | `src/config/site.ts`, `src/sections/Footer.tsx` |
| SEO: URL permanente sin `.html`, `<title>`, descripción, canonical, `og:url`, HTML prerenderizado, `h1`/`h2`/`h3` semánticos, sitemap con las 3 URLs | `terminos-y-condiciones.html`, `servicios-adicionales.html`, `vite.config.ts`, `scripts/prerender.mjs` |
| Estilos de impresión (sin cabecera, footer ni índice; tablas sin cortes) | `src/styles/global.css` (`@media print`) |
| Pruebas: prerender, un solo `h1`, sin errores de consola, axe WCAG 2.2 A/AA, sin desborde, footer, índice, ausencia de campos pendientes, único precio confirmado, sin formularios de pago | `tests/legal.spec.ts` |
| Capturas responsive (390, 820 y 1440 px) | `docs/capturas-legal/` · `node scripts/shots-legal.mjs docs/capturas-legal` |

Resultado: `npm run test:unit` 7/7 y Playwright 65 aprobadas, 1 omitida (que ya estaba omitida), en escritorio y móvil, con `npm run build` servido por `scripts/serve.mjs 4318`.

Cambios respecto al texto aprobado (por indicación del propietario, sin datos inventados):

- Sección 1: se omiten razón social, NIT, domicilio legal y dirección de notificaciones (todavía no existen).
- Horario (secciones 1, 28 y contacto): «horario de oficina, hora de Colombia», sin días ni horas.
- Encabezado: «Versión 1.1 · 13 de noviembre de 2026», sin la leyenda de borrador ni la nota final de revisión jurídica (el documento está aprobado).
- Sección 32: los dos plazos sin definir se muestran como «pendiente de definición».

## Precios pendientes de aprobación

Solo la **renovación anual de dominio estándar ($120.000 COP)** está confirmada. Todo lo demás se muestra con la etiqueta «Propuesto · sujeto a aprobación». Para aprobar uno, cambia su `status` a `'confirmado'` en `src/legal/services.ts`.

| Servicio | Precio propuesto | Periodicidad |
|---|---:|---|
| Registro inicial de dominio estándar (primer año) | $120.000 | por año |
| Conexión de dominio externo existente | $49.000 | único |
| SEO básico asistido | $149.000 | único |
| SEO avanzado, implementación inicial | $349.000 | único |
| SEO avanzado, seguimiento | $249.000 | mensual |
| Artículo SEO de hasta 1.000 palabras | $80.000 | único |
| Carga asistida hasta 50 / 100 / 500 productos | $49.000 / $89.000 / $349.000 | único |
| Personalización visual avanzada | $129.000 | único |
| Capacitación personalizada | $60.000 | por hora |
| 1 pieza / paquete de 5 piezas de diseño manual | $35.000 / $149.000 | único |
| Configuración de correo corporativo | $39.000 | único |
| Créditos artísticos 100 / 300 / 700 (**marcados «Aún no disponible»**: falta el monedero) | $12.000 / $30.000 / $63.000 | por paquete |

Tampoco hay valor tributario definido: la página dice que los impuestos aplicables se informan en la cotización, antes del pago.

## Datos legales faltantes

- Razón social o titular.
- NIT o identificación.
- Domicilio legal.
- Dirección de notificaciones.
- Días y horas del horario de atención.
- Periodo de conservación de datos después de la cancelación (§32).
- Periodo y procedimiento de exportación de datos (§32).
- **Política de Tratamiento de Datos Personales**: la §23 la cita, pero no existe en el sitio (el enlace «Política de privacidad» del footer sigue oculto).

## Auditoría: contradicciones encontradas (nada se cambió)

1. **Precio del dominio en la landing.** La tarjeta «Dominio propio» de la página principal (`src/content/plans.ts`, `addOns`) dice «Plan Emprendedor: $99.000 COP al año». Los términos dicen $120.000 (registro propuesto y renovación confirmada). Hay que decidir cuál aplica y si hay clientes con el valor anterior (§34: no se cambia retroactivamente).
2. **Ningún plan incluye dominio propio.** Los tres planes incluyen la dirección `app.tiendiaexpres.com/t/…` sin costo. Es coherente con §10 y §11.5; si algún plan anuncia «dominio incluido», su ficha debe decir si cubre solo el registro o también las renovaciones.
3. **Prueba gratuita (§6).** La landing y `/prueba` dicen 7 días, 7 productos y sin correo ni contraseña, y no hay cobro automático (coherente). Pero `/prueba` **no informa qué pasa con los datos al terminar la prueba**, y la §6 exige mostrar los plazos de conservación antes de empezar.
4. **Aceptación electrónica e historial de versiones (§2, §37).** No encontré en la plataforma ningún registro de aceptación de términos ni de la versión aceptada. Hoy la aceptación no queda registrada.
5. **Quejas y reclamos (§30).** No existe un mecanismo con número de radicado.
6. **IA (§17 y §19).** Las sesiones de cinco horas y la API propia no están habilitadas. Los términos las tratan como condicionales («cuando se habilite»), y la landing no las anuncia: sin contradicción. Los cupos mensuales de la landing (mensajes, mejoras de foto, descripciones) son coherentes con §17.
7. **Créditos (§14.6, §18).** La landing dice «valor según la cantidad: te lo confirmamos antes de cargarlos». Los paquetes propuestos no están habilitados y la página de servicios los muestra como «Aún no disponible».
8. **Límite de productos del plan básico.** Ya documentado en `docs/LANDING_PLANES_Y_PRECIOS.md`: la landing anuncia 150 productos en Emprendedor y el backend tiene 100 en `basico`. La §7 remite a la ficha comercial vigente.

## Recordatorios de renovación de dominio: propuesta (no implementada)

No se programó ningún envío ni cobro. La tabla `store_domains` hoy solo guarda dominio, tienda y estado; para recordatorios hace falta:

- Agregar a `store_domains` columnas `registrar`, `owner_name`, `expires_at`, `renewal_price` (por defecto 120000), `included_until` (si un plan lo cubre) y `auto_reminders` (0 por defecto).
- Agregar una tabla `domain_reminders` (dominio, días antes: 30/15/7, fecha programada, enviada, plantilla), con índice único para no duplicar avisos.
- Una tarea diaria que **solo liste** en el panel de plataforma los dominios por vencer, y que envíe el correo (plantilla en el sistema de correo existente) únicamente con `auto_reminders = 1` y después de que el propietario lo apruebe.
- Ningún cobro automático: el aviso invita a pedir la renovación a ventas@.

## Publicar (cuando lo autorices)

```bash
cd apps/tiendaiaexpress-landing && npm run cf:deploy
```

Luego hacer merge de la rama en `main` y push, para que el repositorio coincida con producción.
