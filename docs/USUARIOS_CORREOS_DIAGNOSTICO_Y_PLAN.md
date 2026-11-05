# Usuarios y accesos, recuperación de contraseña y plantillas de correo — Diagnóstico y plan

Fecha: 2026-11-05. Este documento no cambia nada en producción.

## 1. Lo que ya existe (y se reutiliza)

| Pieza | Estado | Archivos |
|---|---|---|
| Usuarios | Una sola tabla `platform_users`: correo, nombre, hash PBKDF2-SHA256, Telegram, estado (`invited`, `active`, `disabled`) y `last_login_at`. **No hay** campo de correo verificado. | migración `0007`, `services/platformUsers.ts` |
| Membresías y roles | `store_memberships` con los roles owner, admin, operator, seller e inventory. Cada solicitud vuelve a comprobar en la base que la membresía y el usuario estén activos, así que un usuario desactivado pierde el acceso al instante. | `tenancy/access.ts`, `middleware/auth.ts` |
| Sesiones | JWT HS256 de 24 h, sin estado en el servidor. **No** se invalidan al cambiar la contraseña. | `services/auth.ts` |
| Tokens de un solo uso | `user_access_tokens`: solo se guarda su hash SHA-256, vencen, se marcan como usados y uno nuevo anula los anteriores. Sirven para activación, vinculación con Telegram y restablecimiento. | `services/platformUsers.ts` |
| «¿Olvidaste tu contraseña?» | **Ya existe**, con respuesta genérica, límite de intentos por IP y por correo, enlace de 60 minutos y la página `/admin/restablecer`. **Solo se entrega por Telegram**: si el usuario no vinculó Telegram, el enlace no le llega. | `services/passwordReset.ts`, `routes/auth.ts`, `frontend/src/admin/ResetPasswordPage.tsx` |
| Equipo de la tienda | `GET/POST/DELETE /api/admin/team`. La invitación devuelve el enlace de activación en pantalla para compartirlo a mano. | `routes/admin.ts` |
| Bot maestro | «Restablecer contraseña» devuelve el enlace al superadministrador cuando el usuario no tiene Telegram. | `services/master/bot.ts` |
| Correo electrónico | **No existe** ningún proveedor ni secreto de correo. La plataforma usa `*.workers.dev` y **no tiene un dominio propio** desde el cual enviar. | — |
| Auditoría | `audit_log`, sin tokens. | — |

**Conclusión.** No hace falta un segundo sistema de usuarios: se agrega el canal de correo al flujo de recuperación que ya existe, más la verificación del correo, el cierre de sesiones al cambiar la contraseña y las pantallas nuevas.

## 2. Plan

1. **Migración aditiva `0014`.**
   - `platform_users.email_verified_at`.
   - `platform_users.credentials_changed_at`: las sesiones emitidas antes de esa hora dejan de valer.
   - Propósito de token nuevo `email_verification`.
   - Tablas `email_templates` (plantillas) y `email_messages` (historial de envíos, sin enlaces ni tokens).
2. **Servicio de correo.** Toda la configuración en secretos del Worker, sin exponer nada en el navegador.
   - Clave de idempotencia por envío.
   - Registro del resultado de cada envío.
   - Si falta configurar el proveedor, el envío queda registrado como «no configurado»: nunca se finge que se envió.
3. **Plantillas.** Las 4 iniciales con la identidad de MOSTRALO PUES! y versión en texto plano.
   - Las variables son una lista cerrada.
   - `{{enlace_recuperacion}}` y `{{enlace_invitacion}}` los genera solo el servidor. En la vista previa y en los envíos de prueba se reemplazan por un enlace de ejemplo que no sirve.
   - El HTML se limpia: sin scripts, sin manejadores de eventos y sin `javascript:`.
4. **Recuperación por correo.** Se envía solo a correos verificados; Telegram sigue funcionando como hoy.
   - Al cambiar la contraseña, se cierran las demás sesiones.
5. **«Usuarios y accesos»** en el panel de cada tienda.
   - Muestra nombre, correo, rol, estado, último acceso, si el correo está verificado y si tiene Telegram.
   - Acciones: enviar el enlace de restablecimiento, reenviar la invitación, activar o desactivar y verificar el correo.
   - El administrador ve si se envió y cuándo; nunca ve contraseñas, tokens ni enlaces.
   - Una tienda nunca ve usuarios de otra.
6. **Plantillas de correo** en el panel del superadministrador: crear, editar, duplicar, activar o desactivar, vista previa, envío de prueba e historial.
7. **Regularización de tiendas sin propietario verificado.**
   - El superadministrador registra cómo verificó la identidad (motivo y evidencia).
   - El sistema envía al correo un enlace que **solo verifica el correo**. No da acceso hasta que la persona lo abre.
   - Todo queda auditado y nada se asigna automáticamente.
8. **Pruebas automáticas, staging y entrega.** Sin producción hasta que lo autorices.

## 3. Decisiones pendientes

- **Proveedor de correo y dominio.** Para enviar a cualquier dirección hace falta un dominio con registros SPF y DKIM.
- **Bot maestro.** Hoy muestra el enlace de restablecimiento cuando el usuario no tiene Telegram, y la nueva regla prohíbe que el administrador vea enlaces.

## 4. Implementado (2026-11-05) — en local y staging, NO en producción

Decisiones aprobadas:
- **Proveedor de correo:** desacoplado y todavía sin proveedor. Mientras no se configure, cada envío queda registrado como «no configurado».
- **Bot maestro:** ya no muestra enlaces.
- **Usuarios actuales:** verifican su correo con un enlace.

### Archivos

**Base de datos**
- `database/migrations/0014_users_email.sql`, solo aditiva. Agrega `email_verified_at`, `credentials_changed_at`, `delivered_via` y las tablas `email_verification_tokens`, `email_templates` y `email_messages`.
- Reversión en `database/rollback/0014_users_email.down.sql`.

**Servidor nuevo**
- `worker/src/email/templates.ts`: variables, limpieza del HTML y las 5 plantillas del sistema.
- `worker/src/email/send.ts`: proveedor, idempotencia e historial.
- `worker/src/email/manage.ts`: gestión de plantillas.
- `worker/src/services/userAccess.ts`: usuarios y accesos, verificación de correo e invitaciones.
- `worker/src/services/ownerRegularization.ts`: regularización de propietarios.

**Servidor modificado**
- `services/passwordReset.ts`: correo verificado, luego Telegram, y nunca devuelve el enlace.
- `routes/auth.ts`: `POST /api/auth/verify-email`. Activar la cuenta o restablecer la contraseña cierra las sesiones anteriores y verifica el correo si el enlace llegó por correo.
- `middleware/auth.ts`: rechaza sesiones anteriores al cambio de contraseña.
- `routes/admin.ts`: rutas `/api/admin/users/*`, y la invitación del equipo ahora va por correo.
- `routes/platform.ts`: rutas `/api/platform/email/*`, `/owners/unverified` y `/stores/:slug/owner-regularization`.
- `services/master/bot.ts`: deja de mostrar el enlace.
- También `services/platform.ts` (borrado de tiendas), `services/auth.ts`, `platformUsers.ts`, `tenancy/access.ts` e `index.ts`.

**Panel**
- `admin/pages/Users.tsx`: «Usuarios y accesos».
- `admin/VerifyEmailPage.tsx`: `/admin/verificar-correo`.
- `admin/PlatformEmailPage.tsx`: `/plataforma/correos`.
- Cambios en `App.tsx`, `AdminLayout.tsx`, `LoginPage.tsx` (nuevo texto de «¿Olvidaste tu contraseña?»), `PlatformPage.tsx` (enlace a plantillas) y `services/api.ts`.

### Pruebas

**Servidor:** 305/305. Son 16 nuevas en `worker/src/routes/users-email.test.ts`:
- Respuesta genérica, y correo solo a direcciones verificadas.
- Cambio de contraseña con enlace de un solo uso: el enlace no se puede reutilizar, vence y cierra las sesiones anteriores.
- Falla del proveedor y proveedor no configurado.
- Lista de la tienda sin hashes ni tokens.
- Restablecimiento desde el panel, que solo informa el canal y la hora.
- Aislamiento entre tiendas y entre roles.
- Activar y desactivar acceso, solo en esa tienda.
- Invitación por correo, que verifica el correo y envía la bienvenida, y sin proveedor el enlace privado como antes.
- Verificación de correo de un solo uso.
- Plantillas: crear, limpiar el HTML, editar, duplicar y activar o desactivar, con auditoría.
- Vista previa y envío de prueba solo a direcciones autorizadas, sin duplicar.
- Regularización con verificación de identidad registrada.
- El bot maestro nunca recibe el enlace.

**Panel:** 78/78, con `build` correcto.

**Staging** (`0014` aplicada, Worker `27a090bb`): navegador 18/18, sin proveedor de correo. Se revisó el diseño del correo de recuperación en celular.

### Configuración externa pendiente (para que los correos salgan de verdad)

1. **Un dominio propio con DNS.** Por ejemplo, el dominio de MOSTRALO PUES!.
2. **Una cuenta en Resend,** con ese dominio verificado (registros SPF y DKIM).
3. **Secretos y variables del Worker,** cargados por ti y nunca en el código:
   - `RESEND_API_KEY`: es secreto.
   - `EMAIL_PROVIDER=resend`.
   - `EMAIL_FROM="MOSTRALO PUES! <no-responder@tu-dominio>"`.
   - Opcional: `EMAIL_TEST_RECIPIENTS`, con direcciones adicionales autorizadas para las pruebas.
4. **Enviar una prueba** desde `/plataforma/correos` y revisar el historial.
5. **Verificar el correo de los usuarios actuales** desde «Usuarios y accesos». Hasta entonces, la recuperación por correo no se les envía; Telegram sigue funcionando.
