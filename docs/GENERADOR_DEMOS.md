# Generador local de demos

## Estado

`scripts/new-store.ps1` crea una instalación local nueva y aislada. Acepta
`-Mode demo`, temas `auto`, `default`, `pet-soft` y `tech-minimal`, y semillas
`None`, `PatitasFelices` y `TecnoCellAccesorios`. Las dos semillas aplican
catálogo, categorías, variantes, configuración comercial, tema e imágenes
locales verificadas en una D1 exclusiva de la tienda.

El valor `production` se rechaza antes de escribir; todavía no existe
aprovisionamiento remoto.

## Requisitos

- Windows PowerShell 5.1.
- Node.js/npm y las dependencias de Wrangler instaladas en `worker/` con
  `npm ci`.
- El repositorio maestro en una ruta local que permita Wrangler ejecutar D1
  `--local`.

El generador aplica las migraciones con `wrangler d1 migrations apply` y una
carpeta `database/migrations` separada de los SQL de configuración y seed. Esto
permite que Wrangler descubra únicamente los tres archivos versionados y registre
sus nombres en `d1_migrations`. Cada llamada usa `--local`, el config del staging
y un `--persist-to` absoluto. Se invoca el `npx.cmd` local con `--no-install` para
evitar que una dependencia faltante descargue otro Wrangler.

En la matriz disponible, PowerShell 5.1.26100.9711, Node 26.8.1 y Wrangler
4.156.0 completaron tres generaciones consecutivas (vacía, Patitas y TecnoCell).
Las consultas D1 confirmaron ledger, configuración y conteos de catálogo; los
hashes de fotos coincidieron con el manifiesto. El `fetch failed` bajo el sandbox
coincidió con `EACCES` de loopback; con acceso local ampliado, los flujos D1
locales pasaron. El `internal error` histórico de Wrangler no se atribuye a una
causa definitiva. La matriz alternativa y `npm ci` quedaron bloqueados por
`ENOTFOUND registry.npmjs.org`; por ello las copias generadas no se compilaron ni
se probaron con login/API en esta fase. Ver [`FASE82_ESTABILIDAD.md`](FASE82_ESTABILIDAD.md)
y el historial de [`FASE81_GENERADOR_ESTABLE.md`](FASE81_GENERADOR_ESTABLE.md).

## Comandos

Antes de crear una instalación, comprobar la serialización UTF-8 con la misma
lectura, escape SQL, escritura y generación del módulo CTA por preset que usa
el generador (Windows PowerShell 5.1):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-generator-encoding.ps1
```

El test escribe y retira un SQL temporal bajo `.tmp`; no crea tiendas ni toca D1/R2.

Desde la raíz del repositorio, primero muestra el plan sin crear archivos:

```powershell
.\scripts\new-store.ps1 `
  -StoreName "Patitas Felices" `
  -Slug "patitas-felices" `
  -BusinessType "Mascotas" `
  -Theme "auto" `
  -Mode "demo" `
  -Seed "PatitasFelices" `
  -DryRun
```

Después crea la demo:

```powershell
.\scripts\new-store.ps1 `
  -StoreName "Patitas Felices" `
  -Slug "patitas-felices" `
  -BusinessType "Mascotas" `
  -Theme "auto" `
  -Mode "demo" `
  -Seed "PatitasFelices"
```

Para crear TecnoCell, usa `-StoreName "TecnoCell Accesorios"`,
`-Slug "tecnocell-accesorios"`, `-BusinessType "Accesorios para celulares y
tecnología"` y `-Seed "TecnoCellAccesorios"`. El tema `auto` selecciona
`pet-soft` o `tech-minimal` según la semilla. Cada slug recibe puertos y D1
locales separados. Un `Destination` relativo o absoluto puede elegir otra
carpeta, pero debe ser un hijo directo de `local-stores`.

## Qué crea

- `frontend/` y `worker/` con código reutilizable, sin tests del template ni
  `.git`. Solo copia los assets listados en la carpeta del preset seleccionado;
  no carga fotos sin procedencia.
- `database/` con las tres migraciones, SQL de identidad y, cuando se elige un
  preset, su JSON de configuración/tema y SQL de catálogo. Nunca llama a los
  seeds heredados de SneakerHub o Maison Lumière.
- `worker/wrangler.toml` con base/bucket locales, nombre, puertos y origen
  permitido para esa tienda.
- `worker/.dev.vars` con email, contraseña y JWT aleatorios. Los valores no se
  imprimen y el `.gitignore` copiado excluye el archivo.
- `frontend/.env.local` que activa el scope de instalación y separa las claves
  de carrito, sesión, apariencia, onboarding y catálogo local por slug. El modo
  independiente desactiva el catálogo SneakerHub de respaldo.
- `frontend/src/data/storePresetCta.ts` con el CTA del tema seleccionado. El
  archivo se genera por instalación y no lleva contenido de demos al template
  maestro; con `Seed None` queda en `null` y el CTA se edita desde Apariencia.
- `manifest.json` con identidad, slug, tipo, tema, modo, seed, commit maestro,
  UUID D1 local, puertos, conteos y SHA-256 de migraciones y assets; no contiene
  secretos.
- `local-stores\registry.json`, actualizado después de completar y mover la
  instalación desde staging.

## Arranque

Cada destino contiene un `README-LOCAL.md` con las URLs y comandos. El arranque
se hace en dos ventanas de PowerShell:

```powershell
Set-Location .\local-stores\patitas-felices\worker
npm ci
npm run dev
```

```powershell
Set-Location .\local-stores\patitas-felices\frontend
npm ci
npm run dev
```

Con `-Seed None` la tienda se inicia vacía. Los presets incluyen precios y
stock ficticios y tienen notas `verifyBeforeSale`; confirma cada producto real
y reemplaza las fotos ilustrativas antes de vender. Si el backend está
desconectado, el modo independiente no carga productos, contactos ni identidad
de SneakerHub.

## Límites de seguridad

Para guardar eventos de Wrangler (sin secretos) en `.tmp/generator-diagnostics/`
durante una ejecución:

```powershell
.\scripts\new-store.ps1 `
  -StoreName "Tienda de prueba" `
  -Slug "tienda-de-prueba" `
  -BusinessType "Comercio general" `
  -Mode demo `
  -Seed None `
  -Theme default `
  -Diagnostic
```

La prueba de falla controlada del proceso externo se ejecuta con:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-generator-wrangler.ps1
```

- El generador nunca usa `--remote` y no ejecuta `setup.ps1`, `reset-db.ps1`,
  `deploy.ps1` ni scripts de seed.
- Rechaza destinos existentes, slugs registrados, nombres inválidos, destinos
  fuera de `local-stores`, producción y opciones de tema/seed no implementadas.
- `-DryRun` informa rutas, puertos y recursos locales previstos sin escribir.
- Una reejecución con el mismo slug termina sin alterar una instalación.
- Las dependencias no se copian; `npm ci` debe ejecutarse dentro de cada
  destino. La instalación desde el registro npm requiere acceso de red.
