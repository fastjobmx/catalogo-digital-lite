# Fase 8 — auditoría de seguridad y consolidación

**Fecha:** 2026-11-01  
**Alcance:** revisión local estática, pruebas automatizadas y recorrido de las dos demos. No se desplegó ni se escribieron secretos remotos.  
**Estado:** corregidos los fallbacks inseguros del código; **no aprobar producción** hasta cerrar los bloqueos de la tabla.

## Cambios realizados

- `worker/wrangler.toml` ya no contiene valores de `ADMIN_EMAIL`, `ADMIN_PASSWORD` ni `JWT_SECRET`. Los archivos locales `.dev.vars` no se leyeron en consola ni se modificaron.
- `worker/src/services/auth.ts` deja de usar credenciales por defecto. Requiere un runtime conocido y los tres valores configurados; en producción rechaza secretos JWT cortos, repetidos o con marcadores demo, y exige correo válido y contraseña de mayor entropía. También rechaza marcadores obvios de prueba/fixture en contraseñas. Login y middleware responden con error sanitizado si falta configuración.
- La misma validación y el middleware se sincronizaron en los Workers de Patitas y TecnoCell. Sus rutas de login devuelven 503 si falta configuración y el middleware rechaza también sesiones antiguas cuando falta cualquiera de las credenciales requeridas.
- La autenticación local de emergencia del frontend requiere simultáneamente Vite dev y `VITE_ALLOW_DEMO_AUTH=true`. No está activada en las configuraciones `.env.local` de estas demos. Una sesión `demo-local` antigua se descarta cuando la opción no está habilitada; los JWT restaurados se comprueban contra el Worker.
- La interfaz marca claramente la sesión demo offline y los cambios solo locales. En modo conectado, las pantallas de catálogo/apariencia/configuración no presentan cambios locales como si se hubieran guardado en el servidor.
- El formulario de login ya no afirma aceptar cualquier contraseña y ofrece un reintento de conexión. Las pruebas cubren configuración ausente/débil, rechazos de login y acceso protegido.
- Se retiraron credenciales copiables de `docs/PRUEBAS.md`, `docs/CONFIGURAR_TELEGRAM.md`, `docs/GUIA_COMERCIANTE.md` y `docs/INSTALACION_LOCAL.md`. Los fixtures de Vitest usan ahora identificadores reservados de prueba; no se usan para iniciar sesión en los demos.

## Hallazgos y bloqueos

| Severidad | Hallazgo | Estado / requisito |
|---|---|---|
| **Crítica antes de producción** | El historial anterior del repositorio contiene las credenciales de desarrollo que estuvieron versionadas en `wrangler.toml` y los fallbacks previos. | No se reescribió el historial. Tratar cualquier valor que se hubiera reutilizado fuera de local como expuesto y rotarlo en el destino correspondiente antes de producción. No mostrar ni reutilizar esos valores. |
| **Crítica antes de producción** | No existen secretos de producción configurados ni probados en Cloudflare en esta fase. | Preparar `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `JWT_SECRET` únicos por tienda; declarar `ENVIRONMENT=production`. El Worker debe seguir fallando cerrado mientras falte cualquiera. Ver [`CHECKLIST_PRODUCCION.md`](CHECKLIST_PRODUCCION.md). |
| **Alta** | `POST /api/admin/login` no tiene límite de intentos por IP/tienda. | Agregar mitigación de fuerza bruta antes de exponer el endpoint públicamente. |
| **Alta** | El JWT es bearer, se guarda en `localStorage` y vence en 24 horas. Una vulnerabilidad XSS podría leerlo. | Revisar CSP y superficie XSS; valorar cookie `HttpOnly`, `Secure`, `SameSite` y una política de expiración/renovación más corta antes de manejar usuarios reales. |
| **Media / configuración** | En producción CORS necesita `ALLOWED_ORIGIN` con el origen exacto del frontend. | Configurarlo por entorno; no usar comodín ni incluir orígenes de desarrollo. |
| **Pendiente del comercio** | Ninguna de las dos tiendas tiene un WhatsApp válido. | No aceptar pedidos reales hasta que el propietario configure y pruebe el número correcto de cada tienda. |

## Comprobaciones realizadas

- Los archivos `.dev.vars` de Patitas y TecnoCell existen, están excluidos de Git y no son idénticos. La comparación se hizo internamente; no se imprimieron sus contenidos ni hashes.
- UUID/base D1, nombres de base, bucket R2 local, puertos de Worker/frontend y slug de almacenamiento son distintos. Los tests de `storeStorageKey` están incluidos en la suite frontend.
- Búsqueda estática: no se encontraron variables de credenciales/tokens de admin, Telegram o Gemini bajo `VITE_*` en el frontend. El navegador solo conoce la URL pública de API si se configura.
- `scripts/new-dev-auth.ps1` se niega a sobrescribir un `.dev.vars` existente; no se ejecutó en esta fase para conservar las credenciales actuales.
- Frontend **52/52** pruebas y build OK; Worker **39/39** y `npx tsc --noEmit` OK. Los dos frontends generados compilan y los dos Workers pasan typecheck. PowerShell 5.1 valida CTA UTF-8 y los `-DryRun` de ambos perfiles; la generación completa continúa pendiente por el fallo local de D1 documentado en `GENERADOR_DEMOS.md`.
- **Seguimiento Fase 8.1 (2026-11-01):** una instalación vacía nueva sí completó migraciones, arranque, health y login. Wrangler D1 sigue intermitente en intentos posteriores de vacío y preset; no se declara estable hasta cerrar ese error. Ver [`FASE81_GENERADOR_ESTABLE.md`](FASE81_GENERADOR_ESTABLE.md).
- Comprobación final de disponibilidad: las cuatro URLs locales responden HTTP 200 y ambos endpoints `/api/health` reportan `ok`. No se hizo revisión de una cuenta Cloudflare ni escaneo de producción.

## Conclusión

El código local ya no concede acceso usando valores de respaldo y la ruta de demo offline está desactivada por defecto. Esto **no** equivale a una aprobación de producción: faltan secretos propios, origen permitido, rotación de cualquier valor histórico reutilizado y mitigación de intentos de login. No se cambió la arquitectura de autenticación ni credenciales existentes.
