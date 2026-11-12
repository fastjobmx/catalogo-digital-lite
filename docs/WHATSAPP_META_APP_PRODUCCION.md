# App de Meta dedicada a producción — procedimiento (NO ejecutado)

Decisión del 2026-11-12: producción usa una app de Meta **propia**. La app actual «TiendIA Exprés»
(`1021175547699077`, modo desarrollo) y su número temporal +1 555… quedan **solo para staging**.
Meta permite un webhook distinto por cuenta de WhatsApp Business (`override_callback_uri` en
`POST /{WABA_ID}/subscribed_apps`), así que compartir app sería posible; se separan por seguridad operativa:
App Secret, tokens, roles y registros de cada ambiente quedan aislados.

Nada de esto se ha hecho. Cada paso marcado 🔐 necesita aprobación expresa antes de ejecutarse.

## Requisitos previos (fuera de la app)
1. Portafolio comercial `2052936289150996` con **verificación del negocio** completa.
2. Cuenta de WhatsApp Business empresarial `4258788981080562` fuera de «Revisión en curso».
3. Número colombiano **exclusivo** para el asistente: nuevo, sin WhatsApp personal activo, que reciba SMS o
   llamada para el código. No: el número temporal de Meta, soporte, personales ni números de comercios.
4. Medio de pago agregado a esa cuenta de WhatsApp Business.
5. URL pública de política de privacidad y de eliminación de datos (requisitos para pasar la app a Live).

## Pasos
| # | Dónde | Acción | Resultado esperado |
|---|---|---|---|
| 1 🔐 | developers.facebook.com → Crear app | Tipo **Empresa**, nombre «TiendIA Exprés – Producción», portafolio `2052936289150996`, caso de uso «Conectar en WhatsApp» | App nueva con id propio (anotar, no es secreto) |
| 2 🔐 | App → WhatsApp → Configuración de la API | Elegir la cuenta **empresarial** `4258788981080562` (no la de prueba `1094194940343791`) | La app queda ligada a la cuenta real |
| 3 🔐 | Administrador de WhatsApp → Números | Agregar el número colombiano, verificarlo, pedir el **nombre visible** | Número «Conectado», nombre aprobado; anotar su Phone Number ID |
| 4 🔐 | Configuración del negocio → Usuarios del sistema | Crear usuario del sistema «tiendia-whatsapp-prod» (rol Administrador o Empleado), asignarle la app y la cuenta de WhatsApp con control total | Usuario del sistema con activos asignados |
| 5 🔐 | Mismo usuario → Generar token | App de producción, **sin vencimiento**, permisos `whatsapp_business_messaging` y `whatsapp_business_management` (nada más) | Token permanente. Se copia **directo** a `wrangler secret put`, nunca a chat, correo ni archivos |
| 6 🔐 | App → Configuración → Básica | Copiar el **App Secret** directo a `wrangler secret put WHATSAPP_APP_SECRET` | — |
| 7 🔐 | Terminal (producción) | `npx wrangler secret put WHATSAPP_ACCESS_TOKEN / WHATSAPP_APP_SECRET / WHATSAPP_VERIFY_TOKEN -c wrangler.production.toml`. El token de verificación se genera nuevo (no el de staging) | `secret list` muestra los tres nombres; canal sigue `false` |
| 8 🔐 | App → WhatsApp → Configuración → Webhook | URL `https://catalogo-lite-api.catalogo-lite-worker.workers.dev/api/whatsapp/webhook` (o el dominio de API definitivo), token de verificación del paso 7, suscribir **solo** el campo `messages` | Meta verifica (GET → 200 con el challenge) |
| 9 🔐 | Graph API | `POST /4258788981080562/subscribed_apps` con el token del paso 5 (sin `override_callback_uri`: la app ya es exclusiva). Comprobar con `GET` | La respuesta lista la app de producción |
| 10 🔐 | App → Publicar | Pasar la app a **Live** (requiere los enlaces del requisito 5) | Mensajes de números reales llegan al webhook |
| 11 | Pruebas | Con el canal aún `false`: «Probar» de Meta → 200 `disabled`; firma alterada → 401 | Ruta y firma listas, nada procesado |

Variables (no secretas) para `wrangler.production.toml` en el momento del piloto:
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCOUNT_ID=4258788981080562`, `WHATSAPP_DISPLAY_NUMBER` (solo dígitos con 57),
`WHATSAPP_RATES_USD_MICROS` con la tarifa oficial de Colombia, `WHATSAPP_PILOT_STORE_IDS` con la tienda interna.

## Lo que no se debe hacer
- Reutilizar el App Secret, el token de verificación o el token de acceso de staging.
- Suscribir la app de staging a la cuenta empresarial, o la de producción a la de prueba.
- Activar `WHATSAPP_ADMIN_BOT_ENABLED=true` en producción antes de la tienda interna aprobada.
- Poner `WHATSAPP_PILOT_STORE_IDS="*"`.

## Rotación y apagado
- Rotar: generar token nuevo del usuario del sistema → `secret put` → revocar el anterior en Meta. App Secret:
  «Restablecer» en Configuración básica → `secret put` de inmediato (los webhooks firmados con el anterior fallan con 401).
- Apagado inmediato: `WHATSAPP_ADMIN_BOT_ENABLED=false` (redespliegue) o `wrangler secret delete WHATSAPP_APP_SECRET`
  (el webhook responde 503 al instante y Meta reintenta durante horas; no se pierde nada aceptado).
