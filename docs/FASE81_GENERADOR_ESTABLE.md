# Fase 8.1 — Generador de tiendas: resultado

**Fecha:** 2026-11-01  
**Ámbito:** generación local únicamente. No se desplegó a Cloudflare ni se crearon recursos remotos.

## Diagnóstico

Wrangler y la generación se compararon con D1 temporales aisladas. Las llamadas del generador usan el mismo `wrangler.toml`, base D1, `--local` y ruta `--persist-to` en cada operación; el bucle espera el fin de cada proceso y aplica las migraciones en orden. Wrangler se ejecuta desde `worker/`, donde están instaladas sus dependencias, con el config y la persistencia absolutos del staging. Node 26.8.1, npm 11.19.0, Wrangler 4.156.0 y Windows PowerShell 5.1.26100.9711 estuvieron en uso.

El `fetch failed` observado sin acceso local ampliado se reprodujo junto a un error `EACCES` al conectar a `127.0.0.1`. El `SELECT 1` y las migraciones 0001–0003 pasaron al permitir loopback, en una base D1 temporal local. Esto confirma la causa del primer error en el entorno de ejecución restringido.

Separadamente, una generación con el preset TecnoCell volvió a fallar en `0001_initial.sql` con un `internal error` de Wrangler. El error se reproduce con permisos locales ampliados, mientras que un control con Wrangler 4.156.0, configuración equivalente, `.dev.vars`, paquete generado, UUID/base propios y las mismas migraciones pasa. Intentos vacíos posteriores también dieron el error interno, aunque una generación vacía real había completado. El log de Wrangler termina antes de dar una causa interna. Por tanto, el comportamiento es intermitente; no se confirmó una causa ni se declara estable.

## Cambios del generador

- `scripts/new-store.ps1` añade `-Diagnostic` y registros sanitizados en `.tmp/generator-diagnostics/` con paso, comando sin SQL/secrets, directorio de trabajo, config, persistencia, duración, código de salida y salida/log de Wrangler.
- La salida nativa de Wrangler se captura sin convertir `stderr` en una excepción de PowerShell antes de leer `$LASTEXITCODE`. Si Wrangler falla, se preserva el diagnóstico, se elimina el staging de esa ejecución, se devuelve error y no se registra éxito.
- Cada D1 local usa explícitamente `--local`, el mismo `wrangler.toml` staged y `--persist-to` absoluto. Las operaciones se esperan de forma secuencial desde `worker/` del template.
- Se probaron `--cwd` al Worker staged y una consulta previa `SELECT 1`; ambos intentos también terminaron en `internal error` en una ejecución vacía. No se retuvieron como correcciones porque no hicieron pasar Wrangler de forma fiable.
- `scripts/test-generator-wrangler.ps1` prueba la falla externa con código 37 y verifica código no cero, fase precisa, diagnóstico, secretos no impresos y ausencia de destino, registro y staging.

## Tienda vacía verificada

Se ejecutó primero DryRun y luego la generación completa para:

- Nombre: **Tienda Prueba Generador**
- Slug: `test-generador-fase81`
- Modo/tema/seed: `demo` / `default` / `None`
- Ruta: `local-stores/test-generador-fase81`
- Puertos: Worker 9466, frontend 5851

El destino tiene manifiesto, UUID D1 propio, `wrangler.toml`, credenciales aleatorias en `.dev.vars` excluido por `.gitignore`, y estado D1 bajo su propia ruta. Wrangler aplicó 0001–0003 y el SQL inicial. Una consulta confirmó la configuración “Tienda Prueba Generador”, cero productos y cero categorías. El API respondió `GET /api/health` con `ok` y `GET /api/products` con `[]`. El login local obtuvo un JWT, y la consulta autenticada a `/api/admin/stats` devolvió conteos en cero. Vite respondió HTTP 200.

La compilación del frontend generado pasó y el Worker pasó `npx tsc --noEmit`. Los dos servidores locales se cerraron después de la prueba. La UI tiene textos de estado vacío (“El catálogo está vacío por ahora” y “Todavía no hay productos en la colección”) y el modo independiente bloquea el catálogo SneakerHub de respaldo.

Para validar build/arranque sin red, se usaron temporalmente enlaces locales a los `node_modules` ya instalados en el workspace. `npm ci --offline` no pudo completar porque `zod@3.25.76` no existe en la caché; no se accedió al registro npm.

## Preset: resultado incompleto

El DryRun del slug nuevo `test-generador-preset-fase81` seleccionó `tech-minimal`, puertos libres y recursos locales. La creación completa falló durante la migración inicial con `internal error`. Cada ejecución guardó diagnóstico y limpió su staging; no hay destino ni entrada de registro para ese slug. Los intentos experimentales con `--cwd` staged y preflight `SELECT 1` también fallaron en tiendas vacías y se retiraron; no identificaron la causa.

No se consideran verificados para una nueva tienda con preset el catálogo demo, las fotografías, acentos en datos almacenados, CTA, carrito o independencia en ejecución. La prueba idempotente/rechazo de slug sí se comprobó sobre la tienda vacía ya creada: el reintento devolvió código 1, y los hashes de manifiesto y registro no cambiaron.

## Regresión y seguridad

- Frontend: **52/52** pruebas. Worker: **39/39**. Typecheck Worker y build de plantilla pasaron.
- `test-generator-encoding.ps1` pasó: acentos, CTA del preset, escape SQL, sin mojibake y UTF-8 sin BOM.
- `test-generator-wrangler.ps1` pasó con salida simulada 37 y fallo controlado del generador; no creó destino ni entrada de registro.
- El manifiesto de la tienda vacía no contiene secretos. `.dev.vars` contiene email, contraseña y JWT con formato aleatorio y valores distintos del fallback histórico; los valores no se imprimieron. Login real y ruta protegida pasaron.
- UUID D1, nombres de base, puertos y persistencia local de la nueva tienda son propios. Patitas Felices, TecnoCell Accesorios y SneakerHub Premium no fueron regenerados, migrados, limpiados ni sobrescritos.
- Los seeds heredados destructivos no se ejecutaron. No hubo aprovisionamiento remoto ni despliegue.

## Seguimiento de Fase 8.2

La evidencia de esta fase es histórica. En Fase 8.2 el generador cambió a
`wrangler d1 migrations apply`, separó `database/migrations` de los SQL de seed
y configuración, fijó `npx.cmd --no-install` y añadió clasificación sanitaria
del error. Tres generaciones nuevas consecutivas pasaron con la combinación
Node 26.8.1 / Wrangler 4.156.0 / PowerShell 5.1. La causa del `internal error`
observado aquí no quedó confirmada. La matriz alternativa y las instalaciones
limpias de dependencias continúan pendientes por DNS npm (`ENOTFOUND`). Ver
[`FASE82_ESTABILIDAD.md`](FASE82_ESTABILIDAD.md).
