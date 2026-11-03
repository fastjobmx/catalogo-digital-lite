# Pruebas visuales — SneakerHub Premium (Fase 1)

Sitio: `catalogo-lite`  
Entorno: Windows / PowerShell, Worker en `http://127.0.0.1:8788`, frontend en `http://localhost:5173`.

## 1. Lo que se verificó realmente

| Prueba | Resultado | Cómo se verificó |
|---|---|---|
| Compilación frontend (`tsc --noEmit`) | ✅ 0 errores | `npx tsc --noEmit` en `frontend` |
| Pruebas frontend | ✅ 52 / 52 en 16 archivos | `npx vitest run` en `frontend` |
| Compilación Worker (`tsc --noEmit`) | ✅ 0 errores | `npx tsc --noEmit` en `worker` |
| Pruebas Worker | ✅ 23 / 23 en 3 archivos | `npx vitest run` en `worker` |
| Carga de home sin errores de consola | ✅ 0 errores | Navegador en `http://localhost:5173/`, consola nivel error vacía |
| API de productos sirve 18 productos | ✅ HTTP 200 | `GET http://127.0.0.1:8788/api/products` → 18 filas |
| API de categorías sirve 5 categorías | ✅ HTTP 200 | `GET http://127.0.0.1:8788/api/categories` → 5 filas |
| API de tienda devuelve paleta por defecto | ✅ | `GET /api/store` → `palette` con `#F7F6F2` / `#FFFFFF` / `#171717` / `#222222` / `#8D806D`, hero `/seed-images/sneakerhub/hero-editorial.jpg` |
| Imágenes de producto locales existen | ✅ | 18 archivos JPEG en `frontend/public/seed-images/sneakerhub/` decodificados |
| Hero y promo usan archivos locales válidos | ✅ | `hero-editorial.jpg` y `TERA-15.jpg` presentes y decodificados |
| Seed idempotente aplicado a D1 local | ✅ | `wrangler d1 execute --local --file database/seeds/demo-store.sql` → éxito |

## 2. Lo que NO se pudo verificar en este sesión

### Capturas de pantalla a 375 / 390 / 768 / 1024 / 1440 px ❌

**Bloqueador real:** la herramienta de control del navegador (`browser.screenshot`) requiere una pestaña visible en una ventana de escritorio, y este entorno no provee una ventana de navegador visible. Cada intento devolvió:

> `Screenshot needs a visible tab. Call browser.tabs.focus and keep its desktop window visible.`

Por tanto **no existen capturas a ningún ancho**, ni a los breakpoints requeridos (375, 390, 768, 1024, 1440 px). No se afirma validación visual manual en esas resoluciones.

### Persistencia remota en D1 desde `/admin/apariencia` ❌

No se abrió una sesión de administrador conectada, por lo que no se comprobó que el tema guardado viaje a `PUT /api/admin/store` y se lea de vuelta desde la API. En modo demo el tema se guarda en `localStorage` (verificado por el código), pero la ruta remota no fue probada en vivo.

### Render React en vivo y HTTP de las 18 fotos ❌

Las llamadas a `localhost` (127.0.0.1:5173 y :8788) fueron denegadas por permisos de socket en este entorno en varios momentos, por lo que no se obtuvo `currentSrc`, `naturalWidth`, opacidad, estado de skeleton ni errores de consola por cada imagen a través del navegador. Se confirmó a nivel de archivo que los 18 JPEG existen y decodifican, y a nivel de API que `/api/products` devuelve las 18 filas con sus URLs locales.

## 3. Cómo completar las pruebas visuales (pendiente, equipo local)

Desde una máquina con navegador accesible y sin bloqueo de sockets en localhost:

1. Inicia Worker y frontend (comandos en `docs/STREETWEAR_PREMIUM.md`).
2. Abre `http://localhost:5173/` y captura a **375, 390, 768, 1024 y 1440 px** de ancho:
   - Home completa (hero, categorías, rails, beneficios, contacto, footer).
   - Header: topbar, menú móvil (abrir/cerrar, Escape), buscador, carrito.
   - Hero: alineación izquierda/centro/derecha, overlay, altura compacta/estándar/amplia, foto móvil.
   - Menú móvil y drawer: foco, cierre con Escape/fondo/botón.
3. Abre `http://localhost:5173/admin` → Apariencia y verifica:
   - Cambio de paleta se refleja en la vista previa y en el storefront tras recargar.
   - Presets aplican sin tocar productos.
   - Guardar y restaurar funcionan.
4. Ejecuta de nuevo `npx tsc --noEmit` (ambos) y `npx vitest run` (ambos) tras cualquier ajuste visual.
5. Documenta aquí los resultados con capturas y anota cualquier desbordamiento, texto cortado, imagen deformada o botón inaccesible.

## 4. Comandos de referencia

```
# Worker
cd D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\worker
npx wrangler dev --port 8788
npx tsc --noEmit
npx vitest run

# Frontend
cd D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\frontend
npx vite --port 5173
npx tsc --noEmit
npx vitest run
```

## 5. Documentación relacionada

- `docs/STREETWEAR_PREMIUM.md` — alcance del tema y archivos modificados.
- `docs/GUIA_PERSONALIZACION.md` — cómo editar desde el administrador.
- `docs/ASSETS_DEMO.md` — imágenes demo, autor, fuente y licencia.
- `docs/PENDIENTES.md` — trabajo no completado (incluye revisión visual a 375–1440 px).
- `PROGRESO.md` — estado por fase y evidencia de lo verificado.
