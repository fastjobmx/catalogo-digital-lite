# Instalación independiente de una tienda

El generador local produce un proyecto autónomo por comercio. Cada instalación
tiene su propio Worker local, base D1 persistida dentro de su carpeta, puertos,
credenciales administrativas y manifiesto. Actualmente solo se permite modo
`demo`; producción y recursos Cloudflare no se aprovisionan.

## Crear una demo

Desde la raíz del repositorio, prueba primero con `-DryRun`:

```powershell
Set-Location 'D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite'
.\scripts\new-store.ps1 -StoreName 'Patitas Felices' -Slug 'patitas-felices' -BusinessType 'Mascotas' -Theme auto -Mode demo -Seed PatitasFelices -DryRun
```

Al retirar `-DryRun`, el generador crea `local-stores\patitas-felices` y
registra la instalación en `local-stores\registry.json`. Para TecnoCell:

```powershell
.\scripts\new-store.ps1 -StoreName 'TecnoCell Accesorios' -Slug 'tecnocell-accesorios' -BusinessType 'Accesorios para celulares y tecnología' -Theme auto -Mode demo -Seed TecnoCellAccesorios
```

El generador rechaza destinos existentes o slugs ya registrados. Para otra
instalación, asigna un slug nuevo. No borres una demo si necesitas conservar su
base local o revisar sus pedidos de prueba.

## Arrancar la tienda

En dos ventanas de PowerShell, usa la ruta correspondiente a la instalación:

```powershell
Set-Location '.\local-stores\patitas-felices\worker'
npm ci
npm run dev
```

```powershell
Set-Location '.\local-stores\patitas-felices\frontend'
npm ci
npm run dev
```

Abre la URL `frontendPort` que aparece en `manifest.json`. Vite envía `/api` al
puerto `workerPort`. Los valores cambian por slug. El correo y la contraseña
locales de administración están en `worker\.dev.vars`; no los subas a Git ni
los compartas con otra tienda. Cada `.dev.vars` es distinto.

## Datos y personalización

- La semilla elegida solo se aplica a la D1 recién creada para esa instalación.
- `-Seed None` deja el catálogo vacío; los seeds comerciales son ejemplos.
- Los archivos `business.json`, `theme.json`, `catalog.sql` y `assets.json` se
  copian a `database\seed-presets\<preset>` para dejar reproducible la base.
- El catálogo guarda referencias de fotos servidas desde el `frontend/public`
  propio de la instalación. No usa el R2 ni archivos de SneakerHub.
- El administrador puede continuar la configuración desde onboarding,
  Apariencia, Contacto y Productos. Las fotos y datos del seed se deben
  confirmar o reemplazar antes de vender.
- `manifest.json` registra el UUID local de D1, tema, conteos, puertos, commit,
  hashes de migraciones y fotos, además de la procedencia de las fotos. No
  guarda las claves administrativas.

La app independiente evita cargar el catálogo SneakerHub de respaldo cuando
la API local no está disponible. También separa las claves de sesión, carrito,
apariencia, onboarding y catálogo local por slug.

## Verificación local

```powershell
Invoke-RestMethod 'http://127.0.0.1:<workerPort>/api/health'
Invoke-RestMethod 'http://127.0.0.1:<workerPort>/api/products'
```

Revisa que el conteo de productos y categorías coincida con `manifest.json`,
que las imágenes tengan `naturalWidth > 0` en el navegador y que una operación
de prueba en una tienda no aparezca en la otra. La separación de recursos
remotos es una fase futura; no configures producción con el instalador local.
