# Servicios adicionales premium: entrega (2026-11-14)

Rama `feat/servicios-premium`, solo commit local: **sin push, merge ni despliegue**.

## Qué cambió

- `/servicios-adicionales` rediseñada a partir del prototipo `TiendIA_Expres_Servicios_Adicionales_Premium.zip`, con los componentes y colores de la landing (no es una imagen):
  - hero con la mascota y piezas reales del Estudio Creativo;
  - 6 áreas de trabajo, cada una lleva al catálogo ya filtrado;
  - 3 paquetes con precio «por separado» y ahorro;
  - catálogo de 50 servicios contratables con búsqueda y filtros por categoría;
  - bloque «Próximamente» con 4 servicios no contratables;
  - dominio propio (renovación confirmada, titularidad, DNS, avisos, transferencia);
  - proceso de contratación, 10 preguntas frecuentes y cierre con ventas@ y soporte@.
- Las fotos de stock del ZIP (moda, lifestyle) **no se usaron**: su licencia no es clara y la landing ya tiene imágenes propias.
- **Catálogo central**: `src/content/addons.ts`. Ahí se editan precio, descripción, alcance, periodicidad, estado (`propuesto` / `confirmado`) y disponibilidad (`available: false`) sin tocar la página.
- **Precios de lanzamiento**: todo más económico. La suma de la lista baja de $31.108.000 a $14.302.000 (−54 %). Los paquetes bajan de $799.000 / $1.690.000 / $2.390.000 a $390.000 / $749.000 / $949.000.
- **Sin duplicar el plan**: 12 servicios llevan una nota que explica qué incluye ya el plan, para no cobrar dos veces lo mismo. Son: tienda a medida, SEO básico, asistente IA, piezas, fotos, personalización, carga asistida y capacitación.
- **No contratables**: integración oficial de WhatsApp Business y los 3 paquetes de créditos artísticos aparecen como «Próximamente», sin botón de cotizar.
- **Sin cobros**: cada botón abre un correo a ventas@tiendiaexpres.com. No hay checkout, pagos, formularios ni cobros recurrentes.
- `src/legal/services.ts` (catálogo anterior) se eliminó.

## Pruebas

`npx playwright test`: 69 aprobadas y 1 omitida (ya estaba omitida), en escritorio y móvil. Cubren:

- HTML prerenderizado, un solo `h1`, cero errores de consola y axe WCAG 2.2 A/AA sin violaciones;
- sin desborde horizontal;
- 50 servicios y 4 «Próximamente» sin enlace;
- un único precio confirmado;
- todos los enlaces de cotización a ventas@, y ningún formulario ni pago;
- búsqueda y filtros;
- notas de «ya incluido en tu plan»;
- footer y canonical.

Capturas en `docs/capturas-legal/servicios-adicionales--*` (390, 820 y 1440 px).

## Antes de publicar: decisiones pendientes

1. **Aprobar los precios.** Todos salvo la renovación siguen como «Precio propuesto».
2. **Términos v1.1 desactualizados.** Las tablas de las §13 y §14 (publicadas) muestran los precios propuestos anteriores (SEO $149.000/$349.000/$249.000, carga asistida, diseño, correo, créditos). La página nueva muestra precios más bajos. Hay que actualizar esas tablas o publicar una versión 1.2.
3. **Registro de dominio.** Ahora se propone a $99.000 el primer año (igual que la tarjeta de la página principal), y la renovación sigue en $120.000 confirmada. Los términos §10.2 dicen $120.000 propuesto.
4. **Impuestos.** Los precios se muestran sin impuestos; la cotización debe informar IVA u otros cargos.
5. **Vigencia de las cotizaciones.** No está definida.
6. **Capacidad para atender.** Desarrollo web, marketing, automatizaciones y redes son servicios hechos por personas: confirma que hay equipo para entregarlos antes de anunciarlos.
7. **Horario exacto y datos legales.** Siguen pendientes razón social, NIT, domicilio y días y horas de atención.

## Precios: prototipo → propuesta de lanzamiento

| # | Servicio | Prototipo | Nuevo | Periodicidad | Estado |
|---:|---|---:|---:|---|---|
| 1 | Landing page profesional | $690.000 | $290.000 | unico | Propuesto |
| 2 | Sitio web corporativo | $1.490.000 | $590.000 | unico | Propuesto |
| 3 | Web corporativa Plus | $2.490.000 | $990.000 | unico | Propuesto |
| 4 | Tienda online a medida | $2.900.000 | desde $1.290.000 | proyecto | Propuesto |
| 5 | Aplicación web personalizada | $4.900.000 | desde $1.990.000 | proyecto | Propuesto |
| 6 | Rediseño de sitio web | $690.000 | desde $290.000 | proyecto | Propuesto |
| 7 | Mantenimiento web esencial | $129.000 | $59.000 | mensual | Propuesto |
| 8 | Mantenimiento web avanzado | $299.000 | $129.000 | mensual | Propuesto |
| 9 | Registro de dominio estándar | $120.000 | $99.000 | anual | Propuesto |
| 10 | Renovación de dominio estándar | $120.000 | $120.000 | anual | Confirmado |
| 11 | Conexión de dominio existente | $49.000 | $29.000 | unico | Propuesto |
| 12 | Migración y ajustes de DNS | $99.000 | desde $49.000 | unico | Propuesto |
| 13 | Configuración de correo corporativo | $39.000 | $19.000 | cuenta | Propuesto |
| 14 | SEO básico asistido | $149.000 | $79.000 | unico | Propuesto |
| 15 | SEO avanzado: inicio | $349.000 | $179.000 | unico | Propuesto |
| 16 | SEO avanzado: seguimiento | $249.000 | $129.000 | mensual | Propuesto |
| 17 | SEO local para negocios | $199.000 | $89.000 | unico | Propuesto |
| 18 | Auditoría SEO independiente | $249.000 | $119.000 | unico | Propuesto |
| 19 | Artículo optimizado para buscadores | $80.000 | $39.000 | articulo | Propuesto |
| 20 | Diagnóstico y estrategia digital | $290.000 | $129.000 | unico | Propuesto |
| 21 | Redes sociales Esencial | $590.000 | $290.000 | mensual | Propuesto |
| 22 | Redes sociales Crecimiento | $990.000 | $490.000 | mensual | Propuesto |
| 23 | Redes sociales Integral | $1.490.000 | $790.000 | mensual | Propuesto |
| 24 | Configuración de Meta Ads | $249.000 | $119.000 | unico | Propuesto |
| 25 | Gestión de Meta Ads | $490.000 | $249.000 | mensual | Propuesto |
| 26 | Configuración de Google Ads | $299.000 | $149.000 | unico | Propuesto |
| 27 | Gestión de Google Ads | $590.000 | $290.000 | mensual | Propuesto |
| 28 | Campaña de email marketing | $190.000 | $89.000 | campana | Propuesto |
| 29 | Gestión mensual de email marketing | $590.000 | $290.000 | mensual | Propuesto |
| 30 | Formulario conectado a CRM | $390.000 | $179.000 | unico | Propuesto |
| 31 | Seguimiento automático de prospectos | $490.000 | $229.000 | unico | Propuesto |
| 32 | Recordatorios y estados comerciales | $690.000 | desde $319.000 | unico | Propuesto |
| 33 | Paquete de tres automatizaciones | $890.000 | $419.000 | unico | Propuesto |
| 34 | Automatización avanzada | $1.290.000 | desde $590.000 | proyecto | Propuesto |
| 35 | Asistente IA a medida | $1.890.000 | desde $890.000 | proyecto | Propuesto |
| 36 | Panel de indicadores comerciales | $790.000 | desde $390.000 | proyecto | Propuesto |
| 37 | Mantenimiento de automatizaciones | $149.000 | $69.000 | mensual | Propuesto |
| 38 | Integración WhatsApp Business oficial | $790.000 | desde $390.000 | proyecto | Próximamente |
| 39 | Diseño de pieza publicitaria | $35.000 | $19.000 | pieza | Propuesto |
| 40 | Paquete de cinco piezas gráficas | $149.000 | $79.000 | paquete | Propuesto |
| 41 | Edición de reel comercial | $110.000 | $49.000 | video | Propuesto |
| 42 | Paquete de cuatro reels | $390.000 | $179.000 | paquete | Propuesto |
| 43 | Edición de fotografía de producto | $18.000 | $8.000 | foto | Propuesto |
| 44 | Pack de diez fotografías editadas | $150.000 | $69.000 | paquete | Propuesto |
| 45 | Diseño de logotipo | $299.000 | $149.000 | unico | Propuesto |
| 46 | Identidad visual de marca | $749.000 | $349.000 | unico | Propuesto |
| 47 | Personalización avanzada de tienda | $129.000 | $69.000 | proyecto | Propuesto |
| 48 | Carga asistida de 50 productos | $49.000 | $29.000 | lote | Propuesto |
| 49 | Carga asistida de 100 productos | $89.000 | $49.000 | lote | Propuesto |
| 50 | Carga asistida de 500 productos | $349.000 | $199.000 | lote | Propuesto |
| 51 | Capacitación personalizada | $60.000 | $35.000 | hora | Propuesto |
| 52 | 100 créditos artísticos | $12.000 | $9.000 | recarga | Próximamente |
| 53 | 300 créditos artísticos | $30.000 | $24.000 | recarga | Próximamente |
| 54 | 700 créditos artísticos | $63.000 | $49.000 | recarga | Próximamente |
