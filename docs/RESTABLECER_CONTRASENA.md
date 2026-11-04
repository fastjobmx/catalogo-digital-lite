# Restablecer la contraseña del panel

## Para el propietario o un empleado con correo

1. En el inicio de sesión del panel (`/admin/login` o `/t/<tienda>/admin/login`), escribe tu correo y toca **¿Olvidaste tu contraseña?**.
2. Llega un mensaje de `@SneakerHubAdmin_bot` a tu **Telegram vinculado**, con el botón **🔐 Crear contraseña nueva**.
3. El enlace abre `/admin/restablecer`, sirve **una sola vez** y vence en **60 minutos**. Al guardar, entras al panel.

Si tu cuenta no tiene Telegram vinculado, pide el enlace al administrador de la plataforma.

## Para el administrador de la plataforma

En `@CatalogoDigitalMaestro_bot`: `/restablecer correo@ejemplo.com`. Pide confirmación.

- Si la cuenta tiene Telegram vinculado, el enlace llega allí.
- Si no, el bot te lo muestra para que lo envíes **en privado**.

## Seguridad

- La respuesta es la misma exista o no el correo, para no revelar qué correos están registrados.
- Hay límite de intentos por IP y por correo, y para enlaces inválidos.
- Solo se guarda el SHA-256 del enlace. Cada solicitud nueva invalida el enlace anterior, y al cambiar la contraseña se invalidan todos los pendientes.
- La contraseña debe tener al menos 10 caracteres, con letras y números. La anterior deja de funcionar.
- Todo queda en la auditoría: `password_reset_requested`, `password_reset_undeliverable`, `password_reset_issued` y `password_reset_completed`.
- El superadministrador de la plataforma (`ADMIN_EMAIL`) no usa este flujo: su contraseña es un secreto del Worker.

## Correo electrónico (pendiente de proveedor)

La plataforma todavía no envía correos. Para agregarlos:

1. Elige un proveedor con remitente verificado: Resend con dominio propio (recomendado) o Brevo.
2. Guarda la clave con `wrangler secret put`.
3. Agrega el canal en `deliverResetLink` (`worker/src/services/passwordReset.ts`). El resto del flujo no cambia.

## Verificación

- `worker/src/routes/password-reset.test.ts` (5 pruebas).
- Worker 250/250 y frontend 67/67.
- Staging `9abfb6e7`:
  - Endpoints: respuesta genérica, 404 con enlace falso y 400 con contraseña débil.
  - Prueba de escritura 7/7 sobre una tienda ficticia eliminada al final.

## Publicación

Producción (2026-11-04): backend `c0ba4940`, frontend `3f0bdfa0`. Reversión: backend `npx wrangler rollback 7890daf2-a831-4582-b330-ef16004649da --config wrangler.production.toml`; frontend `cd frontend; node ../worker/node_modules/wrangler/bin/wrangler.js rollback 23744f4e-8a78-4214-9ce5-119680dd90d8`.
