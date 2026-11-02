# Preparación GitHub + Netlify — SneakerHub Premium

## Netlify

El archivo `netlify.toml` configura:

- Base: `frontend/`
- Build command: `npm run build`
- Publish directory: `dist` (relativa a la base)
- Fallback SPA: `/*` → `/index.html` con estado 200, para que React Router resuelva rutas profundas.
- Modo público: `VITE_PUBLIC_DEMO=true`, configurado en `netlify.toml`.

Conecta el repositorio existente `fastjobmx/catalogo-digital-lite` a Netlify y conserva la rama de producción que el equipo decida (la rama actual es `main`). No uses Netlify Drop. El lockfile está en `frontend/package-lock.json`, por lo que Netlify instalará las dependencias del frontend desde esa base.

### Variables públicas de build

El frontend reconoce `VITE_API_URL`, `VITE_ALLOW_DEMO_AUTH`, `VITE_INDEPENDENT_INSTALLATION`, `VITE_STORE_SLUG` y `VITE_PUBLIC_DEMO`. Para la vista previa segura conserva `VITE_PUBLIC_DEMO=true`, deja `VITE_API_URL` sin definir y no configures `VITE_ALLOW_DEMO_AUTH`. No configures secretos del Worker con prefijo `VITE_`: Vite incorpora las variables `VITE_*` al bundle público. `VITE_API_PROXY` solo es para el servidor de desarrollo Vite y no debe configurarse en Netlify.

## Estado de API y vista previa

No hay un backend comercial de producción verificado para esta publicación. El Worker principal tiene un `database_id` de marcador local; el Worker staging representa datos ficticios y no debe usarse para ventas. Tampoco se debe conectar un backend de staging como API de producción.

El modo público no solicita `/api/*`, no lee configuración ni productos de `localStorage`, fuerza el catálogo ficticio empaquetado, rechaza login y redirige `/admin/*` a la tienda. El fallback SPA sirve `index.html` para rutas profundas.

Funciones que requieren un backend comercial real y permanecen desactivadas en esta vista previa:

- Inicio de sesión administrativo real y persistencia de productos, categorías y apariencia.
- Guardado de pedidos en D1, inventario real y administración de pedidos.
- Subida y almacenamiento de imágenes en R2.
- Telegram, webhook y agente Gemini.

La demo se identifica con el aviso “DEMO · Catálogo de muestra. No se aceptan pedidos ni pagos.” Permite explorar productos y agregarlos al carrito local, pero no muestra acciones de WhatsApp, formularios de datos de entrega ni enlaces de contacto. No la presentes como tienda transaccional.

Para activar operaciones reales en una publicación futura se necesita aprovisionar y auditar un Worker comercial con su D1/R2 propios, dominio/orígenes CORS exactos y secretos en el almacén seguro del Worker; luego configura únicamente la URL pública HTTPS en `VITE_API_URL` y verifica los flujos antes de cambiar el estado de la publicación. No incluyas credenciales en GitHub, Netlify variables públicas ni el bundle.

## Seguridad del repositorio

Antes de crear un commit, revisa explícitamente cada ruta en `git status` y usa `git add <rutas>` con la lista aprobada; no uses `git add .`. Mantén fuera archivos `.dev.vars*` (salvo plantillas vacías), `.env.local`, `.wrangler/`, `.tmp/`, `node_modules/`, bases de datos, respaldos, tokens y datos locales de clientes. Revisa también cada archivo nuevo, diff e historial Git. No publiques el repositorio hasta que la auditoría de secretos esté limpia; si una credencial aparece en el historial, rótala antes de compartirlo.
