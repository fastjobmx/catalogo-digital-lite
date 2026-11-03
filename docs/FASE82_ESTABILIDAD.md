# Fase 8.2 — estabilidad del generador y Wrangler D1

**Fecha:** 2026-11-01 (hora local)  
**Resultado:** el generador completó tres generaciones consecutivas con el entorno disponible. La fase queda parcial: no se pudieron probar versiones alternativas ni instalar dependencias limpias desde npm, por lo que las copias nuevas no pasaron build, login o API.

## 1. Matriz de compatibilidad

| Node.js | npm | Wrangler | PowerShell | Resultado |
|---|---:|---:|---|---|
| 26.8.1 | 11.19.0 | 4.156.0 local | Windows PowerShell 5.1.26100.9711 | Tres generaciones completas; matriz nativa y pruebas D1 locales aprobadas. |
| 24.22.2 LTS | — | 4.156.0 | 5.1 | No probado: no existe una instalación local de Node 24 y `registry.npmjs.org` respondió `ENOTFOUND`. No se cambió Node globalmente. |
| 26.8.1 | 11.19.0 | 4.156.1 candidata | 5.1 | No probado: el CLI indicó una actualización a 4.156.1, pero npm no pudo resolver el registro. No se tocó `package-lock.json`. |

Cloudflare documenta soporte para Node Current, Active LTS y Maintenance LTS, y Wrangler local por proyecto ([requisitos oficiales de Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)). Node 24.22.2 figura como LTS en el calendario oficial ([releases de Node.js](https://nodejs.org/en/about/previous-releases)). Las filas no disponibles se conservan como pendientes, no como resultados inferidos.

PowerShell 7.6.5 estuvo disponible en el host para consultas auxiliares. Las generaciones, el test de codificación y el test del fallo simulado se ejecutaron bajo Windows PowerShell 5.1.

## 2. D1 nativo frente al flujo anterior

Una D1 temporal nueva con Wrangler 4.156.0 y `--local --persist-to <ruta absoluta> --config <config temporal>` aplicó 0001, 0002 y 0003 en orden. Un segundo `migrations apply` informó que no había migraciones pendientes; `migrations list` y una consulta a `d1_migrations` confirmaron los tres nombres, sin duplicados. Se volvió a observar este flujo durante las tres generaciones.

El flujo anterior también pasó una secuencia completa con tres `d1 execute --file` en una D1 aislada. No creó un ledger de migraciones. Ese control prueba que la secuencia SQL puede funcionar; no basta para establecer estadísticamente que Wrangler nativo sea más estable. En Fase 8.1 el flujo antiguo había mostrado `internal error` intermitente.

Cloudflare documenta `migrations_dir`, el orden por nombre, el ledger `d1_migrations` y `migrations apply` ([documentación oficial de migraciones D1](https://developers.cloudflare.com/d1/reference/migrations/)).

## 3. Diagnóstico y cambios

- El `fetch failed` bajo el sandbox coincidió con `EACCES` de loopback. Con acceso local ampliado, Wrangler llegó a la D1 local y las pruebas terminaron. Las operaciones mantuvieron `--local`; no se ejecutó ninguna llamada `--remote`.
- La causa del `internal error` histórico no quedó confirmada. Las tres generaciones finales no lo reprodujeron.
- La plantilla ahora usa `wrangler d1 migrations apply` y coloca los archivos en `database/migrations`. Así `store-config.sql` y el seed quedan fuera de la carpeta que Wrangler descubre como migraciones.
- Wrangler se invoca con `npx.cmd --no-install` desde `worker/`, usando la versión local existente y sin pedir a npm que descargue una versión alternativa.
- El diagnóstico conserva la etapa, el código de salida, salida sanitizada y una categoría (`permissions`, `sqlite-lock`, `sql`, `local-network`, `internal-wrangler`, `dependencies`, `filesystem-conflict`, `configuration` o `unknown`). El test controlado confirmó clasificación `SQLITE_BUSY` → `sqlite-lock`.
- No se añadió reintento: las ejecuciones finales no mostraron un fallo transitorio que lo justificara. Los fallos permanentes de configuración/SQL detectados al integrar el flujo nativo terminaron en cleanup del staging, sin crear destino ni marcar éxito.

Durante la integración se detectaron y corrigieron dos errores propios: primero, una ruta de migraciones equivocada; luego, el archivo SQL de configuración quedó temporalmente dentro de la carpeta que Wrangler descubre. Ambos casos quedaron registrados con diagnóstico, limpiaron su staging y no modificaron tiendas existentes.

## 4. Tres generaciones consecutivas

| Orden | Slug | Seed | Migraciones | Productos | Categorías | Fotos de preset | Resultado |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | `phase82-vacio-01` | None | 3 | 0 | 0 | 0 | Completada |
| 2 | `phase82-patitas-02` | PatitasFelices | 3 | 3 | 3 | 3 | Completada |
| 3 | `phase82-tecnocell-03` | TecnoCellAccesorios | 3 | 4 | 4 | 4 | Completada |

Las consultas locales confirmaron una fila de configuración por D1, nombres y mensajes CTA con acentos correctos, conteos esperados y ledger con 0001–0003. Los SHA-256 de las fotos copiadas coinciden con los manifiestos. Cada tienda tiene UUID, nombre D1, puertos y persistencia separados. Los diagnósticos sanitizados de las ejecuciones completas están bajo `.tmp/generator-diagnostics/` y corresponden a los slugs anteriores.

## 5. Dependencias, build y comportamiento de aplicación

Se ejecutó `npm ci` en `worker/` y `frontend/` dentro de cada una de las tres instalaciones (seis intentos). Los seis fallaron al descargar `zod@3.25.76` con `ENOTFOUND registry.npmjs.org`. El bloqueo de red es independiente de Wrangler; no se modificaron lockfiles ni se copiaron `node_modules` desde la plantilla.

La plantilla pasó Frontend 52/52, Worker 39/39, typecheck Worker y build Frontend. `test-generator-encoding.ps1` y `test-generator-wrangler.ps1` pasaron bajo PowerShell 5.1. Los builds, login, carrito, API/health y navegación de las tres copias generadas quedan pendientes porque las dependencias limpias no pudieron instalarse. El directorio de credenciales de cada copia es `worker/.dev.vars`; los valores no se incluyeron en logs ni en este informe.

## 6. Tiendas protegidas y alcance remoto

SneakerHub Premium, Patitas Felices, TecnoCell Accesorios y `test-generador-fase81` no fueron destino de comandos de generación, migraciones, seeds, reset o pruebas. Solo se agregaron los tres slugs nuevos al registro local. No se crearon recursos Cloudflare ni se desplegó.

## 7. Suites y comprobaciones ejecutadas

- Generador: tres generaciones completas, secuenciales y con slugs nuevos.
- D1 nativo: orden, repetición idempotente, lista, ledger y consultas por tienda.
- D1 anterior: secuencia aislada con los tres `--file` y comprobación de esquema.
- Frontend: 52/52; Worker: 39/39; typecheck Worker OK; build Frontend OK.
- Codificación: acentos, CTA, comillas SQL y UTF-8 sin BOM OK.
- Fallo simulado: exit code 37, categoría SQLite lock, staging limpio, sin destino ni registro.
- Instalación limpia: `npm ci` falló en 6/6 por DNS npm.

## 8. Estado para un piloto

El camino D1 del generador pasó tres veces en la combinación disponible y no repitió el `internal error` histórico. La matriz de Node/Wrangler no está completa y las tiendas nuevas no pudieron instalar ni compilar dependencias. La Fase 8.2 permanece parcial y no recomiendo preparar todavía una instalación piloto que requiera build, login y validación de API. Retomar las filas pendientes cuando npm resuelva `registry.npmjs.org`, instalar Node 24 en un entorno aislado y probar Wrangler alternativo sin cambiar la lockfile de producción.
