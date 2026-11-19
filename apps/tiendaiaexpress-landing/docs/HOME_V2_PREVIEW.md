# Home V2 · vista previa local (no publicada)

Estado: **prototipo local listo para revisión humana**. No está aceptado, no está fusionado y no se despliega.
Rama `feat/home-v2` (worktree `.tmp/wt-home-v2`), sin commits: todo está como cambios sin confirmar.

## Cómo verla y compararla con la V1

```bash
# Vista previa (incluye /home-v2 con noindex)
VITE_HOME_V2=preview npm run build:official
node scripts/serve.mjs 4321          # V2: http://localhost:4321/home-v2 · V1 del mismo build: http://localhost:4321/
```

El build oficial (`npm run build:official`, `npm run cf:deploy`) **no cambia**: sin `VITE_HOME_V2=preview` no existe la
entrada `home-v2`, ni su página, ni sus clases en la hoja de estilos. Verificado el 2026-11-17 con builds limpios: los 130
archivos de `dist/` son idénticos byte a byte (sha256) a los del commit base `19db4c8`.

Pruebas: `BASE_URL=http://localhost:4321 VITE_APP_URL=https://app.tiendiaexpres.com npx playwright test tests/home-v2.spec.ts`
(contra un build oficial las 18 pruebas se omiten solas porque `/home-v2` responde 404).

## Bloqueantes de publicación (decisiones comerciales, no resueltas aquí)

1. **Varios administradores por plan.** `src/content/plans.ts`, el comparador y Funciones dicen que es exclusivo de
   Mayorista. El backend (`POST /api/admin/team`, `worker/src/routes/admin.ts`) solo exige rol de propietario y no revisa el
   plan; el panel tampoco lo limita. La V2 usa lenguaje neutro («tú y los usuarios que autorices») y no toca el
   comparador. Decidir: (a) qué planes incluyen equipo y (b) si se aplica el límite en el servidor (tarea aparte).
2. **Cuota IA del asistente.** `plans.ts` dice «Asistente en Telegram: hasta 500 mensajes IA al mes». No está definido si
   el asistente de WhatsApp comparte esa cuota. La V2 conserva el texto vigente de los planes sin cambios.
3. **Disponibilidad del bot de WhatsApp.** Funciona con WAHA desde un PC de oficina (`worker/wrangler.production.toml`):
   si el PC se apaga, no responde. La V2 no promete horario, continuidad ni que Telegram sea un respaldo automático. Antes
   de publicar: evaluar fiabilidad/continuidad y las condiciones de servicio del canal.

## Rediseño visual (2026-11-17, segunda ronda)

Dirección: dark editorial SaaS. Sistema en `src/v2/home-v2.css` (tokens `--v2-*`, solo se carga en `/home-v2`) y
`src/v2/ui.tsx` (contenedor de 1200 px, 4 niveles tipográficos, 3 estilos de botón). Una sola familia (Plus Jakarta
Sans, ya incluida en el sitio). Lima solo en el CTA principal y en el estado «Actualizado».

- Hero: una demo compuesta (ventana de tienda + chat privado superpuesto + pasos 1-2-3). En móvil, pestañas
  «Administración» / «Cliente» y una tira «Así lo ve tu cliente»: no hay dispositivos apilados.
- Administración: 3 evidencias y una ventana con mensajes reales del asistente (`VINCULAR TU-CODIGO`, «quedó vinculado
  a…», «Nada se guarda sin tu confirmación»).
- Planes: presentación propia (`PlansV2.tsx`) que lee `plans.ts`; comparador DERIVADO de `plans.ts` y plegado.
- Reutilizados sin editar: `Conditions` y `Contact` (V1), vestidos con los tokens desde `home-v2.css`.

## Refinamiento (fase D, 2026-11-17)

- Demo en UN panel: chat privado y tienda lado a lado (≥ 768 px), sin que el chat tape el producto; texto de 14 px,
  precio antiguo tachado y nuevo destacado en la tienda. Etiqueta: «Simulación demostrativa. Mensajes ilustrativos…».
  Corregido: el mensaje decía «a 199 mil» y el precio nuevo es $199.900.
- Hero: titular en blanco y extrabold, subtítulo más claro, un solo foco (CTA lima); «Ver cómo funciona» como enlace.
- Administración: cuatro operaciones verificadas en el asistente de producción (precio, entrada de existencias, ficha
  desde foto, pedidos pendientes); garantías en una fila y la vinculación en un desplegable.
- Planes: precio de 44 px, pago inicial y primer año como filas, listas de 15 px. Comparador con la fila «Estudio
  Creativo» derivada de `addOns` en `plans.ts`.
- `vite.config.ts`: la página `home-v2.html` ya no precarga Manrope (condición limitada a ese archivo; el build
  oficial sigue idéntico byte a byte).
- «Ver ejemplos en la página actual» deja claro que el enlace del Estudio Creativo lleva a la página principal vigente.

## Profundidad 3D (fase H, 2026-11-18)

Dirección «más tipo Apple» (fondos negro / blanco, tipografía semibold, navegación translúcida de 48 px, botones en
píldora) más una capa 3D real con transformaciones CSS (`src/v2/depth.css` y `src/v2/depth.ts`), sin WebGL ni librerías:
- Hero: el escenario empieza inclinado hacia atrás (22° en escritorio, 10° en móvil) como una pantalla que se abre y
  se endereza con el scroll (`--rise`); el chat privado flota 120 px por delante y se une al plano; con ratón o
  trackpad gira ±2° siguiendo el puntero; entrada que sube y gira una sola vez; luz suave de suelo.
- Al final de la historia, la tarjeta del producto que cambia se acerca en Z.
- Cliente: los tres teléfonos se abren en abanico al entrar en pantalla (CSS scroll-driven, `view()`); en móvil, las
  filas horizontales (cliente y tiendas) giran como un cover flow al pasar por el centro.
- Tiendas: pared curva de seis teléfonos que se aplana al hacer scroll; al pasar el cursor o enfocar, el teléfono se
  endereza.
- Beneficios: baldosas que se inclinan hacia el puntero con una luz que lo sigue; las plantillas y las piezas del
  Estudio Creativo se abren en abanico.
- Sin JS, con reduced-motion o con pantalla táctil: composición plana o quieta. Navegadores sin scroll-driven
  animations: composición quieta, ligeramente girada.
- Escena final (`FinalCtaV2`): un escenario oscuro con suelo reflectante y la zapatilla NORD-02 flotando. Al hacer
  scroll, la cámara se aleja, la zapatilla gira (el scroll mueve un clip de 8 s; nunca se reproduce solo) y aparece
  «Empieza hoy.». El clip (1,7 MB) se descarga solo cerca del final y se reproduce desde memoria, así que funciona en
  cualquier servidor. Sin movimiento: imagen fija y texto. Etiqueta visible: «Imagen generada con IA a partir de un
  producto de la tienda piloto».
- Recursos generados con Google Flow (2026-11-18), en `src/assets/v2/`:
  - escenario vacío (Nano Banana, 0 créditos), también como suelo del hero;
  - zapatilla a partir de la foto real del NORD-02 (0 créditos);
  - giro de 8 s (Omni 1.1 Flash, 12 créditos), recodificado con ffmpeg para avanzar fotograma a fotograma con el scroll.
  - Los originales están en `~/flow-mcp-out/TiendIA-HomeV2-3D`.
- Pruebas nuevas:
  - inclinación del hero con movimiento, y plano con reduced-motion;
  - la escena final avanza con el scroll, nunca se reproduce sola, carga tarde y no hace peticiones externas;
  - sin movimiento muestra la versión fija;
  - el foco del teclado nunca cae en texto oculto.
- Peso inicial (gzip): 154,5 → 156,8 KB. Las imágenes y el clip se cargan después, de forma diferida.

### Segunda ronda 3D (2026-11-18)
- Hero, segundo acto:
  - cuando el precio cambia, el NORD-02 se levanta de su tarjeta (Z real en escritorio) y da una vuelta de 360°.
    El clip lo generó Flow a partir de la foto real del producto (`hero-turn.mp4`, 0,7 MB); se descarga cuando la
    página termina de cargar y lo mueve el scroll.
  - Portal: el último 28 % del tramo fijo (`STORY_SHARE = 0.72`). La cámara entra en el producto, el blanco de la
    tienda llena la pantalla y la página pasa a las escenas claras sin la franja degradada. Sin movimiento, la franja
    se mantiene.
- Administración: chat y resultado como un libro abierto que se inclina con el puntero. Al cambiar de caso, las
  tarjetas se reparten en 3D; al cargar la página no se mueve nada.
- Planes: las tres tarjetas suben desde atrás, una tras otra (scroll-driven); Negocio queda un poco al frente.
  Textos y precios sin cambios.
- Móvil: más inclinación en el hero (14°), el producto que gira, el portal y la escena final.
- Tiendas reales: productos de distintos tipos de tienda flotan alrededor del título (Flow: imagen + clip de 8 s,
  `stores-drift.mp4`, 1,4 MB, movido por el scroll; solo en tablet y escritorio). Etiqueta «Ilustración generada
  con IA»; las tiendas reales siguen siendo las capturas de abajo.
- No se hizo una escena de Flow para el Estudio Creativo: el video con IA del producto está apagado y podría parecer
  que el estudio hace ese vídeo.
- Hook común `useScrubVideo` (`depth.ts`) para los clips movidos por el scroll: se descargan completos y se
  reproducen desde memoria, nunca solos.
- Créditos de Flow gastados en total: 36 (tres vídeos de 12). Las imágenes no costaron créditos.
- Navegadores: solo hay Chromium instalado; no se instalaron WebKit ni Firefox. Los efectos movidos por JS (hero,
  portal, clips, inclinación) funcionan en todos. Los de `animation-timeline` (abanico, pared curva, planes, cover
  flow) quedan como composición quieta donde no hay soporte (Firefox sin flag). Pendiente de revisar a mano en
  Safari y Firefox. Lighthouse sin medir.
- Pruebas V2: 40/40 (nueva: portal y vuelta del producto). Peso inicial (gzip): 158,0 KB. Build oficial idéntico
  (130 archivos).
- Evidencia: `docs/home-v2-capturas/fase-h/profundidad/{1440,390}-1[1-9]*.jpg`, `*-2[01]*.jpg` y
  `1440-recorrido-3d.webm` (página completa). Script: `node scripts/depth-shots-2.mjs <url> <carpeta>`.
- Evidencia: `docs/home-v2-capturas/fase-h/profundidad/`:
  - fotogramas a 1440 y 390 px;
  - `1440-final-p000…p100.jpg`;
  - `1440-recorrido-3d.webm`.
  - Scripts: `node scripts/depth-shots.mjs` y `node scripts/finale-frames.mjs <url> <carpeta>`.

### Revisión visual y móvil (2026-11-18)

Auditoría de la página completa a 390, 360 y 1440 px con movimiento (`node scripts/audit-shots.mjs <url> <carpeta>
[anchos]`; capturas en `docs/home-v2-capturas/fase-h/auditoria/{antes,despues}` y
`comparativa-movil-390.jpg`). Correcciones:
- Portal: el zoom apunta al centro real de la foto del NORD-02, medido en el DOM (`aimPortal`), y lleva el producto
  al centro de la pantalla mientras entra. Antes, en móvil, la cámara entraba en una esquina de la tienda.
- Administración en móvil: alturas mínimas medidas por ancho (sin franja negra vacía bajo el panel). La tarjeta de
  resultado ocupa el alto y centra su contenido. La altura sigue siendo estable entre casos.
- Beneficios en móvil: las plantillas y las piezas del Estudio en abanico caben en la baldosa (antes se cortaban).
- Cover flow en móvil (recorrido del cliente y tiendas): las filas tienen relleno lateral, así que la primera
  pantalla descansa plana en el centro con las vecinas girando a los lados.
- Planes en móvil: subida más corta (sin hueco vacío mientras llegan las tarjetas).
- Escena final en móvil: la zapatilla cabe en el ancho desde el primer fotograma.
- Tiendas (escritorio): el fondo del clip de Flow se corrigió a blanco puro (antes se veía un rectángulo gris) y la
  escena se movió para no tocar el título ni los teléfonos. Solo se muestra desde 1024 px.
- Verificación: V2 40/40, unitarios 7/7, build oficial idéntico (130 archivos), peso inicial 158,6 KB gzip.

### Planes en 3D con Flow (2026-11-19)

- Cada tarjeta de plan lleva arriba un objeto de arcilla hecho con Google Flow, que cuenta la progresión del
  negocio:
  - Emprendedor: una bolsa de compras con asa y etiqueta lima;
  - Negocio: un carrito con ruedas lima, sobre el suelo negro reflectante de su tarjeta oscura;
  - Mayorista: un palé con cajas, una de ellas lima.
- Con movimiento, un clip de 4 s gira cada objeto con el scroll (nunca se reproduce solo), y al pasar el ratón el
  objeto se acerca.
- Los objetos claros se ajustaron a blanco puro y se multiplican sobre el gris de la tarjeta, así que se funden con
  ella sin bordes. La imagen fija es el primer fotograma de su clip, para que no salte al cambiar de una a otro.
- Decorativos (aria-hidden): precios, textos y planes siguen saliendo de `plans.ts`, sin cambios.
- Recursos en `src/assets/v2/plan-{emprendedor,negocio,mayorista}.{webp,mp4}`: 3 imágenes (0 créditos) y 3 clips
  (7 créditos cada uno; uno se recuperó de Flow sin volver a pagarlo cuando la ventana se cerró a mitad).
- Verificación: V2 48/48, build oficial idéntico, peso inicial 168,6 KB gzip.
- Evidencia: `docs/home-v2-capturas/fase-h/planes/3d-*.jpg`.

### «Tu tienda en 3 pasos» con Flow y pie oscuro (2026-11-19)

- Pasos (`StepsV2.tsx`):
  - cada paso tiene un objeto de arcilla blanca hecho con Google Flow sobre el mismo suelo reflectante del cierre:
    una tienda con toldo lima, un avión de papel con estela lima y un globo de chat con una marca lima;
  - con movimiento, un clip de Flow de 4 s gira o mueve el objeto con el scroll (`useScrubVideo`; nunca se
    reproduce solo) y la tarjeta se inclina con el puntero;
  - en escritorio, una línea lima se dibuja de un paso al siguiente;
  - debajo, «Crear mi tienda gratis» y las condiciones de la prueba;
  - los textos son los mismos hechos verificables de antes.
  - Recursos en `src/assets/v2/paso-{1,2,3}.{webp,mp4}`: 3 imágenes (0 créditos) y 3 clips (7 créditos cada uno).
- Pie (`FooterV2.tsx`):
  - pasa a ser oscuro, como continuación del cierre;
  - «TiendIA Exprés» queda de pie sobre el escenario de Flow (la misma imagen que la escena final), con su
    reflejo en el suelo, y gira un poco con el puntero;
  - «Probar gratis» es la píldora lima;
  - la barra inferior del móvil se oculta también en el pie.
- Créditos de Flow gastados en total en la V2: 57 (tres clips de 12 y tres de 7). Las imágenes no costaron créditos.
- Verificación: V2 48/48, unitarios 7/7, build oficial idéntico, peso inicial 168,1 KB gzip (los clips se cargan
  después). Evidencia: `docs/home-v2-capturas/fase-h/pasos/`.

### Nuevo orden y pie (2026-11-19)

Orden «entiendo → lo creo → lo quiero → decido», sin quitar nada del 3D:

| # | Bloque | Notas |
|---|---|---|
| 1 | Nav | Cómo funciona · Tiendas · Planes · Preguntas, más Ingresar y Probar gratis. Se quitó Administración. |
| 2 | Hero | En móvil y tablet se ven los 4 productos con sus precios, en una fila compacta. |
| 3 | Demo | Sigue en el mismo scroll del hero, con la entrada a la pantalla. |
| 4 | Qué ve tu cliente | Va justo después: el portal termina dentro de la tienda. |
| 5 | Por chat | Bento `AdminV2`: el cambio de precio como «libro abierto» y una tarjeta por cada otra operación, con sus roles. Las tarjetas se inclinan y entran en cascada en 3D. |
| 6 | Tiendas reales | Sin la línea divisoria de antes. |
| 7 | Beneficios | En gris suave: tres resultados («Sin comisión por venta», «Sin depender de un desarrollador», «Todo desde tu celular») y la franja «Incluye» (plantillas, importación, Estudio Creativo, que conserva `#estudio`). |
| 8 | Empieza en 3 pasos | Bloque nuevo, `StepsV2`, oscuro. Solo hechos verificables: prueba gratis o te la armamos, dirección propia, vinculación por código. En CSS 3D, las tarjetas se separan en profundidad. |
| 9 | Planes y condiciones | Las condiciones van pegadas a Planes, con un adelanto y «Ver todas las condiciones» en todos los anchos. |
| 10 | Preguntas | Primero las 6 objeciones reales y «Ver más preguntas (10)». |
| 11 | Formulario | Sin cambios. |
| 12 | Cierre | «Tu tienda. Bajo tu control.», un botón y el asesor como enlace de texto. |
| 13 | Pie (`FooterV2`) | Columna de marca con «Probar gratis» e «Ingresar a mi tienda»; contacto directo (WhatsApp y los correos oficiales de ventas y soporte de `site.ts`); redes; tres columnas en el orden de la página (plegables en el móvil); línea inferior con las páginas legales y «Volver arriba»; wordmark grande. Sin horario ni línea de estado. |

- Pruebas: 48/48. La prueba de Administración pasó de pestañas a bento. La del cierre usa la nueva frase. La de
  «Ver el cambio» usa `?no3d` (su reloj simulado no se lleva bien con la carga diferida de WebGL) y mide el scroll
  después del clic.
- Build oficial idéntico (130 archivos). Peso inicial: 167,5 KB gzip.
- Evidencia: `docs/home-v2-capturas/fase-h/orden/` (capturas a 1440 y 390 px y láminas).

### Celulares (2026-11-19)

- Barra inferior de acción (`MobileV2.tsx`, por debajo de 1024 px): «14 días gratis · Sin tarjeta de crédito» con
  «Crear mi tienda gratis». Es translúcida, respeta la zona segura inferior, aparece al pasar el hero y se oculta en
  el formulario de contacto y en la escena final. Mientras está oculta no recibe foco ni la leen los lectores de
  pantalla. El pie reserva su altura. Sin JS no existe.
- Condiciones comerciales en el móvil (las 12 seguidas eran muy largas): adelanto con degradado y botón «Ver todas
  las condiciones». Cualquier enlace a `#condiciones` las abre. El texto completo siempre está en la página: sin JS se
  ve entero y los lectores de pantalla lo leen completo.
- Selector de planes con objetivos táctiles de 44 px.
- Verificación: V2 48/48 (prueba nueva de la barra y del pliegue), unitarios 7/7, build oficial idéntico, peso
  inicial 164,6 KB gzip.
- Evidencia: `docs/home-v2-capturas/fase-h/movil/` (`antes/`, `despues/`, `comparativa-movil-cambios.jpg`).

### 3D real con WebGL (2026-11-19)

El 3D anterior era CSS sobre superficies planas. Ahora hay dos escenas WebGL con three.js 0.186, que ya era
dependencia del sitio (no se instaló nada). Viven en `src/v2/three/` y se cargan en un trozo diferido: la carga
inicial no incluye three.js.
- Hero (`HeroWorld.ts`): espacio oscuro con niebla y, flotando a distintas profundidades:
  - 16 losas gruesas con las fotos reales de los productos de la tienda piloto;
  - tres teléfonos modelados en código con capturas reales.
  - La cámara entra en el espacio con el scroll y gira un poco con el ratón. No hay movimiento propio tras una
    entrada de menos de 2 s.
  - En móvil no hay piezas cercanas, y el espacio se atenúa para no competir con el texto.
  - Se oscurece al empezar la historia y desaparece en el portal.
- Tiendas (`StoresRing.ts`): carrusel 3D de seis teléfonos modelados con las capturas reales de cada tienda, con
  reflejo en el suelo y profundidad (los de atrás, más oscuros). El scroll hace girar el carrusel hasta que cada
  tienda pasa al frente. Con el carrusel activo, debajo queda una lista de las tiendas con sus enlaces.
- `useScene3D`: solo con movimiento activo y en equipos capaces (`motion/capabilities.ts`: sin renderizado por
  software, sin ahorro de datos, núcleos y memoria suficientes; `?force3d` para pruebas). Se carga cuando la página
  está inactiva y se pausa fuera de pantalla. Si no, queda la versión CSS.
- Recorrido del cliente (`JourneyPhones.ts`, escritorio desde 1024 px): tres teléfonos modelados con la ficha
  real, el carrito real y el mensaje de pedido. El mensaje es una imagen del propio componente `OrderMessagePhone`,
  con el cliente de ejemplo; se genera con `scripts/capture-order-screen.mjs`. Cada teléfono se coloca exactamente
  donde está su paso: lee la posición del teléfono CSS, que sigue en la página por el diseño y los textos
  alternativos, pero transparente. Con el scroll llegan apilados desde el fondo, se abren en abanico y giran hacia
  ti. En móvil sigue el cover flow CSS.
- Escena final (`FinalePhone.ts`, desde 768 px): junto a la zapatilla, un teléfono modelado con la tienda piloto
  llega desde la oscuridad por la derecha, se planta en el suelo reflectante y gira hacia ti con el scroll.
- Rendimiento (`node scripts/perf-3d.mjs <url>`, scroll de la página completa, indicativo):
  - en escritorio, mediana de 8,3 ms y percentil 95 de 8,5 ms (60 fps), sin tareas largas;
  - en móvil emulado con la CPU ralentizada ×4, la tarea más larga bajó de 409 ms a 82 ms al compartir las
    geometrías y compilar los shaders de forma asíncrona antes de pintar;
  - en teléfonos, el lienzo usa una densidad de píxeles de 1,25 y el hero lleva menos piezas;
  - con la máquina cargada, las mediciones posteriores no fueron comparables (hasta la página sin 3D daba 60
    tareas largas): falta medir en un teléfono real.
- Pruebas: V2 46/46. El Chromium de pruebas de esta máquina usa la GPU, así que las demás pruebas (axe incluido)
  corrieron con WebGL activo. Prueba nueva: arranque sin errores y nada de WebGL con reduced-motion. Peso inicial:
  163,2 KB gzip; three.js (140 KB gzip) va en el trozo diferido.
- Evidencia: `docs/home-v2-capturas/fase-h/webgl/` (capturas y `video/1440-recorrido-3d.webm`). Script:
  `node scripts/webgl-shots.mjs <url> <carpeta>`.

### Planes, preguntas y pie con patrones de 21st.dev (2026-11-19)

- Referentes de 21st.dev (plan gratuito: dos descargas de código al día, sin generación con IA):
  - «Pricing Section with Monthly/Yearly Toggle» (sin dependencias): el precio cuenta hasta el valor nuevo y el plan
    destacado va invertido;
  - «Footer with Big Wordmark» (MIT): columnas plegables en el móvil y el nombre de la marca en grande;
  - «Ghost Accordion» (sin descargar): preguntas numeradas y una sola respuesta abierta.
  - Se adaptaron a mano al sistema de la V2. No se instaló ningún paquete ni se copió el componente tal cual.
- Planes (`PlansV2.tsx`), todo sigue saliendo de `plans.ts`:
  - cabecera y selector centrados;
  - Negocio en tarjeta oscura con «Recomendado» en lima;
  - el precio cuenta al cambiar entre mensual y anual;
  - con pago anual, «Ahorras $X COP» frente al primer año con pago mensual (cálculo de `annualSaving`);
  - «Todo lo del plan X, y además:» como encabezado de la lista;
  - «Próximamente» en etiquetas;
  - franja «En todos los planes» (sin comisión, Estudio Creativo de `addOns`, prueba gratis de `site.trial`);
  - comparador con la primera columna fija en el móvil.
  - En el móvil, las tarjetas son una fila deslizable con un selector de plan.
- Corregido (era anterior a este cambio): con reduced-motion, los teléfonos de 390 px mostraban la página a 1018 px
  de ancho (con zoom alejado). Las filas deslizables ahora contienen su pintado (`contain: paint`, solo por debajo de
  1024 px) y la fila de planes se mide con unidades de contenedor. Hay una prueba de regresión.
- Preguntas: numeradas, con una sola respuesta abierta a la vez (`<details name>` nativo).
- Pie: columnas plegables en el móvil y el nombre «TiendIA Exprés» en grande, difuminado (decorativo). No se puso
  línea de estado: no se promete disponibilidad.
- Verificación: V2 44/44, unitarios 7/7, build oficial idéntico (130 archivos, base reconstruido el 2026-11-19
  porque `sitemap.xml` lleva la fecha), peso inicial 161,4 KB gzip.
- Evidencia: `docs/home-v2-capturas/fase-h/planes/{antes,despues}-*.jpg`. Script:
  `node scripts/plans-shots.mjs <url> <carpeta> <etiqueta>`.

## Escenario único de producto (fase G, 2026-11-18)

- `HeroStory.tsx` + `hero-story.css` sustituyen a `HeroV2` y `StoryV2`: UN escenario (tienda dominante + chat privado)
  desde el hero hasta el resultado. Sticky CSS; el progreso del scroll (0…1) escribe `--rise`, `--c2` y `--c3` y el
  estado de la simulación; reversible; sin reproducción automática. «Ver el cambio» / «Ver cómo funciona»
  reproducen la secuencia una vez sin mover la página; cualquier rueda o toque devuelve el control al scroll.
  Tramo fijo: 1,35 alturas de pantalla en escritorio, 1,2 en móvil. Sin JS o con reduced-motion: escenario quieto y
  tríptico visible (también es la versión para lectores de pantalla y el destino de `#como-funciona`).
- Primer viewport (medido): producto visible 54 % a 1440×900, 55 % a 1366×768, 57 % a 768, 45 % a 390, 40 % a 360;
  el precio que cambia queda visible sin scroll en todos.
- Cliente (`CustomerV2`): ficha real → carrito real → pedido real por WhatsApp, en una composición; carrusel en móvil.
- Administración (`AdminV2`): un caso activo grande (chat + resultado en la tienda) y cuatro selectores; altura fija.
- Tiendas (`StoresV2`): collage editorial de las seis capturas reales.
- Lección: Tailwind escanea `docs/` de la landing. Los HTML de trabajo (maqueta del concepto, comparativa) se movieron
  a `.tmp/wt-home-v2/docs/home-v2-concepto-g/` para no alterar el CSS oficial. `sitemap.xml` lleva la fecha del build:
  la comparación SHA256 exige reconstruir el base el mismo día.
- Peso inicial (gzip): 157,2 KB → 154,4 KB (sin GSAP ni librerías nuevas).

## Rediseño editorial por escenas (fase F, 2026-11-17)

Escenas (oscuro → claro → oscuro → claro → oscuro; claro = `.v2-light`, mismos componentes re-tematizados):
1. Hero (`HeroV2`): kicker «Tu tienda online. Tu control por chat.», H1 «Tu tienda. Bajo tu control.», CTA centrados y
   UNA composición de producto (catálogo real + chat privado flotante). Al cargar, una vez y < 2,5 s, el precio de
   NORD-02 pasa a $199.900 con «Actualizado».
2. «Un mensaje. Tu tienda actualizada.» (`StoryV2`, `#como-funciona`): tres beats; en escritorio el beat que cruza el
   centro del viewport conduce el estado compartido (IntersectionObserver + sticky CSS, sin secuestrar el scroll) y
   la tarjeta relevante pasa al frente; en móvil, scroll natural con un visual por beat y el reproductor al final.
   «Repetir demo», Pausar/Reanudar; pausa sola fuera de pantalla o con la pestaña oculta.
3. «Vende sin complicarte.» (`CustomerV2`, claro): carrito real + mensaje de pedido real; sin cobro en línea.
4. «Administra hablando.» (`AdminV2`): los cuatro casos, roles y garantías, en un módulo más grande.
5. Beneficios (`BenefitsV2`, claro): tres declaraciones con visual (0 % comisión, plantillas reales, importación) y
   Estudio Creativo; Tiendas reales en claro.
6. Planes, condiciones, preguntas, contacto y cierre «Empieza hoy.» (oscuro).

Fuente única de la simulación: `src/v2/sim.tsx` (sustituye a `DemoV2.tsx`; `StepsV2.tsx` se integró en la escena 3).
Evidencia: `docs/home-v2-capturas/fase-f/` (antes, escenas a 360/390/768/1366/1440 px, vídeos .webm en `despues/movimiento`).
Peso inicial (gzip, HTML+CSS+JS): 152,8 KB → 157,2 KB.

## Movimiento e interactividad (fase E, 2026-11-17)

Lenguaje de movimiento en `src/v2/home-v2.css` (solo con `html.motion`; sin JS o con reduced-motion no se oculta ni
mueve nada): micro 160 ms · paneles 240 ms · entradas 520 ms · una curva de desaceleración · solo transform/opacity.

- Hero: entrada escalonada solo con CSS (rótulo → titular → subtítulo → CTA → demo), termina en ≈ 1,1 s.
- Demo (`DemoV2.tsx`): un único estado `SIM` alimenta chat, tienda y tira móvil. Etapas: inicial → pedido →
  escribiendo → resumen → confirmado → guardando → tienda (precio que se desliza y «Actualizado»). Se reproduce una
  vez al entrar en pantalla, nunca en bucle; Pausar / Reanudar / Repetir; se pausa sola fuera de pantalla o con la
  pestaña oculta y reanuda donde estaba; cambiar de canal no altera el estado; `aria-live` solo con el resumen final.
- Administración (`AdminV2.tsx`): explorador con pestañas (clic, teclado, toque) de cuatro operaciones verificadas,
  panel de altura fija con transición de 220 ms y roles reales por operación (ROLE_HELP del asistente).
- Secciones: «Cómo funciona», Beneficios y Tiendas se revelan una vez (mejora progresiva, `html.v2-js`).
- Microinteracciones: indicador deslizante en mensual/anual, Administración/Cliente y canal; leve presión en CTA;
  fundido al abrir comparador, preguntas y vinculación; elementos del menú móvil.
- Evidencia: `docs/home-v2-capturas/fase-e/{antes,despues}` (vídeos .webm de 1440 y 390 px y fotogramas con
  tiempo y etapa en el nombre). Script: `node scripts/record-home-v2.mjs <url> <carpeta>`.
- Peso inicial (gzip, HTML+CSS+JS): 148 KB → 152,8 KB (JS 104 → 107 KB).

Riesgos de esta presentación:
- El párrafo legal bajo los planes es copia literal del de `Commerce.tsx` (no exportado). Compartirlo exige exportarlo
  desde la V1 (cambio de un archivo V1, aunque sin efecto en su build): pendiente de autorización.
- El comparador V2 agrupa las cuotas de IA de cada plan en una sola fila (la V1 las separa en cuatro filas). No falta
  ningún dato: todo sale de `plans.ts`.
- Si la V2 reemplaza a la V1, el enlace a `/#estudio` deja de tener destino.

## Otros pendientes antes de publicar

- La V2 no incluye `StructuredData` (el JSON-LD oficial describe el asistente solo en Telegram y su FAQ es la de la V1).
- Preguntas de la V1 que la V2 omite porque hablan solo de Telegram: «¿Qué funciones de IA están disponibles hoy?» y
  «¿Puedo tener varias tiendas?» (no se verificó la multitienda por WhatsApp).
- «Ver el Estudio Creativo» enlaza a `/#estudio` (sección de la V1): si la V2 reemplaza a la V1, hay que darle destino.
- El comparador de planes y las condiciones se muestran completos: plegarlos exige tocar `Commerce.tsx` (V1).
- «Qué incluye el pago inicial» queda en Preguntas con el texto oficial (menciona la vinculación de Telegram).
- Lighthouse no se midió (no está instalado y no se instalaron dependencias).
