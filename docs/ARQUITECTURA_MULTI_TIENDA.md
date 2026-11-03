# Arquitectura de instalaciones independientes

> **Actualización 2026-11-03:** la plataforma 3.0 adopta multitenencia compartida (un Worker, una D1 y un R2 con `store_id`). Este documento describe el enfoque anterior de instalaciones independientes, que se conserva para clientes que exijan infraestructura propia. Ver [`PLATAFORMA_3_0.md`](PLATAFORMA_3_0.md).


## Alcance de esta fase

Este documento registra la auditoría de Catálogo Lite y fija los límites para
el generador local. La primera implementación se limitará a instalaciones
locales `demo`. El aprovisionamiento Cloudflare y los despliegues quedan fuera
de esta fase.

## Auditoría del estado actual

- El repositorio contiene una SPA React/Vite/TypeScript (`frontend/`) y una API
  Hono para Cloudflare Workers (`worker/`). El Worker recibe una única binding
  D1 (`DB`) y una binding R2 (`ASSETS`).
- El frontend obtiene la identidad y el tema por `GET /api/store`; la fila
  `store_config` guarda colores, datos de contacto y `theme_config`. El
  personalizador ya escribe esa configuración mediante el API. No hace falta
  editar componentes React para cambiar identidad o apariencia.
- La selección del backend del frontend usa `VITE_API_URL`; Vite reenvía `/api`
  al Worker local. `wrangler.toml` define el nombre del Worker, la D1 y el bucket.
- El estado local de Wrangler se encuentra bajo `worker/.wrangler`. Las nuevas
  demos deben tener directorios Worker distintos para mantener separada su D1
  local. No se debe ejecutar `setup.ps1` ni `reset-db.ps1` como parte del
  generador: ambos operan sobre la instalación principal.
- Las migraciones existentes son `0001_initial.sql`, `0002_agent.sql` y
  `0003_theme.sql`. La configuración de tienda tiene `id=1`; categorías,
  productos y variantes están ligados por claves foráneas y SKU.
- El tema vive en la configuración D1. Las fotos de catálogo SneakerHub y
  TecnoCell hoy están en `frontend/public/seed-images/`; las fotos públicas
  copiadas a una demo no son privadas. En producción, el Worker usa R2 para
  medios subidos desde el panel.
- El modo independiente agrega namespace de slug a `localStorage` y deja vacíos
  el catálogo local y los datos de contacto de respaldo de SneakerHub. La
  importación del catálogo SneakerHub es dinámica para que no se incluya en el
  bundle de una instalación que lo desactiva.
- La autenticación administrativa se configura por bindings/secrets del
  Worker. `worker/wrangler.toml` contiene credenciales locales de demostración,
  y `worker/src/services/auth.ts` también tiene valores de respaldo. Estos
  valores no se deben copiar a una tienda instalable ni aceptar como
  configuración de producción. La fase Cloudflare debe exigir secretos
  propios y validar que no sean valores de ejemplo.
- Hay dos seeds existentes, pero ninguno es seguro para una base con datos
  comerciales: `demo-store.sql` actualiza `store_config`, actualiza categorías
  por slug y elimina los SKU de su catálogo demo antes de reinsertarlos;
  `boutique-demo.sql` borra tablas enteras. El nuevo generador no debe llamar a
  esos seeds. Cada seed futuro será explícito, exclusivo de su preset y
  destinado a una D1 recién creada para esa demo.
- `docs/CREAR_NUEVA_TIENDA.md` describe una duplicación manual y comandos
  remotos de Cloudflare que incluso permiten aplicar el seed SneakerHub en D1
  remota. Debe considerarse una guía heredada y no es el procedimiento de la
  primera fase.

## Plano de instalación

La plantilla maestra es este repositorio en un commit conocido. El generador
creará destinos independientes a partir de una lista permitida de código y
recursos; no copiará `.git`, `.tmp`, `node_modules`, `dist`, `.wrangler`,
archivos `.env`, secretos ni datos locales de la tienda maestra.

Cada destino tendrá sus propios:

1. archivos de configuración de tienda y tema;
2. estado D1 local y registro de migraciones;
3. datos demo de categorías, productos y variantes;
4. archivos demo autorizados y manifiesto de procedencia;
5. credenciales de desarrollo generadas para esa instalación, guardadas solo
   en un `.dev.vars` local ignorado por Git;
6. binding de base de datos y, cuando se prepare la fase remota, bucket,
   Worker, secretos y proyecto Pages.

El código React/Worker será común como plantilla de código fuente, pero cada
destino será un proyecto local autónomo y no una aplicación SaaS con datos
compartidos. `manifest.json` registrará al menos el identificador de formato,
nombre, slug, tipo de negocio, tema/preset, modo, versión o commit de plantilla,
migraciones y seed aplicados, huellas de recursos copiados y estado de
verificación. No guardará contraseñas, JWT ni tokens. El generador no imprimirá
los valores secretos; mostrará dónde quedaron guardados localmente.

## Flujo seguro previsto para `new-store.ps1`

1. Aceptar nombre, slug, tipo de negocio, tema, modo y destino; en la primera
   fase implementada, rechazar cualquier modo distinto de `demo`.
2. Validar los valores y normalizar el slug. Resolver el destino absoluto y
   rechazar rutas fuera de la raíz de demos acordada, destinos existentes,
   rutas que contengan la plantilla maestra y rutas con estado de Wrangler.
3. En `-DryRun`, mostrar rutas, archivos y pasos previstos sin crear carpetas,
   ejecutar Wrangler ni modificar el registro.
4. Preparar un staging temporal dentro del directorio padre del destino,
   copiar la allowlist de fuentes, escribir configuración por tienda y generar
   una credencial aleatoria local que no provenga de la plantilla.
5. Inicializar D1 local dentro del Worker del destino; aplicar las tres
   migraciones en orden y solo el seed explícitamente seleccionado. Fallar si
   el destino no está vacío o si Wrangler intenta usar remoto.
6. Copiar únicamente medios declarados por el preset y comprobar que cada
   archivo exista y que sus huellas coincidan con el manifiesto.
7. Ejecutar verificaciones locales de configuración, esquema, separación de
   ruta D1, SKU/categorías esperados y credenciales distintas.
8. Escribir el manifiesto y registrar la instalación solo al terminar. Si falla
   antes del commit local, retirar exclusivamente el staging creado por esta
   ejecución; nunca borrar destinos preexistentes ni recursos remotos.

La reejecución con un slug ya registrado debe terminar sin cambiar archivos.
Una reinstalación será una acción distinta y explícita que requiera validar la
huella/identificador de la instalación destino antes de reemplazarla.

## Presets y medios

Los presets serán datos declarativos, no ramas nuevas de la aplicación. Cada
uno podrá definir nombre demo, colores, tipografía, portada, orden de
secciones, categorías, productos de ejemplo y lista de medios autorizados.
Los datos de la tienda y el catálogo se mantendrán en archivos separados.
Una tienda real empezará sin seed de productos salvo selección explícita.

Estado observado de medios: se encontraron 69 imágenes entre SneakerHub y
TecnoCell y las 69 se pudieron abrir y verificar como JPEG/WebP localmente.
Hay 21 archivos SneakerHub (18 imágenes de productos y 3 recursos de marca o
promoción) y 27 archivos TecnoCell. Esto verifica archivos en disco, no
respuesta HTTP ni render del navegador. La procedencia de algunas imágenes
SneakerHub sigue sin confirmarse en `docs/ASSETS_DEMO.md`; esas imágenes no
deben incluirse en presets comerciales hasta resolver sus derechos. No se
hallaron fotografías locales de Patitas Felices.

## Puertas antes de avanzar

- El generador de Fase 2 queda limitado a modo demo local y usa rutas D1
  diferentes por instalación. No invoca `deploy.ps1`, `setup.ps1`,
  `reset-db.ps1`, seeds existentes ni opciones `--remote`.
- La Fase 2 completada entrega solo identidad y esquema; no es todavía una
  tienda demo con productos. Ver [`GENERADOR_DEMOS.md`](GENERADOR_DEMOS.md).
- Crear Patitas Felices y TecnoCell Accesorios en destinos nuevos, comprobar
  sus archivos y configuraciones diferentes, y verificar que los dos estados
  D1 queden bajo rutas independientes antes de considerarla terminada.
- La Fase 3 deberá redactar seeds nuevos y revisar sus SKU/medios. Hasta
  entonces no se cargan productos para esos comercios.
- Antes de producción se requiere retirar valores de respaldo de autenticación,
  exigir configuración segura, revisar el aislamiento de R2 y preparar un
  flujo remoto separado con confirmación explícita. No se crearán recursos
  Cloudflare en las primeras fases.

## Evidencia de la auditoría

- Git: rama `main`, árbol de trabajo limpio al iniciar la fase; commit visible
  `7d8a4b3`.
- Frontend: 11 archivos de pruebas, 40 pruebas aprobadas; `npm run build`
  completó `tsc --noEmit` y Vite sin errores.
- Worker: 5 archivos de pruebas, 29 pruebas aprobadas; `npx tsc --noEmit`
  finalizó sin errores.
- Medios: 69 JPEG/WebP locales validados por Pillow. No se inició un Worker ni
  se hizo una comprobación HTTP/navegador en esta auditoría.
- No se aplicaron migraciones o seeds, no se reinició D1, no se modificaron
  productos ni se accedió a recursos remotos.
migraciones y seed aplicados, huellas de recursos copiados y estado de
verificación. No guardará contraseñas, JWT ni tokens. El generador no imprimirá
los valores secretos; mostrará dónde quedaron guardados localmente.
