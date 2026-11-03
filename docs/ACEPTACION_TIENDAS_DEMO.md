# Aceptación local de las tiendas demo — Fase 7

**Fecha:** 2026-11-01  
**Resultado:** aceptación funcional local aprobada con un bloqueo de WhatsApp pendiente.  
**Entorno:** navegador integrado, Vite y Wrangler locales; no se desplegó.

> La tabla de seguridad de este informe registra los hallazgos al cierre de Fase 7. La situación vigente y los bloqueos que siguen impidiendo producción están en Fase 8 y en [`FASE8_SEGURIDAD.md`](FASE8_SEGURIDAD.md).

## URLs y arranque

| Tienda | Catálogo | API/Worker | D1 local | UUID D1 | R2 local |
|---|---|---|---|---|---|---|
| Patitas Felices | http://127.0.0.1:5283/ | http://127.0.0.1:8898/ | `catalogo-lite-patitas-felices-local` | `8bb27c51-4735-4a8e-baba-89a18151f0f6` | `catalogo-lite-patitas-felices-assets` |
| TecnoCell Accesorios | http://127.0.0.1:6081/ | http://127.0.0.1:9696/ | `catalogo-lite-tecnocell-accesorios-local` | `f6e8e118-7dc3-4b86-b0cc-bc1607075757` | `catalogo-lite-tecnocell-accesorios-assets` |

Los cuatro servicios estaban activos al cerrar la validación. Si se detienen, abrir cuatro terminales y ejecutar desde la raíz del proyecto:

```powershell
Set-Location 'D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\local-stores\patitas-felices\worker'
npm run dev
```

```powershell
Set-Location 'D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\local-stores\patitas-felices\frontend'
npm run dev -- --host 127.0.0.1
```

```powershell
Set-Location 'D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\local-stores\tecnocell-accesorios\worker'
npm run dev
```

```powershell
Set-Location 'D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\local-stores\tecnocell-accesorios\frontend'
npm run dev -- --host 127.0.0.1
```

Para iniciar sesión como administrador, consultar localmente el archivo `worker\.dev.vars` de la tienda correspondiente. Cada archivo está excluido de Git; no copiar sus valores a tickets, chats o documentos.

## Resultados observados

| Comprobación | Patitas Felices | TecnoCell Accesorios |
|---|---|---|
| Salud/API, identidad y home | Aprobado; nombre, marca `pet-soft` y 3 productos visibles | Aprobado; nombre, tema azul `tech-minimal` y 4 productos visibles |
| Categorías | 3 visibles: Perros, Gatos, Cuidado y snacks | 4 visibles: Audio, Energía y carga, Relojes inteligentes, Accesorios móviles |
| Fotos | Hero, 3 portadas de categoría y 3/3 fotos de producto decodificadas (`naturalWidth > 0`) | Hero, 4 portadas de categoría y 4/4 fotos de producto decodificadas (`naturalWidth > 0`) |
| Ficha de producto | `/product/PF-DEMO-001`; detalle, precio, variante y stock visibles | `/product/TC-DEMO-001`; detalle, precio, variante y stock visibles |
| Carrito | Alta de artículo, total y persistencia tras recarga aprobados; carrito de prueba vaciado | Alta de artículo, total y persistencia tras recarga aprobados; carrito de prueba vaciado |
| WhatsApp | El botón respondió que falta un número válido; no abrió WhatsApp ni envió datos | El botón respondió que falta un número válido; no abrió WhatsApp ni envió datos |
| Administración | Login local aprobado; catálogo, edición de producto y apariencia persistente comprobados | Login local aprobado; catálogo y apariencia persistente comprobados |
| Persistencia | Cambio temporal de nombre/precio/color sobrevivió recarga y luego se restauró | Descripción demo y CTA corregidos; cambios persistieron tras recarga |

La preparación de pedido se probó hasta el control de envío. No se puede aceptar la redirección ni el mensaje final hasta configurar un número real del comercio. No se inventó ni se añadió un contacto.

## Aislamiento

- Los manifiestos declaran nombres/UUID D1 y puertos distintos. Cada tienda tiene su propio `worker/.wrangler/state/v3/d1/`, bucket local y archivo `worker/.dev.vars`.
- Los workers y frontends respondieron en sus cuatro puertos independientes. La configuración de frontend asigna a cada demo su slug y namespace de almacenamiento; además, los dos frontends usan orígenes/puertos distintos. Los inicios de sesión mostraron la cuenta admin de cada tienda.
- En Patitas se guardó temporalmente `Patitas Felices · Prueba Fase 7`, se subió el precio de `PF-DEMO-001` de 18.900 a 18.901 COP y se cambió el color primario. TecnoCell mantuvo `TecnoCell Accesorios`, `TC-DEMO-001` a 69.900 COP y su paleta tecnológica. Nombre, precio y color de Patitas se restauraron y se verificaron en su panel.
- Se subió una imagen PNG de prueba de 1 × 1 px al almacenamiento local de Patitas: `/api/assets/categories/1793577344692-fks3lj.png`. La vista previa de Patitas la decodificó (`naturalWidth=1`); la misma ruta en TecnoCell devolvió `Asset not found`. Se retiró la referencia de la categoría de Patitas después de probarla. El objeto permanece únicamente en el R2 local de Patitas; no reemplaza ninguna foto existente.
- Se hicieron copias previas del estado D1/R2. No se ejecutó reset, seed ni migración de reinicio. Las únicas escrituras de prueba fueron cambios explícitos en la tienda Patitas, corregir textos demo, la imagen de prueba y artículos temporales de carrito. Los valores temporales se restauraron y ambos carritos quedaron vacíos.

## Correcciones realizadas

- Se corrigió en ambas copias generadas la inicialización del carrito: ahora lee `localStorage` antes de persistir el primer estado, evitando que un array vacío reemplace el carrito guardado durante una recarga. La plantilla maestra no se modificó.
- Las imágenes de portada y categorías de los demos ahora vuelven al JPEG original si falla el WebP. Se modificaron únicamente las copias generadas para conservar intacta la plantilla maestra.
- Se guardó una descripción legible en Patitas y TecnoCell, y se corrigió el texto de botón `Ver catálogo` de TecnoCell. Las fuentes de seed/configuración generadas todavía contienen texto mojibake en algunos SQL; registrar y resolver ese defecto del generador antes de crear otras demos con acentos.

## Seguridad — bloqueos antes de producción

| Severidad | Hallazgo | Acción requerida antes de producción |
|---|---|---|
| **Crítica** | `worker/wrangler.toml` versiona credenciales de desarrollo de ejemplo; `worker/src/services/auth.ts` también define valores de respaldo si faltan variables. | Retirar defaults versionados, exigir secretos obligatorios y rotar credenciales en un procedimiento controlado antes de cualquier publicación. No se cambiaron credenciales durante esta fase. |
| **Crítica** | `JWT_SECRET` tiene un fallback fijo; la configuración de producción no demuestra que el secreto fuerte y credenciales propios sean obligatorios. | Fallar cerrado si faltan secretos y validar el entorno de producción antes de desplegar. |
| **Alta** | El frontend puede crear la sesión visual `demo-local` si falla la API. No es un JWT aceptado por el Worker, pero puede inducir a pensar que el admin está autenticado cuando el backend no está disponible. | Desactivar el fallback visual en modo conectado/producción y mostrar el error del backend. No se cambió arquitectura de autenticación. |
| **Media** | El JWT de sesión se guarda en `localStorage`; una futura vulnerabilidad XSS permitiría leerlo. | Revisar política de sesión/CSP y valorar cookie segura HttpOnly antes de usuarios reales. |
| **Pendiente de dato** | Los dos demos carecen de WhatsApp válido. | El propietario debe configurar el contacto real de cada negocio antes de aceptar pedidos. |

No se encontraron claves de Gemini o Telegram declaradas por el frontend en el código revisado. Los archivos `.dev.vars` no se imprimieron ni se añadieron a Git. Esta inspección no reemplaza una auditoría de producción.

## Pruebas automatizadas y builds

- Frontend: **42/42** pruebas en 12 archivos.
- Worker: **33/33** pruebas en 6 archivos; `npx tsc --noEmit` aprobado.
- `npm run build` aprobado en la plantilla base (sin cambios de esta fase) y en ambas copias generadas.
- Se conservaron capturas de los catálogos en `.tmp/phase7-validation-2026-11-01/`.

## Aprobación y límites

Las dos tiendas abren y permiten navegar el catálogo, iniciar sesión, editar y conservar configuración, agregar artículos y mantenerlos tras recargar. El aislamiento local probado se mantiene. WhatsApp real está **bloqueado** hasta ingresar un número válido. Los riesgos críticos de autenticación impiden tratar estas demos/configuración actual como listas para producción. No se hicieron acciones remotas, no se desplegó y SneakerHub Premium permaneció intacto.

## Revalidación de navegador — Fase 8 (2026-11-01)

- **Patitas Felices:** `http://127.0.0.1:5283/`, Worker `http://127.0.0.1:8898/`. El Worker respondió en salud/productos; el home mostró 3 productos y 3 categorías. Las fotos principales de los 3 productos y la portada decodificaron en navegador. `/product/PF-DEMO-001` mostró SKU, precio, variante, stock y foto.
- **TecnoCell Accesorios:** `http://127.0.0.1:6081/`, Worker `http://127.0.0.1:9696/`. El home mostró 4 productos y 4 categorías con tema tecnológico; 4/4 fotos de producto y la portada decodificaron. `/product/TC-DEMO-001` mostró SKU y foto.
- Ambos storefronts muestran el copy CTA de su preset. Los formularios `/admin/login` presentan su marca y requieren sesión válida del Worker; no se enviaron credenciales ni se editaron productos/apariencia en esta pasada.
- “Pedir por WhatsApp” en una ficha de cada tienda mostró que falta un teléfono válido. No abrió WhatsApp, no envió datos ni creó un pedido.
- No se cambiaron productos, carrito, apariencia, D1/R2 ni credenciales en esta pasada. El frontend puede sincronizar su marcador interno de versión al abrirse. La comprobación interactiva previa del carrito, administración y aislamiento se conserva como evidencia de Fase 7; las regresiones consolidadas pasan ahora en frontend 52/52 y Worker 39/39.
- La primera recarga de Patitas expuso una pantalla vacía cuando un tema antiguo no incluía `cta`. Se corrigió la normalización en plantilla y demos; la recarga posterior mostró el home completo con el CTA de su preset. El de TecnoCell también se leyó de su configuración local de preset.
- Los cuatro servicios responden en puertos locales distintos. No se crearon recursos remotos ni se desplegó. Dos intentos de generar una instalación nueva fallaron en D1 local (primero `fetch failed`, luego error interno al migrar); el origen no se determinó y ambos staging se limpiaron sin destino/registro. Ver [`GENERADOR_DEMOS.md`](GENERADOR_DEMOS.md) y [`FASE8_SEGURIDAD.md`](FASE8_SEGURIDAD.md).
