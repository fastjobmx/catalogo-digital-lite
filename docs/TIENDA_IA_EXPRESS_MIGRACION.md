# Migración de marca a Tienda IA Express — informe (2026-11-05)

Publicado el 2026-11-05 con autorización (ver §7). MOSTRALO PUES! quedó sin ningún cambio: sigue siendo su propio proyecto `mostralopues`, sin redirecciones.

## 1. Arquitectura encontrada

- **Sitio comercial:** `apps/mostralopues-landing`.
  - React + Vite, contenido prerenderizado.
  - Proyecto de Cloudflare Pages `mostralopues`, publicado a mano con `npm run cf:deploy` y `--project-name`.
  - Sin Git conectado ni publicación automática.
- **Plataforma:**
  - Worker `catalogo-digital-ia`, que sirve el panel y los catálogos (Static Assets) y pasa `/api/*` al backend `catalogo-lite-api`.
  - Un solo `index.html` para todas las tiendas, con título y descripción fijos de «SneakerHub Premium». Por eso, **al compartir cualquier tienda por WhatsApp o Facebook aparecía SneakerHub**: los navegadores cambiaban el título después, pero los robots que generan las vistas previas no ejecutan JavaScript.
  - Inicio de sesión, activación y restablecimiento usaban el nombre, el logo y los colores de cada tienda.
  - El pie de todos los catálogos decía «Hecho con Catálogo Digital Lite»; es un único componente compartido.
- **Nombre `tiendaiaexpress`:** en la cuenta solo existe el proyecto `mostralopues`, y `tiendaiaexpress.pages.dev` no responde (no hay DNS). Parece libre, pero la disponibilidad definitiva se confirma al crear el proyecto. Si Cloudflare asigna otro subdominio, se informa y no se publica.

## 2. Archivos

**Nuevo sitio:** `apps/tiendaiaexpress-landing/`, una copia completa. Cambios respecto del original:
- `wrangler.jsonc` y `package.json`: proyecto `tiendaiaexpress`.
- `vite.config.ts`: URL del sitio.
- `src/styles/global.css`: paleta verde oscuro, lima y morado.
- `src/assets/brand/*` y `public/*`: logo, ícono, favicon, `og.png` y `site.webmanifest`.
- `index.html`: título, descripción, Open Graph, Twitter Card, manifest y datos estructurados de la organización y el sitio web.
- Textos en `config/site.ts`, `Story.tsx`, `Footer.tsx`, `Nav.tsx`, `Commerce.tsx` y `Contact.tsx`.
- Nueva sección `sections/Trial.tsx`.
- Pruebas actualizadas.

**Marca original:** `brand/tiendaiaexpress/tiendia-expres-original.webp`.

**Plataforma, nuevos:**
- `frontend/public/brand/tiendaiaexpress/*`
- `frontend/src/lib/platformBrand.ts`: configuración única de la marca.
- `frontend/src/admin/PlatformAuthShell.tsx`
- `frontend/src/components/PlatformAttribution.tsx`
- `frontend/cloudflare/worker.test.ts`

**Plataforma, modificados:**
- `frontend/cloudflare/worker.js`: metadatos correctos por página.
- `frontend/wrangler.jsonc`: las páginas pasan por el servidor; los archivos estáticos no.
- `frontend/index.html`: valores por defecto neutros.
- Pantallas `LoginPage`, `ActivationPage`, `ResetPasswordPage` y `VerifyEmailPage`.
- `AdminLayout`, `PlatformPage`, `PlatformEmailPage`, `Footer` y `TrialPage`.
- `worker/src/email/templates.ts` y `send.ts`: las plantillas del sistema sin editar adoptan la nueva marca; las editadas se respetan.
- `worker/src/services/master/bot.ts`: textos de la plataforma.

## 3. Identidad

- **Plataforma:**
  - Nombre público: «Tienda IA Express»; logo: «TiendIA Exprés».
  - Aparece en el inicio de sesión, la activación, el restablecimiento de contraseña, la verificación de correo, la cabecera de Plataforma, la barra lateral del panel, los correos y el bot maestro.
- **Tiendas:** conservan su nombre, logo, colores, productos y URL.
  - En el inicio de sesión, la tienda aparece solo como contexto secundario («Tienda: Luz Mágica»).
- **Atribución:** «¿Quieres una tienda como esta? Créala con **TiendIA Exprés**.».
  - Está en el pie de **todas** las plantillas, incluida Stories, mediante un único componente.
  - El enlace lleva a `https://tiendaiaexpress.pages.dev/` con parámetros `utm_` y el evento `platform_attribution_click`, sin servicios externos de seguimiento.
  - No existe marca blanca en los planes, así que no hay nada que conservar al respecto.
- **Metadatos:**
  - Cada catálogo y cada producto muestra su propio título, descripción e imagen al compartirse.
  - El panel, Plataforma y `/prueba` usan «Tienda IA Express | Acceso al panel administrativo», con `noindex`.

## 4. Pruebas

- **Nuevo sitio:** 20 de 20 en celular y computador, sin desborde horizontal.
- **Panel:** 81 de 81, con `build` correcto. Hay 3 pruebas nuevas de metadatos.
- **Servidor:** 308 de 308.
- **Servidor del panel en local, con los datos reales (solo lectura):**
  - Cada tipo de página muestra los metadatos correctos: SneakerHub, Luz Mágica, MUY PARCERO, productos, inicio de sesión, Plataforma y `/prueba`.
  - Los archivos estáticos responden 200.
  - Navegador 12 de 12: inicio de sesión con la nueva marca en computador y celular, atribución presente y SneakerHub con su identidad.
  - Pedido por WhatsApp 9 de 9 y Stories 10 de 10.
- **MOSTRALO PUES!:** 0 archivos cambiados, y el sitio en vivo mantiene su título original.

## 5. Para publicar (requiere autorización)

1. **Sitio nuevo:** primero `node worker/node_modules/wrangler/bin/wrangler.js pages project create tiendaiaexpress --production-branch main --force`; después `cd apps/tiendaiaexpress-landing; npm run cf:deploy`.
2. **Backend** (correos y bot maestro): `cd worker; npx wrangler deploy --config wrangler.production.toml`.
3. **Panel y catálogos:** `cd frontend; npm run deploy:cloudflare`.
4. **Verificación:** vistas previas al compartir, inicio de sesión, atribución, WhatsApp y que `mostralopues.pages.dev` no cambió.

**Reversión:**
- Panel: `wrangler rollback d5992e6a-b337-490f-afea-7e1248861b1c`.
- Backend: `wrangler rollback 5404beca-1c7d-4085-97f6-e6aaa020cd84 --config wrangler.production.toml`.
- Sitio nuevo: borrar el proyecto `tiendaiaexpress`, que no afecta a `mostralopues`.

## 6. Pendientes de decisión

- **Redes sociales del nuevo sitio:** hoy enlazan a las cuentas de MOSTRALO PUES!. Hay que confirmar si serán las mismas o pasarme las nuevas.
- **Indexación del nuevo sitio:** `noindex` por defecto, igual que el original, o indexable con URL canónica y sitemap.
- **Registro real por correo** («Crear cuenta»): no existe. Las tiendas se crean con el bot maestro o desde Plataforma, por eso «Crear mi tienda» lleva al formulario de contacto y a WhatsApp. El autorregistro necesita además el proveedor de correo.

## 7. Publicación (2026-11-05, autorizada)

- **Proyecto de Cloudflare Pages `tiendaiaexpress`:** se creó con exactamente `tiendaiaexpress.pages.dev`.
  - Despliegue `58416866`.
  - Por ahora queda fuera de los buscadores (`noindex`) y con las redes sociales de MOSTRALO PUES!, hasta que se decidan.
- **Servidor** `catalogo-lite-api`: `5404beca` → `13561c72-c636-4468-9319-190a4bf7c8c7`. Los 10 secretos siguen intactos.
- **Panel y catálogos** `catalogo-digital-ia`: `d5992e6a` → `6d69c245-d4c4-4cb6-9d3b-f78a261d46cd`.
- **Verificación en vivo:**
  - Sitio nuevo: 20/20.
  - MOSTRALO PUES!: 20/20, con su título y sin redirección.
  - Marca de la plataforma: 12/12.
  - Pedido por WhatsApp: 9/9.
  - Stories: 10/10.
  - Metadatos por tienda y producto correctos.
  - Los webhooks de los bots siguen protegidos.
