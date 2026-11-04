# MOSTRALO PUES! — Fase A: auditoría y propuesta creativa

Fecha: 2026-11-04. Estado: **propuesta, pendiente de aprobación**. En esta fase no se creó ningún proyecto, Worker ni recurso. Tampoco se modificó la plataforma actual.

## 1. Auditoría

### Plataforma actual (no se toca)

| Pieza | Estado comprobado |
|---|---|
| Frontend | Worker `catalogo-digital-ia` (Static Assets + service binding `API`), `frontend/wrangler.jsonc` |
| Backend | Worker `catalogo-lite-api` (`worker/wrangler.production.toml`), D1, R2, 3 bots |
| Tienda en la raíz | `https://catalogo-digital-ia.catalogo-lite-worker.workers.dev/` → **SneakerHub Premium** (200) |
| Acceso al panel | `/admin/login` (200). El inicio de sesión no depende de la tienda: devuelve las tiendas de la cuenta, así que sirve para cualquier propietario. Se verificará en el navegador en la fase B. |
| Alta de tiendas | **No hay registro automático.** Las tiendas se crean desde el bot maestro. El CTA "Quiero mi tienda" debe llevar a un contacto humano. |

### Nombre y URL del Worker nuevo

- `wrangler deployments list --name mostralopues` → *"This Worker does not exist on your account"*. **El nombre está libre.**
- URL esperada: `https://mostralopues.catalogo-lite-worker.workers.dev`

### Entorno

- Node 26.8.1, npm 11.19.0, Wrangler 4.156.0 (el de `worker/`), Python 3 + Pillow para revisar imágenes.
- `netlify.toml` tiene `ignore = "exit 0"`: un push no dispara builds en Netlify.
- El frontend se publica a mano con Wrangler, no hay builds automáticos de Cloudflare. Un directorio nuevo en el repo no publica nada por sí solo.

### Ubicación: mismo repositorio, directorio independiente

Recomiendo `apps/mostralopues-landing/` dentro de `catalogo-lite`, con su propio `package.json`, `node_modules`, `wrangler.jsonc` y build.

- **Ventaja 1:** no hace falta crear un repositorio nuevo en GitHub, que sería un cambio externo.
- **Ventaja 2:** la documentación queda junto a la plataforma que describe.
- **Ventaja 3:** puede leer en build las capturas y productos públicos de SneakerHub sin compartir código.
- **Sin imports cruzados:** la landing no importa nada de `frontend/` ni de `worker/`, y viceversa.
- **Cuándo separarla:** si en el futuro la mantiene otro equipo, se mueve a su propio repo copiando la carpeta.

## 2. Skills y herramientas

| Skill / herramienta | Estado | Uso |
|---|---|---|
| `ui-ux-pro-max` (instalada) | Ejecutada | Ver nota abajo. |
| `frontend-design` oficial de Anthropic | **No está instalada en esta sesión** | No se usó. Se puede instalar si la quieres. |
| Skill de Three.js / R3F | No instalada | Se usará la documentación oficial de las bibliotecas. |
| Skill de GSAP | No instalada | `ui-ux-pro-max` trae 17 presets GSAP; se consultaron los de scroll. |
| `awwwards-3d` (tsogjavklann, MIT) | **No instalada** | Es una skill externa de Claude Code: Three r170 + GSAP + Lenis. No la instalé sin revisar su repositorio; puedo auditarla si la quieres. |
| Navegador integrado | Usado | Revisión de las 6 referencias; luego capturas y pruebas responsive. |
| Playwright | No está en el proyecto | Se agregaría solo como dependencia de desarrollo de la landing para capturas y pruebas. |

**Nota sobre `ui-ux-pro-max`:**

- Su sistema de diseño automático sugirió una paleta índigo y estilo brutalista. **Lo descarté porque contradice la marca.**
- Sí tomé de ella: la lista de verificación previa a la entrega (contraste 4.5:1, foco visible, objetivos de 44 px, `prefers-reduced-motion`), las reglas de pinning de GSAP (máximo 1–2 secciones fijadas, `scrub` 0.5–1.5, `refresh` tras cargar fuentes) y la familia Space Grotesk.

## 3. Activos de marca

Los cuatro archivos **no estaban en `assets/brand/`**. Los encontré en `C:\Users\Walter Losada\Downloads\`. En la fase B se copian sin modificar a `apps/mostralopues-landing/src/assets/brand/`.

| Archivo | Tamaño | Contenido |
|---|---|---|
| `Logo moderno Mostralo Pues!.png` | 1672×941 | **Logo principal:** isotipo burbuja‑tienda‑carrito con "MOSTRALO" verde oscuro y "PUES!" naranja |
| `¡Muéstralo pues!.png` | 1672×941 | Variante tipográfica con "PUES" lima y burbuja de chat |
| `Icono de chat, tienda y crecimiento.png` | 1254×1254 | Isotipo solo (avatar/favicon) |
| `Identidad visual de Mostralo Pues.png` | 1672×941 | Tablero de identidad (mockups, paleta, tarjetas) |

### Hallazgos que necesitan decisión

1. **Los logos no tienen transparencia.** Son PNG RGB sobre blanco `#FEFEFE`. Sobre verde oscuro o marfil (`#F7F8F3`) se vería un recuadro blanco. Hay tres opciones:
   - **a)** Me envías los originales con fondo transparente (PNG o SVG). Es lo recomendado.
   - **b)** Me autorizas a generar una copia derivada que solo vuelve transparente el blanco del fondo. No toca formas, colores ni proporciones del logo; el original queda intacto.
   - **c)** Uso los logos solo sobre superficies blancas, por ejemplo una "placa" blanca en la barra de navegación.
2. **El tablero muestra un logo distinto:** carrito con líneas de velocidad y "PUES!" lima. Ese logo **no viene como archivo**: recortarlo del tablero daría baja resolución, así que no lo usaré. Uso "Logo moderno" como principal, "¡Muéstralo pues!" como secundario y el icono como favicon/avatar.
3. **El tablero tiene una persona, productos ("Tenis Deportivos $149.900") y un QR generados.** No los usaré como contenido real.
4. **`00_avatar_MP_1080.png` y `05_isotipo_MP_color.*` son de MUY PARCERO**, no de MOSTRALO PUES!. Quedan excluidos.

### Colores medidos en los archivos

Diferencias con la paleta del tablero:

| Rol | Tablero | **Logo moderno** (medido) | ¡Muéstralo pues! | Icono |
|---|---|---|---|---|
| Verde oscuro | `#182D26` | **`#102F25`** | `#0B2E20` | `#0C2B1F` |
| Lima | `#C8F56A` | **`#C6F25B`** | `#C3F231` | — |
| Naranja | `#FF714B` | **`#FE7041`** | — | — |
| Marfil | `#F7F8F3` | (fondo blanco) | — | — |

Siguiendo tu regla ("usar los valores de los archivos"), los tokens se toman del logo principal:

```
--mp-forest  #102F25   tecnología y confianza (fondos oscuros, texto sobre claro)
--mp-lime    #C6F25B   energía (acentos, CTA principal sobre oscuro)
--mp-coral   #FE7041   acento expresivo (subrayados, detalles, titulares grandes sobre oscuro)
--mp-ivory   #F7F8F3   limpieza (fondos claros; único valor que viene del tablero)
```

Contraste medido (WCAG):

| Combinación | Ratio | Uso permitido |
|---|---|---|
| Lima sobre verde | 11.2 | AAA |
| Marfil sobre verde | 13.5 | AAA |
| Naranja sobre verde | 5.2 | AA, apto para texto |
| Verde sobre lima | 11.2 | Botón principal |
| **Naranja sobre marfil** | **2.6** | ❌ Nunca para texto; solo decoración |
| **Blanco sobre naranja** | **2.8** | ❌ No se usarán botones naranjas con texto blanco |

## 4. Lo que tomo de las referencias (principios, no código ni diseños)

| Referencia | Observación | Lo que adopto |
|---|---|---|
| Lusion | Escena 3D a sangre dentro de un "escenario" con márgenes; poca interfaz; precarga con contador (~6 s) | 3D enmarcado como objeto protagonista. **No** copio la precarga: el contenido se ve de inmediato. |
| Cuberto | Tipografía editorial enorme, mucho blanco, navegación en píldora, video en bloques redondeados | Escala tipográfica y contención |
| 14islands | Titular partido asimétrico ("Design / & / Technology") que se funde con partículas 3D | Composición asimétrica de titulares y diálogo entre texto y 3D |
| Active Theory | Todo WebGL, oscuro, cinematográfico | Atmósfera de luz sobre oscuro. **No** la navegación 100 % WebGL, que perjudica accesibilidad y SEO. |
| awwwards-3d | Patrón técnico: scroll suavizado (lerp) → cámara, postproceso | Interpolar el scroll hacia la escena. Postproceso mínimo y desactivado en móvil. |
| landing.love/gsap | Catálogo de sitios GSAP | Revelado por palabras, máximo 2 escenas fijadas |

## 5. Dirección creativa: "De una foto a un negocio en movimiento"

### Idea visual

El **teléfono** es el hilo conductor: aparece en el hero y la cámara lo acompaña durante toda la historia.

- **Escena A:** recibe una foto.
- **Escena B:** la organiza.
- **Escena C:** comparte la tienda.

La página alterna **noche** (verde bosque, tecnología) y **día** (marfil, comercio) para marcar el paso de "idea" a "venta". El **subrayado de trazo** del logo se reutiliza como gesto gráfico animado bajo palabras clave. Es un elemento de apoyo: no se recrea ni se modifica el logo.

### Tipografía

- **Space Grotesk** 500–700: titulares y botones.
- **Manrope** 400–700: textos.
- **Licencia:** ambas OFL, autoalojadas con `@fontsource` (sin llamadas a Google en producción).
- El logo siempre es la imagen original; nunca se rehace con fuentes.

### Voz

Voseo coherente con la marca: "mostrá, creá, vendés". Frases cortas, sin tecnicismos (no D1, Worker, JSON, tenant).

### Mapa de la página

| # | Sección | Fondo | Contenido y movimiento |
|---|---|---|---|
| 0 | Navegación | Translúcido | Logo, 7 enlaces, "Ingresar a mi tienda", CTA. Menú móvil a pantalla completa, accesible con teclado. |
| 1 | **Hero** | Verde | "SI NO LO **MOSTRÁS**, / NO LO **VENDÉS**." **MOSTRÁS** en lima, **VENDÉS** con subrayado naranja animado. Teléfono 3D con la **captura real de SneakerHub** y tarjetas flotantes con **productos reales** de la tienda (nombre y precio leídos de la API pública al compilar). Microíconos de foto, mensaje y venta. Inclinación sutil con el cursor. Entrada en ~1.6 s, sin bloquear: marca → título → teléfono → tarjetas → botones. |
| 2 | **Cómo funciona** (A·B·C) | Verde → marfil | Una sola escena fijada con avance por scroll (`scrub`). **A MOSTRÁ:** una foto se convierte en ficha. **B ORGANIZÁ:** el teléfono gira; las tarjetas pasan de flotar a ordenarse en categorías, variantes y precios. **C VENDÉ:** carrito, enlace compartido y burbuja de WhatsApp. Etiqueta "Demostración". |
| 3 | **Tu negocio tiene un nuevo asistente** | Verde | Chat de Telegram animado: mensaje → foto → "Preparé la ficha…" → confirmación → publicado. Línea de progreso de 5 pasos. Etiqueta visible "Demostración ilustrativa". |
| 4 | **Capacidades** (bento) | Marfil | Módulos de tamaños e interacciones distintas: el carrito suma, las variantes cambian de talla, la paleta cambia de colores. Disponibles y **Próximamente** se distinguen claramente. |
| 5 | **Una tienda real. Una experiencia real.** | Blanco | SneakerHub en un escaparate con capturas auténticas en móvil y escritorio. "Explorar tienda demo" abre en pestaña nueva. Sin cifras ni reseñas. |
| 6 | **Beneficios** | Verde | Tres titulares gigantes que se revelan por palabras, cada uno con una mini demostración concreta. |
| 7 | **Crear vs administrar con IA** | Marfil | Dos columnas claras: qué es tener la tienda y qué es manejarla desde Telegram. |
| 8 | **Planes** | Marfil | Catálogo Lite / Catálogo IA / Soluciones a medida. Sin precios ni promesas. Botones "Consultá nuestros planes" y "Solicitá tu tienda". Editable desde un archivo de contenido. |
| 9 | **Preguntas frecuentes** | Blanco | Acordeón accesible con respuestas verificadas (ver §6). |
| 10 | **Contacto** | Verde | Formulario de solicitud (ver §7). |
| 11 | **Footer** | Verde profundo | Logo, navegación, CTA, redes y enlaces legales configurables. |

### Móvil y movimiento reducido

- **Móvil (< 768 px) o equipos de gama baja** (`hardwareConcurrency ≤ 4`, `deviceMemory ≤ 4` o sin WebGL): se reemplaza el 3D por un teléfono en capas CSS con la misma captura. Las escenas A·B·C no quedan fijadas y avanzan con transformaciones ligeras.
- **`prefers-reduced-motion`:** todo aparece en su estado final, sin parallax ni scroll animado.
- **Teclado:** la navegación funciona sin depender de ninguna animación.

## 6. Qué es real, qué es demostración y qué es futuro

Basado en el código y en lo publicado hasta hoy (`docs/PENDIENTES.md`, `PLATAFORMA_COMERCIO_AUDITORIA.md`).

| Capacidad | Estado para la web |
|---|---|
| Catálogo responsive con 13 plantillas | ✅ Disponible |
| Productos y categorías | ✅ Disponible |
| Precios y variantes (tallas) | ✅ Disponible |
| Carrito de compras | ✅ Disponible |
| Pedido o consulta por WhatsApp | ✅ Disponible |
| Panel administrativo web | ✅ Disponible |
| Administración desde Telegram (asistente) | ✅ Disponible |
| Personalización (plantillas, paleta desde el logo) | ✅ Disponible |
| Varias tiendas con una sola cuenta de Telegram | ✅ Disponible |
| Pedidos con estados, inventario, cupones, equipo con roles | ✅ Disponible (detalle en FAQ / bento secundario) |
| **Ficha de producto a partir de una foto con IA** | ⚠️ **Programada, no verificada con Gemini real** (`PENDIENTES.md`). Se muestra como **demostración** hasta verificarla. |
| Mejoramiento fotográfico | 🔜 Próximamente |
| Estadísticas avanzadas | 🔜 Próximamente (hoy hay resúmenes básicos de ventas) |
| Asistente de ventas para clientes | 🔜 Próximamente |
| Promociones inteligentes | 🔜 Próximamente (hoy: cupones y campañas manuales con aprobación) |
| Pagos en línea | ❌ No disponible (se dirá en el FAQ) |
| Dominio propio | A medida, configuración manual |
| Registro automático | ❌ No existe: alta asistida por el equipo |

## 7. CTAs, contacto y formulario

| CTA | Destino |
|---|---|
| QUIERO MI TIENDA / Solicitá tu tienda | Formulario → WhatsApp **+57 350 6912734** |
| VER UNA TIENDA REAL / EXPLORAR TIENDA DEMO | `https://catalogo-digital-ia.catalogo-lite-worker.workers.dev/` (pestaña nueva, `rel="noopener"`) |
| INGRESAR A MI TIENDA | `https://catalogo-digital-ia.catalogo-lite-worker.workers.dev/admin/login` |
| Facebook / Instagram / TikTok | Las URL entregadas (se comprobará que respondan) |

**Formulario (versión 1, sin backend):**

- **Campos:** nombre, negocio, ciudad, qué vende y plan de interés.
- **Validación:** en el cliente, con errores junto a cada campo.
- **Antispam:** honeypot más tiempo mínimo de llenado.
- **Envío:** abre WhatsApp con el mensaje redactado (`wa.me/573506912734?text=…`).
- **Mensaje al usuario:** "Abrimos WhatsApp con tu mensaje; envialo para que te contactemos". **No** se simula un envío exitoso.
- **Datos:** no se guarda nada ni se envía a terceros.

**Opcional, más adelante:** endpoint propio en el Worker `mostralopues` con Cloudflare Turnstile y destino propio (correo o Telegram).

- No usará los secretos ni bots existentes.
- Requiere un bot o proveedor nuevo y tu aprobación.

Todos los datos de contacto y redes quedan en un archivo de configuración: `src/config/site.ts`.

## 8. Arquitectura técnica

```
apps/mostralopues-landing/
  package.json            # independiente
  vite.config.ts
  wrangler.jsonc          # name: "mostralopues"; solo assets; sin bindings
  public/
    _headers              # seguridad y caché
    robots.txt
    sitemap.xml           # se generan con la URL configurada
    og.png
  src/
    config/site.ts        # contacto, redes, URLs, flags de indexación
    content/*.ts          # textos, planes, FAQ, capacidades (editables)
    styles/tokens.css     # tokens de marca
    components/brand/Logo.tsx   # variantes aprobadas, proporción real
    sections/*            # Hero, Story, Assistant, Bento, Showcase, Benefits, Plans, FAQ, Contact, Footer
    three/*               # escena del teléfono (carga diferida)
    motion/*              # hooks GSAP, matchMedia, reduced-motion
  scripts/
    snapshot-sneakerhub.mjs   # capturas y productos públicos, solo lectura
  tests/                  # Playwright: anchos, enlaces, formulario, a11y
  README.md
```

**Stack:** se fijarán las versiones estables vigentes al instalar.

- React 19 + TypeScript + Vite
- Tailwind CSS 4
- GSAP 3 + ScrollTrigger (`@gsap/react`)
- Three.js + React Three Fiber + drei, en un chunk diferido
- Fuentes vía `@fontsource`
- **Sin Lenis:** el scroll nativo es más accesible y GSAP ya resuelve la suavidad con `scrub`.

**Teléfono 3D:**

- Se modela por código (cuerpo redondeado, bisel, cámara, reflejos) con la captura real como textura de pantalla.
- No requiere modelos de terceros, así que no hay riesgo de licencias.
- **Peso objetivo:** ≤ 250 KB gzip para el chunk 3D, ≤ 90 KB para el JS inicial.

**Worker `mostralopues`:**

```jsonc
{
  "name": "mostralopues",
  "compatibility_date": "2025-09-01",
  "workers_dev": true,
  "assets": { "directory": "./dist", "not_found_handling": "404-page" }
}
```

- No tiene `main`, bindings, secretos, D1, R2 ni KV.
- **Comandos:** `wrangler deploy --dry-run` para comprobar; el despliegue real, solo con tu autorización.

**SEO:**

- Contenido incluido en el HTML: títulos, descripción, Open Graph, `sitemap`, `robots`.
- Las URL salen de `SITE_URL` en la configuración.
- **Recomendación:** mientras la web viva en `*.workers.dev` provisional, `noindex` y canonical a esa URL. Al tener dominio, se cambia una línea y se reconstruye.

## 9. Plan y límites

- **Fase B — Construcción**
  - Crear `apps/mostralopues-landing/` y copiar los activos.
  - Tokens, componentes, secciones, 3D y animaciones.
  - Snapshot de SneakerHub de solo lectura.
- **Fase C — Refinamiento**
  - Servidor local y capturas a 360, 390, 768, 1024, 1440 y 1920 px.
  - Correcciones.
  - Lighthouse medido (sin afirmar cifras no medidas).
  - Pruebas de enlaces, formulario, teclado y contraste.
- **Fase D — Prepublicación**
  - `build`, `wrangler deploy --dry-run` y README.
  - Informe: nombre del Worker, URL, archivos, aislamiento, pruebas, CTAs, pendientes y riesgos.
  - **Sin desplegar hasta que lo autorices.**

**Archivos fuera del directorio nuevo:** solo `PROGRESO.md` y este documento. No se tocan `frontend/`, `worker/`, `database/`, los bots ni los secretos.

## 10. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| Logos sin transparencia | Decisión §3. |
| Afirmar la IA de fotos antes de verificarla | Se etiqueta como demostración. Puedo verificarla en staging con Gemini real si lo autorizas: tiene un costo mínimo de API. |
| El 3D afecta al LCP en móvil | El LCP será el titular HTML, no el canvas. El 3D carga después y solo en equipos capaces. |
| Las capturas de SneakerHub cambian | El snapshot se regenera con un comando. |
| URL provisional `workers.dev` | `noindex` y canonical configurable. |
