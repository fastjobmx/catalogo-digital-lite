# Landing TiendIA Exprés: planes, SEO, accesibilidad y tiendas reales

Fecha: 2026-11-11 · Rama `feat/landing-planes-seo` (sale de `main` = producción) · Proyecto `apps/tiendaiaexpress-landing`.
**Estado: implementado y verificado en local. Nada publicado.** MOSTRALO PUES!, el panel, la API, la base de datos, los bots y los comercios no se tocaron.

Clasificación usada: **Implementado** (código listo) · **Verificado** (probado) · **Pendiente de aprobación** (decisión del propietario) · **Bloqueado** (depende de algo que no existe).

---

## 1. Diagnóstico inicial

| Tema | Hallazgo | Decisión |
|---|---|---|
| Tecnología | React 19 + Vite 8 + Tailwind 4, GSAP y Three.js (carga diferida). Cloudflare Pages `tiendaiaexpress`, dominio `tiendiaexpres.com`. | Conservar. |
| Renderizado | Ya **prerenderizado**: `scripts/prerender.mjs` inyecta el HTML de React en `dist/index.html`. Todo el contenido (h1, secciones, precios, preguntas) está en el HTML inicial, sin depender de JavaScript. | No hace falta SSR ni migrar de framework. Se mantiene la generación estática. |
| SEO | Title, description, canonical, Open Graph, Twitter, favicon, sitemap, robots, `lang="es-CO"` correctos. `www` y `*.pages.dev` con `X-Robots-Tag: noindex`. SEO Lighthouse local 100. | Mejorar textos y datos estructurados. |
| App (`app.tiendiaexpres.com`) | `/admin/login` y `/prueba` envían `noindex`; robots bloquea `/api/`. Cada catálogo público tiene su title, description, imagen y canonical propios (MUY PARCERO, Luz Mágica, Imperio Nova, SneakerHub). | Correcto; no se tocó. Ver observación §4. |
| Accesibilidad | Base muy buena (Lighthouse 100, salto al contenido, menú con Escape, foco visible, reduced motion). Fallas: h2 oculto «Inicio» antes del h1; pestañas de la demo sin flechas de teclado; el botón de cerrar menú no formaba parte del ciclo de foco. | Corregido. |
| Planes | Tarjetas «Catálogo Lite / Catálogo IA / Soluciones a medida», sin precios; preguntas frecuentes con «Los planes están en definición». No había plan «Promocional» publicado ni en el código. | Reemplazado por Emprendedor / Negocio / Mayorista. |
| Funciones desactualizadas | La landing mostraba «Fichas con IA desde una foto» y «Mejoramiento fotográfico» como «En camino», pero están **en producción** (módulos IA 2026-11-05; Estudio fotográfico 2026-11-10). | Pasadas a disponibles. |
| Conservado intacto | Hero y animación de la historia, demostración de SneakerHub, «Cómo funciona», tarjetas interactivas, vista de plantillas, asistente de Telegram, prueba sin registro, beneficios, contacto, WhatsApp, navegación y animaciones. | — |

## 2. Cambios visuales (Implementado · Verificado)

Orden nuevo, pensado para entender rápido qué es, cómo funciona, quién lo usa, qué hace con las fotos, cuánto cuesta y cómo contratar:

Hero → Asistente → Características → Demo SneakerHub → **Tiendas reales** → **Estudio fotográfico** → Prueba sin registro → Beneficios → Tienda + asistente → **Planes y precios** → **Configuración inicial y complementos** → **Condiciones comerciales** → Preguntas → Contacto.

- Hero: «Ver una tienda real» (externo) pasa a **«Ver tiendas reales»** (baja a la sección), y se agrega **«Conocer planes»** junto a «Probalo gratis». Se mantienen «Quiero mi tienda», «Prueba gratis» e «Ingresar».
- Menú: «Demo» se reemplaza por **«Tiendas»** (la demo sigue en la página). Encabezado fijo existente, sin cambios.
- Mismos colores, tipografías, radios y componentes; voseo como el resto del sitio (el subtítulo sugerido se adaptó: «Explorá catálogos reales y descubrí cómo podría verse el tuyo»).
- Sin ventanas emergentes.

Capturas en `docs/capturas-landing-planes/` (escritorio 1440 px y móvil 390 px).

## 3. SEO (Implementado · Verificado)

- Title: `TiendIA Exprés | Tienda online y catálogo digital con pedidos por WhatsApp` (antes «Tienda IA Express | …»); description con el precio publicado más bajo («Planes desde $59.900 COP al mes, sin comisión por venta»); og/twitter alineados.
- JSON-LD generado desde `src/content/plans.ts` (`src/seo/StructuredData.tsx`), así los precios estructurados **siempre coinciden** con las tarjetas: `Organization` (con `contactPoint` de ventas), `WebSite`, `SoftwareApplication` con 6 `Offer` (mensual con mensualidad + pago inicial, y anual). Sin reseñas, estrellas, clientes ni datos fiscales. Se eliminó el bloque estático duplicado de `index.html`. `BreadcrumbList` no aplica (una sola página).
- Jerarquía: un solo h1 primero (la sección del hero se etiqueta con él), h2 por sección, h3/h4 dentro.
- Corrección técnica: `prerender.mjs` usaba `String.replace` con el HTML; con precios que contienen `$`, secuencias como `$'` o `$&` se habrían interpretado. Ahora usa una función.
- Sin cambios en canonical, robots, sitemap, cabeceras ni redirecciones (ya correctos). Sin contenido distinto para buscadores.

## 4. Accesibilidad (Implementado · Verificado)

- Selector mensual/anual con **radios nativos** dentro de `fieldset`/`legend`, foco visible y anuncio `aria-live` discreto al cambiar.
- Pestañas de la demo: patrón ARIA completo (flechas, Inicio/Fin, `tabindex` itinerante).
- Menú móvil: el botón «Cerrar menú» entra en el ciclo de foco (antes Shift+Tab podía escapar del diálogo).
- Encabezados corregidos (§3); formularios con etiqueta asociada para «Plan de interés» y la nueva «Modalidad de pago».
- Pruebas: **axe-core** (`@axe-core/playwright`, etiquetas WCAG 2.0/2.1/2.2 A y AA) sobre la página completa y sobre los precios anuales con movimiento reducido: **0 infracciones**, escritorio y móvil. Pruebas de teclado automatizadas (selector, pestañas, preguntas, menú).

Observación fuera del alcance (no se tocó la app): `app.tiendiaexpres.com/` y `/t/sneakerhub-premium` muestran la misma tienda y cada una se declara canónica: contenido duplicado. Recomendación para una próxima entrega del panel: canonical de `/` hacia `/t/sneakerhub-premium` (o redirección).

## 5. Tiendas reales (Implementado · Verificado)

Auditoría de solo lectura en producción (2026-11-11):

| Tienda | Estado | Productos | Plantilla | URL pública | ¿En la landing? |
|---|---|---|---|---|---|
| SneakerHub Premium | activa | 21 | personalizada | `/t/sneakerhub-premium` | **Sí** (piloto propia) |
| MUY PARCERO | activa | 24 | personalizada | `/t/muy-parcero` | **Sí** (autorización confirmada el 2026-11-11) |
| Luz Mágica | activa | 115 | boutique | `/t/luz-magica` | **Sí** (autorización confirmada el 2026-11-11) |
| Imperio Nova | activa | 6 | premium | `/t/imperio-nova` | No: la portada aún no tiene imagen |
| DistribuMax | activa | 0 | editorial | — | No: sin productos |
| Prueba TiendIA Exprés | borrador | 0 | — | — | No: interna |

Gestión editorial (no existía un servicio; se eligió una configuración simple y segura sin tocar la API): `src/content/stores.ts`. Por tienda: autorizada sí/no y quién la autorizó, orden, texto, categoría, plantilla e imagen. Una tienda aparece **solo si está autorizada y su captura está en `src/assets/stores/`**; las capturas de tiendas no autorizadas quedan fuera de `src/` (en `scripts/.stores/`, ignorado por git), así que ni siquiera se publican como archivos sueltos. MUY PARCERO y Luz Mágica se agregaron tras confirmarse su autorización (2026-11-11); con tres tiendas, la invitación «Tu negocio puede ser el próximo» pasa a una franja de ancho completo. Incluir una tienda en la landing **no cambia su estado, plan ni datos** y no muestra ventas, personas ni cifras privadas. Procedimiento en el encabezado de `stores.ts`.

SneakerHub conserva su demostración interactiva; la tarjeta reutiliza su captura de catálogo (la demo usa inicio, producto y carrito), sin capturas nuevas duplicadas.

## 6. Tabla de precios y comparador (Implementado · Verificado)

| Plan | Pago inicial | Mensualidad | Primer año mensual | Anual (sin pago inicial) | Ahorro anual |
|---|---|---|---|---|---|
| Emprendedor | $149.000 COP | $59.900 COP | $867.800 COP | $599.000 COP | $268.800 COP |
| Negocio | $199.000 COP | $99.900 COP | $1.397.800 COP | $999.000 COP | $398.800 COP |
| Mayorista | $299.000 COP | $169.900 COP | $2.337.800 COP | $1.699.000 COP | $638.800 COP |

- Fuente única: `src/content/plans.ts` (tarjetas, comparador, WhatsApp, formulario, preguntas frecuentes y JSON-LD). Formato colombiano sin depender del idioma del navegador.
- El ahorro compara el **mismo periodo** (primer año de 12 meses mensual vs. anual).
- Mensual muestra mensualidad, pago inicial y total del primer año; anual muestra precio anual, «sin pago inicial adicional» y ahorro. Ambas modalidades quedan además en el HTML inicial.
- Negocio destacado visualmente, **sin** «Más vendido» ni similares.
- «Quiero este plan» abre WhatsApp con plan y modalidad: *«Hola, quiero el plan Negocio de TiendIA Exprés con pago anual ($999.000 COP al año, sin pago inicial adicional).»* «Solicitar con el formulario» completa plan y modalidad en el formulario de contacto. No se procesan pagos.
- No se muestra el plan Promocional ni textos de promoción; no existía en el código ni en la base (tabla `plans`: básico, profesional, premium, legacy).

## 7. Estado real de cada característica ofrecida

| Característica | Estado en el código | Cómo se muestra |
|---|---|---|
| Catálogo responsive, 13 plantillas | En producción | Disponible |
| Dirección del negocio | Ruta `app.tiendiaexpres.com/t/<slug>`; **no hay subdominios** | «Dirección propia: app.tiendiaexpres.com/t/tu-negocio» |
| Productos, categorías, tallas y variantes, carrito, pedidos por WhatsApp, panel | En producción | Disponible |
| Asistente de Telegram | En producción, limitado por presupuesto IA mensual en US$ por tienda | Disponible (cuotas: ver §9) |
| Guías de envío desde Telegram | En producción (`leer_guia_envio`, 0 créditos) | Disponible (Negocio) |
| Pedidos con estados, transportadora y guía | En producción | Disponible |
| Fichas de producto desde una foto | En producción (`foto_a_producto`, 1 crédito) | Disponible |
| Importación Excel/CSV/PDF | En producción (PDF con IA: `importar_pdf_pagina`, 4 créditos) | Disponible |
| Herramientas básicas de foto: recorte, encuadre, redimensionar, uniformidad en lote, luz, WebP/JPG | En producción, en el navegador, sin IA | Disponible |
| Formatos para redes (1:1, 4:5, 9:16), carruseles y videos cortos automáticos | En producción desde 2026-11-11 (fábrica de creativos, modo convencional, sin IA ni costo) | Disponible (actualizado el 2026-11-11) |
| Marca de agua, fondos prediseñados | No existen | **Próximamente** |
| Packshots, escenarios realistas, calzado en escena | En producción (`foto_packshot` 3, `foto_premium` 5 créditos) | Disponible |
| Modelos virtuales, variantes de color, video con IA | No publicados (modelo virtual descartado por fidelidad; video con IA apagado: sin `GEMINI_VIDEO_MODEL` ni precio de `video_ia_segundo`) | **Próximamente** |
| Varios administradores con roles | En producción (owner, admin, operator, seller, inventory) | Disponible (Mayorista) |
| Soporte prioritario | Servicio comercial, no software | Disponible (Mayorista) · **Pendiente de aprobación** del alcance |
| Reportes comerciales | Solo indicadores básicos del panel | **Próximamente** |
| Precios al por mayor | No existe | **Próximamente** |
| Dominio propio | La API resuelve tiendas por dominio, pero ningún dominio está activo y el Worker del panel no recibe dominios de clientes (falta Cloudflare for SaaS o equivalente) | Complemento «Bajo consulta» · **Bloqueado** técnicamente |
| Créditos IA adicionales | En producción (solicitud desde el panel, aprobación del superadministrador) | Disponible, sin precio |
| Estudio de contenido | Fábrica de creativos en producción (modo convencional); probada en Chromium de escritorio, no en celular, Safari ni Firefox | Disponible, incluido en todos los planes |
| Cobro en línea | No existe | Se dice claramente que no |

Nota de fidelidad publicada: la foto real es la referencia; la IA trabaja con reglas que le impiden inventar suelas, costuras o partes no visibles, puede equivocarse y cada resultado se compara y aprueba. No se menciona rembg, Real-ESRGAN, Remotion ni VPS, ni costos internos.

## 8. Cambios en preguntas frecuentes (Implementado · Verificado)

Se eliminó «Los planes están en definición». Nuevas (respuestas con cifras tomadas de `plans.ts`): ¿Cuánto cuesta crear mi tienda? · ¿Qué incluye el pago inicial? · ¿Diferencia entre mensual y anual? · ¿Puedo utilizar WhatsApp? · ¿Cómo funciona Telegram? · ¿Cuántos productos puedo publicar? · ¿Qué ocurre cuando se agotan los créditos IA? · ¿Puedo tener dominio propio? · ¿Hay comisión por venta? · ¿Cómo puedo cambiar de plan? · ¿Puedo importar desde Excel o PDF? · ¿Qué funciones de IA están disponibles hoy? Se conservan: cobro en línea, saber de tecnología, varias tiendas.

## 9. Diferencias entre los planes propuestos y el backend (**Pendiente de aprobación** antes de publicar)

La landing **no** cambia límites, créditos ni permisos. Hoy el backend tiene:

| Plan (código) | max_products | Presupuesto IA/mes | Precios en BD | Tiendas |
|---|---|---|---|---|
| Básico (`basico`) | 100 | US$1,00 | 0 | Prueba interna |
| Profesional (`profesional`) | 500 | US$3,00 | 0 | Luz Mágica |
| Premium (`premium`) | 2.000 | US$8,00 | 0 | DistribuMax, MUY PARCERO, Imperio Nova |
| Instalación existente (`legacy`) | 2.000 | US$5,00 | 0 | SneakerHub |

Diferencias a resolver:

1. **No existen los planes Emprendedor, Negocio y Mayorista** en la tabla `plans`. Propuesta: crearlos (o renombrar) con `max_products` 150 / 500 / 2.000 y precios `setup_price`/`monthly_price` cargados; decidir a qué plan pasa cada tienda actual.
2. **Productos:** Emprendedor 150 vs. Básico 100.
3. **Cuotas IA mensuales** (500 mensajes Telegram, 50/150/400 mejoras de foto, 200 descripciones): el backend no cuenta cuotas por tipo; usa un presupuesto mensual en US$ por tienda y un saldo de créditos que **solo se recarga a mano** (ninguna asignación automática mensual). Hay que decidir: asignar créditos mensuales por plan (p. ej. 50 mejoras × 3 créditos = 150 créditos para packshots) y quién los carga, o implementar recarga mensual automática. Hoy, publicar estas cuotas sin cargarlas sería prometer algo que la tienda no recibe.
4. **«Uso razonable»** (descripciones en Negocio y Mayorista, Telegram ampliado): definir el tope técnico (presupuesto US$ por plan) y el control antiabuso. No se publicó «ilimitado».
5. **Mayorista 2.000 productos:** coincide con Premium; «ampliable» queda a conversación.
6. **Telegram en Emprendedor:** el plan Básico no lista `asistente_ia` en `features_json` (es informativo; el límite real es el presupuesto US$1,00, que puede no alcanzar 500 mensajes). Revisar el presupuesto del plan.
7. **Dominio propio:** bloqueado técnicamente (§7); precio propuesto Emprendedor $99.000 COP/año publicado como «Bajo consulta» para los demás.
8. **Subdominio:** no existe; se publicó la dirección real `/t/tu-negocio`.

## 10. Condiciones comerciales pendientes de aprobación

Publicadas como **resumen** con «los términos completos se entregan por escrito al contratar». Antes de publicar, el propietario debe aprobar (y, donde aplique, revisar con asesoría jurídica):

- **IVA:** no se afirma «IVA incluido» ni «más IVA». Texto publicado: «Antes de cualquier pago te confirmamos por escrito el valor final, incluidos los impuestos que apliquen». Confirmar el tratamiento de IVA de los servicios y ajustar los precios o el texto (Estatuto del Consumidor, Ley 1480 de 2011: el precio informado debe incluir impuestos).
- Cancelación: «la tienda sigue activa hasta el final del periodo pagado» (no se dice nada de reembolsos; definir política y derecho de retracto si aplica a ventas a distancia).
- Renovación sin cobros automáticos; aviso previo.
- Suspensión por falta de pago con aviso previo; reactivación al ponerse al día.
- Conservación de datos durante la pausa; plazo después de cancelar «se informa al contratar» (definir plazo).
- Cuotas IA mensuales; qué pasa con el saldo no usado (no se afirma acumulación ni pérdida).
- Dominio: titularidad, renovación, transferencia y cancelación «se acuerdan por escrito».
- Fotos y productos son del comercio, también las mejoradas con IA (revisar con asesoría).
- Sin comisión por venta (cierto: la plataforma no procesa pagos).
- Cambios de plan con valor confirmado antes; cambios de precio con aviso y sin afectar el periodo pagado (definir días de anticipación).
- Configuración inicial: **cantidad de productos incluida en la carga inicial** por plan (publicado: «se acuerda al contratar»).
- Alcance de «soporte prioritario».
- Conservar el respaldo de la autorización de MUY PARCERO y Luz Mágica (confirmada en el chat el 2026-11-11).
- Páginas legales completas (Términos y Política de privacidad siguen sin URL; el pie enlaza «Condiciones comerciales»).

## 11. Pruebas ejecutadas

| Prueba | Resultado |
|---|---|
| `npm run test:unit` (precios, primer año, ahorro, formato, mensajes, sin promocional, sin «ilimitado») | 7/7 ✔ |
| `npx playwright test site commercial` (escritorio 1440 y móvil 390, build oficial servido con `scripts/serve.mjs`) | 41 ✔, 1 omitida (prueba solo móvil en escritorio) |
| axe WCAG 2.2 A/AA, página completa y precios anuales con movimiento reducido | 0 infracciones |
| Teclado: selector, pestañas, preguntas, menú móvil | ✔ |
| `tsc --noEmit` y build oficial | ✔ |

## 12. Lighthouse 13.6 (local, build oficial con compresión, Chrome 145 sin interfaz)

| | Rendimiento | Accesibilidad | Buenas prácticas | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| Móvil antes | 93 | 100 | 100 | 100 | 3,1 s | 0 | 100 ms |
| Móvil después (2 corridas) | 93 / 93 | 100 | 100 | 100 | 3,1 s | 0 | 110–120 ms |
| Escritorio antes | 99 | 100 | 100 | 100 | 0,8 s | 0 | 40 ms |
| Escritorio después | 99 | 100 | 100 | 100 | 0,7 s | 0 | 40 ms |

HTML inicial 144 → 189 KB sin comprimir (secciones nuevas, todo indexable); JS principal 98 → 105 KB gzip. Sin regresión medible. El LCP móvil simulado lo marca el logo del encabezado porque el texto del hero entra con la animación de apertura (retraso de render ≈ 0,3 s real, amplificado por la simulación). Mejorarlo exige cambiar esa animación existente: queda como recomendación, no se tocó. Imágenes nuevas con carga diferida y dimensiones fijas (CLS 0).

## 13. Archivos

Nuevos: `src/content/plans.ts`, `src/content/stores.ts`, `src/sections/Stores.tsx`, `src/sections/PhotoStudio.tsx`, `src/seo/StructuredData.tsx`, `tests/commercial.spec.ts`, `scripts/check-plans.mjs`, `scripts/snapshot-stores.mjs`, `scripts/optimize_stores.py`, `docs/LANDING_PLANES_Y_PRECIOS.md`, `docs/capturas-landing-planes/`.
Modificados: `index.html`, `src/App.tsx`, `src/content/copy.ts`, `src/config/site.ts`, `src/sections/Commerce.tsx`, `Contact.tsx`, `Nav.tsx`, `Showcase.tsx`, `Story.tsx`, `scripts/prerender.mjs`, `tests/site.spec.ts`, `package.json`, `package-lock.json` (`@axe-core/playwright` 4.10.2, solo desarrollo), `.gitignore`, `README.md`.

## 14. Procedimiento de publicación (solo con autorización)

1. Aprobar §9 y §10 (al menos IVA, cuotas IA y cómo se cargan, condiciones resumidas). Si se crean los planes en la base, hacerlo antes con respaldo, como las migraciones anteriores.
2. Tiendas de ejemplo: SneakerHub, MUY PARCERO y Luz Mágica ya están incluidas. Para sumar otra: `authorized: true` y `authorizedBy` en `src/content/stores.ts`, y su captura en `src/assets/stores/`.
3. Verificar:
   ```
   cd apps/tiendaiaexpress-landing
   npm run test:unit
   npm run build:official
   node scripts/serve.mjs            # otra terminal
   VITE_APP_URL=https://app.tiendiaexpres.com npx playwright test site commercial
   ```
4. Publicar: `npm run cf:deploy` (solo el proyecto Pages `tiendaiaexpress`; no toca MOSTRALO PUES!, el panel ni la API).
5. Comprobar en vivo: `https://tiendiaexpres.com/` (title, precios, JSON-LD con la Prueba de resultados enriquecidos de Google), Lighthouse en vivo y solicitar reindexación en Search Console.
6. Reversión: volver a publicar el despliegue anterior desde el panel de Cloudflare Pages (Deployments → Rollback) o `git revert` y `npm run cf:deploy`.

## 15. Publicación en producción (2026-11-11, autorizada por el propietario)

- Cloudflare Pages `tiendaiaexpress`, despliegue **`a5172382`** (anterior `a955b85a`, bundle `index-GB1Ln_sy.js` → `index-BVW3Cxt5.js`). Solo se publicó la landing: panel, API, base de datos, bots y MOSTRALO PUES! sin cambios. **Los límites y créditos del backend no se modificaron**: las diferencias de §9 siguen abiertas.
- Verificación en vivo `https://tiendiaexpres.com/`: title nuevo, `index, follow`, canonical, sitemap con `lastmod` 2026-11-11, 6 `Offer` en JSON-LD, tres planes, tiendas (SneakerHub, MUY PARCERO, Luz Mágica), estudio y condiciones presentes; sin «Catálogo Lite» ni «en definición»; `www` sigue con `noindex`.
- Pruebas e2e contra producción (`BASE_URL=https://tiendiaexpres.com`): 39 ✔; las 2 que fallan son el aviso de consola descrito abajo.
- Lighthouse en vivo (`tests/lighthouse/live-*.report.html`): móvil 93 / 100 / 92 / 100 (LCP 3,0 s, CLS 0); escritorio 98 / 100 / 92 / 100 (LCP 0,7 s, CLS 0).
- **Observación previa a este cambio:** el dominio tiene activo Cloudflare Web Analytics, que inyecta `static.cloudflareinsights.com/beacon.min.js`; la CSP del sitio (igual que antes) lo bloquea. Resultado: un error en consola, «buenas prácticas» 92 y ninguna métrica de Web Analytics. Decidir: permitirlo en la CSP (`script-src https://static.cloudflareinsights.com`, `connect-src https://cloudflareinsights.com`) o desactivar la inyección automática en el panel de Cloudflare.
- Reversión: Cloudflare Pages → `tiendaiaexpress` → Deployments → `a955b85a` → Rollback.
- Integración: rama `feat/landing-planes-seo` unida a `main` (sin conflictos con la fase 3 del Estudio). Al compilar desde `main` se detectó que Tailwind también escaneaba `tests/lighthouse/*.report.html` (que contienen el HTML de la página) y agregaba utilidades sin uso: el CSS dependía de los reportes. Se excluyeron `tests`, `scripts` y `dist` del escaneo y se republicó el mismo contenido como despliegue **`5fe82dc2`** (sin cambio visual; 41 pruebas locales ✔). Producción sirve `index-DWsapy-r.js` e `index-DQ2xpxNP.css`, idénticos al build de `main`.
- Actualización de estados (2026-11-11, autorizada): formatos para redes, carruseles y videos cortos automáticos de la fábrica de creativos (fase 3, modo convencional en producción) pasan a disponibles; el video con IA queda «Próximamente» (apagado en producción). Despliegue **`2f4641be`** (antes `5fe82dc2`), commit `de7d3fa`; producción sirve `index-hzwNdo9l.js` e `index-DQ2xpxNP.css`, iguales al build de `main`. Pruebas contra producción: 39 ✔, 2 fallan solo por el beacon de Cloudflare Web Analytics bloqueado por la CSP (previo).
