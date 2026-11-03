# Checklist de seguridad y preparación para producción

Este procedimiento no se ejecutó en Fase 8. Completarlo por cada comercio en una tarea de aprovisionamiento autorizada, después de escoger el dominio y la cuenta Cloudflare. No copiar secretos a este repositorio, tickets, chats, argumentos de comandos ni variables `VITE_*`.

## Identidad y recursos por tienda

- [ ] Confirmar nombre, slug, dueño, dominio y contacto comercial reales.
- [ ] Crear recursos propios para esa tienda: Worker, D1 y R2. Registrar únicamente nombres/UUID públicos en el manifiesto; no compartir bindings persistentes entre comercios.
- [ ] Confirmar que el catálogo, fotos, configuración y respaldos pertenecen a esa tienda.
- [ ] Reemplazar fotos y fichas ilustrativas, validar licencia/procedencia, precios, inventario, entrega y WhatsApp antes de aceptar pedidos.

## Autenticación y secretos

- [ ] Tratar las antiguas credenciales versionadas como expuestas si alguna vez se usaron fuera de local. No reutilizarlas.
- [ ] Generar un correo administrador propio y contraseña aleatoria de al menos 16 caracteres; la validación de producción exige variedad y rechaza valores de ejemplo.
- [ ] Generar un `JWT_SECRET` nuevo y distinto por tienda, con al menos 32 bytes aleatorios. No usar el secreto de otra demo ni un valor de desarrollo.
- [ ] Configurar `ENVIRONMENT=production` en el entorno Worker de producción. Verificar que los secretos estén presentes en ese mismo entorno, no solo en preview/local.
- [ ] Cargar cada secreto mediante la entrada interactiva segura de Wrangler, desde `worker/`; nunca colocarlo en un comando con su valor literal:

  ```powershell
  npx wrangler secret put ADMIN_EMAIL --env production
  npx wrangler secret put ADMIN_PASSWORD --env production
  npx wrangler secret put JWT_SECRET --env production
  ```

- [ ] Preparar rotación controlada antes de cortar tráfico: guardar los valores nuevos en el gestor aprobado, cargarlos en el entorno correcto, comprobar health/login/admin protegido, invalidar sesiones anteriores y verificar que no aparecen en logs/bundles. No exponer los valores durante la verificación.
- [ ] Mantener los archivos `worker/.dev.vars` locales fuera de Git y no reemplazarlos en una rotación remota.

## Red y frontend

- [ ] Configurar `ALLOWED_ORIGIN` con el origen HTTPS exacto de Pages/dominio; revisar la función CORS en `worker/src/index.ts` y no agregar comodines.
- [ ] Confirmar que la compilación del frontend no contiene secretos ni valores `ADMIN_*`, `JWT_SECRET`, `TELEGRAM_*` o `GEMINI_API_KEY`.
- [ ] Mantener `VITE_ALLOW_DEMO_AUTH` ausente en builds de producción; la demo local requiere Vite dev y activación explícita.
- [ ] Revisar CSP/XSS y decidir la política de sesión antes de cuentas reales, dado que hoy el bearer token vive en `localStorage` por 24 horas.
- [ ] Implementar límite de intentos y monitoreo para `/api/admin/login`; revisar también límites del webhook.

## Validación previa al despliegue

- [ ] Ejecutar frontend `npm test -- --run`, `npm run build`, Worker `npm test -- --run` y `npx tsc --noEmit`.
- [ ] Probar en un entorno de prueba sin secretos: login y rutas protegidas fallan cerradas; faltantes/valores débiles no habilitan sesión.
- [ ] Probar con secretos de producción recién cargados: login válido, contraseña errónea rechazada, JWT inválido rechazado, CORS solo desde el origen autorizado y datos/medios aislados por tienda.
- [ ] Verificar restauración de D1, acceso a imágenes R2, catálogo, precios, stock, privacidad y WhatsApp con los datos reales del comercio.
- [ ] Revisar el diff y el historial; no incluir `.dev.vars`, tokens, dumps con credenciales ni fotos de prueba.
- [ ] Autorizar de forma separada el aprovisionamiento remoto y el despliegue. La Fase 8 no realizó ninguno.

## Rotación de emergencia

Si una credencial antigua llegó a producción o salió del equipo local, asumir exposición. Preparar un JWT y contraseña nuevos, cambiar los secrets únicamente en el Worker de esa tienda, comprobar el nuevo login y el rechazo de la sesión anterior, y actualizar el registro seguro del operador. No purgar/reescribir el historial Git como sustituto de rotar el secreto.
