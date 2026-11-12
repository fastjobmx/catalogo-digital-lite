# Motor de diseño publicitario (Estudio Creativo · fase 4)

Rama: `feat/motor-publicitario` (sale de `main` = producción, `0bfbc03`). Worktree: `.tmp/wt-motor`.
Estado: **implementado y probado en local, sin commit ni despliegue.** No necesita migración de base de datos.

Fases anteriores: [FABRICA_CREATIVOS_FASE3.md](FABRICA_CREATIVOS_FASE3.md) (fábrica de creativos y video, en producción).

---

## 1. Diagnóstico del generador que ya teníamos

El generador de la fase 3 ya resolvía bien lo difícil: datos verificados por el servidor (precio, precio anterior, porcentaje, etiquetas), composición en el navegador sin IA ni costo (Canvas 2D), video MP4 H.264 cuadro a cuadro (WebCodecs + `mp4-muxer`), almacenamiento privado en R2, revisión (aceptar, rechazar, editar texto), reutilización por huella y video con IA opcional.

Lo que limitaba la calidad visual:

| Problema | Efecto |
|---|---|
| Una sola maqueta por formato (`scene.ts`: foto arriba, datos abajo, franja de color) | Todas las piezas se veían iguales; cambiar de plantilla solo cambiaba la etiqueta |
| Fondo blanco plano, sin degradados, texturas, luz ni figuras | Aspecto básico, de «plantilla» |
| Foto siempre en `cover` | Recortaba el producto cuando la proporción no coincidía |
| Texto ajustado al pintar, no al componer | La composición no sabía cuánto ocupaba cada texto: no podía repartir el espacio ni evitar choques |
| Sin análisis de la foto | No detectaba fondo liso, encuadre del producto ni colores dominantes |
| Una tipografía por pieza (la del Brand Kit) | Sin jerarquía tipográfica |
| Sin control de calidad | Una pieza se daba por buena con solo exportarse |
| Sin formato 1200 × 628 ni elección PNG/JPG/WebP | Faltaban anuncios horizontales y control del archivo |

**Restricción de arquitectura que condiciona todo lo demás:** el servidor es un Cloudflare Worker. Ahí no corren Sharp (binario nativo), FFmpeg ni Chromium. Sin VPS, Docker ni servidores nuevos (pedido explícito), el render tiene que seguir en el navegador del comerciante. Es la misma decisión de la fase 3, y es la que mantiene el costo por pieza en cero.

## 2. Lo que se conserva

Todo: plantillas con datos verificados, textos sin IA y con IA filtrada, revisión, campañas, reutilización, video automático, video con IA, almacenamiento privado. **La composición clásica sigue disponible** (botón «Clásico» en el paso «Diseño») y las piezas guardadas antes siguen siendo válidas: su plan es versión 1 y su huella no cambia. «Antes y después» y las piezas solo de marca siguen usando la composición clásica.

## 3. Lo implementado

### Motor de composición (`frontend/src/lib/creative/design/`)

| Archivo | Qué hace |
|---|---|
| `photo.ts` | Analiza la foto real (copia reducida): orientación, fondo uniforme y su color, recuadro del producto, colores dominantes y una máscara del producto. La máscara solo se acepta si pasa 6 controles (fondo uniforme, tamaño del producto, que no esté cortado por los bordes, contraste del contorno, contorno no deshilachado, transparencia de PNG). |
| `styles.ts` | 5 estilos: Minimalista premium, Comercial moderno, Oferta de alto impacto, Moda elegante, E-commerce profesional. Cada uno define tipografías (display, cuerpo, rótulos, precio), paleta (desde la marca o desde la foto), forma del precio (liso, subrayado, cápsula, etiqueta, sello), sombras, reflejo, texturas, figuras y el orden de sus 5 composiciones. |
| `compose.ts` | 5 composiciones con distribución distinta (Escenario, Dividido, Diagonal, Editorial, Tarjeta), cada una adaptada a vertical, cuadrado y horizontal, más cuadrícula para colecciones. Mide cada texto con la fuente real y lo ajusta a su zona; si no cabe, simplifica por pasos (sin descripción, letra menor, sin rótulo). Reparte el espacio entre producto e información sin superposiciones, respeta la zona segura de historias (arriba 8,5 %, abajo 11 %) y declara sobre qué color se lee cada texto. |
| `qa.ts` | Control de calidad: dimensiones, márgenes y zona segura, superposiciones, textos sobre el producto, contraste WCAG, textos cortados o desbordados, letra mínima, datos exactos del catálogo (nombre, precio, precio anterior, etiqueta, logo) y fidelidad de la foto (recorte máximo 20 %). Los errores **bloquean** el guardado. |
| `color.ts`, `fonts.ts` | Color (contraste WCAG, ajuste de luminosidad sin cambiar el tono, mezclas), azar reproducible con semilla, y 15 familias de Google Fonts (licencia SIL OFL, uso comercial libre) con sus pesos reales. |

Pintado (`render.ts`): degradados lineales y radiales, luz detrás del producto, sombras de contacto y de caída, reflejo, máscaras (círculo, arco), fondos desenfocados (por reducción y ampliación, funciona en todos los navegadores), texturas (puntos, líneas, cuadrícula, ruido), figuras (círculo, anillo, arco, sello, destello, mancha, franja), espaciado entre letras y recorte de fondo local.

**Fidelidad del producto:** los píxeles del producto se copian tal cual. La máscara solo decide qué es fondo. Si el recorte no es confiable, se usa la foto original completa, encajada en su proporción natural (nunca deformada; recorte máximo de 18 % cuando la proporción casi coincide).

### Servidor (`worker/`)

- `creative/designOptions.ts` (nuevo): valida estilo, composición, semilla (0–99.999), hasta 2 colores `#RRGGBB`, precio visible, quitar fondo y mostrar referencia. Una «Oferta aprobada» siempre muestra el precio (`PRICE_REQUIRED`).
- `creative/pieces.ts`: el plan acepta `design`; con él, el plan es versión 2 e incluye la referencia (SKU), la categoría y hasta 3 fotos. Las opciones forman parte de la huella: otro estilo o variante es otra pieza.
- `creative/templates.ts`: formato **Anuncio horizontal 1200 × 628** y la referencia del producto en los datos verificados.

### Panel

`admin/pages/creative/DesignPanel.tsx` (nuevo) y `Factory.tsx`: paso nuevo **«5. Diseño»** con:
- elección entre «Diseño publicitario» y «Clásico»;
- galería de estilos y de composiciones con **miniaturas dibujadas con la foto y los datos reales** del producto elegido;
- «Otra variante» (siguiente composición y otra semilla de decoración);
- colores propios (o los de la marca), precio visible, referencia, quitar fondo (con la explicación cuando no se puede) y archivo PNG, JPG o WebP;
- informe de control de calidad debajo de la vista previa (vista previa al doble de resolución).

## 4. Pruebas

| Prueba | Resultado |
|---|---|
| `frontend`: `npx tsc --noEmit` | OK |
| `frontend`: `vitest run src/lib/creative` | 24 OK. Incluye **1.050 combinaciones** (5 estilos × 5 composiciones × 7 formatos × 6 casos: recorte, oferta, fondo liso sin recorte, foto compleja, sin logo y precio oculto, etiqueta larga) sin errores de calidad; cinco variantes distintas por estilo; datos exactos; análisis de fotos sintéticas |
| `worker`: `npx tsc --noEmit` | OK |
| `worker`: `vitest run src/routes/creative-pieces.test.ts` | 15 OK (3 nuevas: plan con diseño y huella distinta, validaciones, formato 1200 × 628) |

**Con productos reales (lectura de la API pública de producción, sin escribir nada):** Luz Mágica y Muy Parcero, 139 fotos analizadas en el navegador.
- Solo **3 de 139** fotos permiten quitar el fondo con seguridad (camisetas blancas sobre fondo gris). El resto son fotos de ambiente (habitación, maniquí, exteriores): 130 con fondo no uniforme, 4 con contorno irregular, 2 con el producto cortado por el borde. En esas, el motor usa la foto completa como tarjeta con sombra.
- Revisadas a ojo 45 piezas reales (5 estilos × 5 composiciones en vertical, historia y anuncio): todas pasan el control.
- Análisis por foto: 6 a 110 ms.

**De punta a punta en el panel** (API y panel locales de la rama, base aislada `.tmp/fase3-local`): producto → plantilla → formato → estilo «Moda elegante» → «Otra variante» → crear. Pieza guardada: plan versión 2 con el diseño, JPG 1080 × 1350, 245 KB, control de calidad en verde.

**Video automático con el diseño nuevo:** historia 6 s, MP4 H.264 720 × 1280, 30 fps, 1,3 MB, 10,5 s de render en el equipo de pruebas.

**No probado:** Safari y Firefox; celular; WebP en navegadores que no lo exportan (devuelven PNG, que el servidor acepta); carrusel y colección con el motor nuevo en el panel (solo en pruebas automáticas).

**Problemas encontrados y corregidos durante las pruebas:** nombre ilegible sobre tarjetas blancas en el estilo de oferta; titular de «Editorial» que invadía el pie en formato cuadrado; logo verde lima transparente invisible sobre fondos claros (ahora se apoya en una placa que contraste); foto de ambiente diminuta sobre fondo desenfocado (ahora se muestra en su proporción natural); la pestaña se quedó sin memoria al preparar 25 veces la misma foto a resolución completa (importa para el lote: ver §6).

## 5. Tecnologías: qué se usa y qué se descartó

| Opción | Decisión | Motivo |
|---|---|---|
| Canvas 2D + WebCodecs + `mp4-muxer` (ya instalados) | **Se usa** | Costo cero, texto exacto, sin infraestructura. Sin dependencias nuevas en esta fase. |
| Sharp | No | Binario nativo: no corre en Workers ni en el navegador. Sus funciones (encajar, recortar, sombras, degradados) se cubren con Canvas. |
| FFmpeg nativo | No | Requiere servidor o contenedor (excluido en esta etapa). |
| FFmpeg.wasm | No por ahora | Descarga de ~30 MB y es varias veces más lento que WebCodecs, que ya codifica H.264 en el navegador. Podría servir para mezclar audio AAC si WebCodecs no lo hace en algún navegador. |
| Remotion | No por ahora | Necesita Chromium para renderizar (servidor o Lambda). Su licencia exige licencia de empresa por encima de cierto tamaño de equipo: revisar condiciones vigentes antes de adoptarlo. |
| Quitar fondo con modelos locales (`@imgly/background-removal`, RMBG) | No por ahora | A verificar antes de usar: la biblioteca de img.ly se publica con licencia AGPL y RMBG-1.4 con licencia no comercial. Además pesan decenas de MB. El método actual (sin IA) es honesto: solo recorta cuando es seguro. |
| Gemini Flash | Solo textos, opcional | Ya integrado y filtrado. La producción de piezas no depende de él. |

## 6. Lo que falta (siguientes fases)

1. **Ampliar a 15 estilos** (pendientes: Tecnología futurista, Deportivo dinámico, Belleza y cosmética, Hogar y decoración, Lujo negro y dorado, Blanco minimalista, Colores vibrantes, Editorial de revista, Liquidación y descuentos, Lanzamiento de producto). Las 15 tipografías ya están declaradas. Cada estilo nuevo debe pasar la misma prueba de 1.050 combinaciones y agregarse a `DESIGN_STYLE_KEYS` del servidor.
2. **Tipos de pieza dirigidos** (estado de WhatsApp, catálogo con referencia, beneficios reales, comparativo): la base ya está (formatos, referencia, descripción por frases completas). El comparativo de características necesita datos estructurados del producto: hoy solo existe la descripción libre.
3. **Video (fase 3 del pedido):** 10 plantillas con secuencia de escenas, transiciones y pantalla final; duraciones 8, 10, 12 y 15 s (hoy la plantilla fija 6, 10 o 15); audio AAC con WebCodecs `AudioEncoder`. La música necesita pistas con licencia comercial verificada (o generadas por el propio sistema): no se incluyó ninguna.
4. **Lote:** selección múltiple, cola con un trabajo a la vez, progreso, reintentos, cancelación, ZIP (sin dependencia: formato «store» es suficiente para JPG/MP4) e historial. Liberar los mapas de bits (`ImageBitmap.close()`) y los recortes entre productos: la prueba mostró que, sin liberar, la pestaña se queda sin memoria.
5. **Despliegue** (con autorización): sin migración. Orden: API (`catalogo-lite-api`) y luego panel (`npm run deploy:cloudflare`). El panel nuevo envía `design` y el formato `anuncio`; la API actual de producción los ignoraría o rechazaría el formato, por eso la API va primero.

## 7. Archivos

Nuevos:
- `frontend/src/lib/creative/design/color.ts`, `fonts.ts`, `photo.ts`, `styles.ts`, `compose.ts`, `qa.ts`, `design.test.ts`
- `frontend/src/admin/pages/creative/DesignPanel.tsx`
- `worker/src/creative/designOptions.ts`
- `docs/MOTOR_PUBLICITARIO.md`

Modificados:
- `frontend/src/lib/creative/scene.ts` (tipos de capa nuevos opcionales; `frameAt` acepta el constructor de escena)
- `frontend/src/lib/creative/render.ts` (pintado de las capas nuevas, recorte de fondo, `prepareDesign`, `sceneFor`, salida PNG/JPG/WebP)
- `frontend/src/admin/pages/creative/Factory.tsx` (paso «Diseño», control de calidad, vista previa nítida)
- `frontend/src/services/api.ts` (tipo `design` en el plan)
- `worker/src/creative/pieces.ts`, `worker/src/creative/templates.ts`, `worker/src/routes/creative-pieces.test.ts`
