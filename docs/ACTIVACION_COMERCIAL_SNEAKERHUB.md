# Activación comercial de SneakerHub

## Infraestructura preparada

- Worker: `https://catalogo-lite-api.catalogo-lite-worker.workers.dev`
- D1: `catalogo-lite-production-db`
- R2: `catalogo-lite-production-assets`
- Los recursos son nuevos e independientes del entorno de staging.
- La D1 comercial tiene 19 productos, 90 variantes, 5 categorías y 4 pedidos migrados; también conserva la configuración comercial y el registro de auditoría.
- Las migraciones 0001–0005 están aplicadas. La migración 0005 añade límites persistentes de intentos de login y pedidos.
- Las imágenes del catálogo fueron comprobadas en R2 o en los assets públicos del frontend.

## Seguridad y funciones

- El login administrativo usa PBKDF2 y una contraseña aleatoria de alta entropía. `JWT_SECRET`, el hash de contraseña y el correo administrador están en Cloudflare Secrets.
- La contraseña inicial no está en Git. Se conserva cifrada con DPAPI para el usuario Windows que la generó en `.tmp/sneakerhub-credentials/admin-password.dpapi`.
- El acceso local a la contraseña, en PowerShell y bajo la misma cuenta Windows:

  ```powershell
  $secure = Get-Content -Raw .tmp/sneakerhub-credentials/admin-password.dpapi | ConvertTo-SecureString
  [pscredential]::new('SneakerHub', $secure).GetNetworkCredential().Password | Set-Clipboard
  ```

- Iniciar sesión en `/admin/login` cuando la compilación comercial esté autorizada. Guardar la contraseña en un gestor y eliminar después el archivo local cifrado si ya no se necesita.
- Login limitado por IP e identidad; los identificadores persistidos en D1 están hasheados. CORS de producción permite el dominio actual de Netlify.
- El catálogo, las categorías, los productos y las variantes responden desde la API real. El panel y las mutaciones exigen JWT.
- El número de WhatsApp comercial quedó configurado en la D1 nueva. El texto público aclara que no se procesan pagos con tarjeta.
- `COMMERCE_ENABLED=false`: no se registran solicitudes de pedido hasta la aprobación final. Los pagos con tarjeta no están implementados.
- Telegram/Gemini no tienen secretos configurados en este Worker y el webhook del bot principal permanece en staging.

## Netlify

`netlify.toml` conserva la vista previa pública en modo demo. Configuración actual:

```toml
[build]
base = "frontend"
command = "npm run build"
publish = "dist"

[build.environment]
VITE_PUBLIC_DEMO = "true"

[[redirects]]
from = "/*"
to = "/index.html"
status = 200
```

Después de la aprobación final para sustituir la demo, cambiar `VITE_PUBLIC_DEMO` a `false`, configurar `VITE_API_URL` con la URL HTTPS del Worker y habilitar `COMMERCE_ENABLED=true`. No definir `VITE_ALLOW_DEMO_AUTH` ni colocar secretos del Worker en variables `VITE_*`.

## Pendientes para publicación comercial

1. Aprobar el reemplazo del sitio demo.
2. Cambiar Netlify a modo comercial y volver a publicar desde GitHub.
3. Habilitar el endpoint de pedidos y verificar el checkout de WhatsApp desde la web publicada.
4. Rotar los tokens de Telegram locales antes de configurar Telegram en producción; no cambiar el webhook hasta aprobarlo por separado.
5. Ejecutar pruebas visuales finales de escritorio y móvil en el dominio publicado.

No se modificaron la D1 local original, la D1/R2 de staging ni el webhook de Telegram.
