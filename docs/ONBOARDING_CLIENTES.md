# Onboarding inteligente de propietarios (3.1)

El asistente de Telegram guía al propietario nuevo para revisar los datos del negocio, definir la identidad visual, elegir una plantilla, añadir productos y solicitar la activación. Los cambios se guardan por tienda, quedan en `audit_log` y la activación sigue en manos del equipo con permisos.

Estado: **en producción** desde el 2026-11-03 (commit `b110b2d`, Worker `ac6acb57`, migración `0008`, frontend Netlify `index-DrZH2Exj.js`). Staging: Worker `b6b92066`. Registro en §7 y §8.

Las tiendas que ya existían (SneakerHub, Distribumax y Muy Parcero) quedaron marcadas como existentes: no reciben la bienvenida automática, conservan su diseño y pueden usar las 13 plantillas y las paletas desde el panel (Apariencia) o Telegram (`/configurar`); el recorrido guiado se abre con `/continuar`.

## 1. Flujo del propietario

| Paso | Qué ve | Qué se guarda |
|---|---|---|
| Bienvenida | “¡Hola, María! 👋 ¡Tu tienda … está casi lista!” · 🚀 Configurar mi tienda · 👀 Ver mi tienda · ❓ Necesito ayuda · ⏰ Continuar después | Fila en `store_onboardings` (tienda + usuario de Telegram) |
| 1. Datos del negocio | Nombre, tipo de comercio, WhatsApp, propietario y dirección ya registrados · Todo correcto / Modificar información / Continuar | Solo nombre, tipo y WhatsApp, con validación |
| 2. Logotipo | Envío de PNG, JPG o WebP · Usar nombre de mi negocio / Subir logo después | Borrador privado en R2 → `stores/<id>/store/logo-…` tras confirmar |
| 3. Colores | Tres variantes (Fiel, Elegante, Vibrante) con ✓ elegir y 👁 vista previa real; acepta “tonos azules”, “verdes”… | Paleta completa de 10 colores, contraste validado |
| 4. Plantilla | 13 familias, cada una con ✓ y 👁 | `stores.template` + diseño en `theme_config`; colores y productos se conservan |
| 5. Portada | Subir portada / Usar diseño de plantilla / Configurar después | Igual que el logo (≥ 800 px de ancho, sin recortar ni deformar) |
| 6. Primer producto | Fotos → Gemini propone nombre, descripción, categoría y colores visibles; precio, tallas y existencias se preguntan · ✅ Guardar producto / ✏️ Editar / ❌ Cancelar | Producto solo tras confirmar; SKU único; idempotente |
| 7. Más productos | ➕ Agregar otro · 📦 Ver mis productos · 🚀 Preparar publicación · ⏰ Continuar después | Sin mínimo obligatorio |
| 8. Revisión | Lista de comprobación + 👁 Vista privada + 📨 Solicitar activación | `store_activation_requests` pendiente; la tienda **sigue en borrador** |

Todos los pasos muestran “Paso N de 7”, tienen ↩ Atrás y ⏰ Continuar después, y hacen una pregunta a la vez.

**Comandos:** `/configurar` (centro de configuración), `/continuar` (retoma el paso guardado), `/ayuda` (durante el onboarding explica el paso actual; fuera de él muestra la ayuda general). El menú principal cambió “🎨 Editar mi tienda” por “⚙️ Configurar mi tienda”.

**Centro de configuración (Telegram):** Datos y contacto, Logotipo, 🎨 Colores, 🧩 Plantilla, Apariencia en el panel, Portada, WhatsApp, Productos destacados, Agregar producto, Vista privada y, si hay avance pendiente, Continuar configuración guiada.

**Preguntas que entiende sin gastar IA:**

- “¿Cómo cambio los colores de mi tienda?” / “Muéstrame cómo quedaría mi tienda en tonos azules” → tres paletas con 👁 y ✓ (✓ pide confirmación antes de cambiar).
- “¿Cómo cambio la plantilla?” → lista con 👁 por plantilla; ✓ pide confirmación.
- “¿Puedo cambiar la foto principal?” → pide la foto de la portada y muestra vista previa.
- “Quiero subir cinco productos” → inicia el alta guiada, uno a la vez.

Las demás preguntas pasan por Gemini, que solo puede proponer acciones tipificadas y validadas.

## 2. Quién ve el onboarding

- Al aplicar `0008`, las tiendas existentes quedan en `store_onboarding_legacy_stores` y conservan su `/start` normal. Pueden usar `/continuar` voluntariamente.
- Tiendas creadas después: el **propietario** recibe la bienvenida en `/start` o al elegir la tienda. Con varias tiendas, primero se elige la tienda y se comprueba la membresía.
- Los botones `ob:<id>:…` se rechazan si el ID no es la tienda activa. Colores, plantilla, logo y portada requieren rol propietario/administrador; un operador recibe “Tu rol no permite…”.

## 3. Progreso, concurrencia e idempotencia

- Estado aislado por `(store_id, telegram_user_id)`, vence a los 90 días (se reinicia desde la bienvenida con `/continuar`).
- Cada transición usa `version` (control optimista): dos toques simultáneos producen una sola escritura y una sola auditoría.
- Los cambios de negocio y el avance de paso se escriben en un solo lote D1 con `mutation_token`.
- Telegram reenvía actualizaciones: `processed_updates` las descarta; productos, logo y portada usan operaciones con ID único y confirmación.
- La memoria de conversación oculta contraseñas, tokens y enlaces de acceso (`[oculto]`).

## 4. Logotipos y paletas

- Telegram: PNG, JPG o WebP; hasta 20 MB; 128 px mínimo y 10.000 px máximo por lado; 40 megapíxeles; proporción ≤ 20:1. Un archivo inválido se rechaza con un mensaje claro y el paso no cambia.
- El Worker extrae colores de PNG (8 bits, no entrelazado, ≤ 4 MP) con un lector determinista: ignora transparencia, fondos blancos/negros y da menos peso a grises. Un logo monocromo produce paletas neutras.
- JPG/WebP o PNG no soportado: Gemini propone dos colores (≤ 8 MB, con presupuesto de IA de la tienda). Sin IA, se ofrecen paletas accesibles predefinidas.
- Toda paleta ofrecida o guardada pasa `isLegiblePalette`: texto/fondo ≥ 4.5, texto secundario/superficie ≥ 4.5, botón ≥ 4.5, color principal/fondo ≥ 3.
- Panel web: análisis local del navegador (PNG/JPG/WebP ≤ 8 MB), 12 paletas listas, selector de color y HEX, “Restablecer colores recomendados” y bloqueo del guardado si falta contraste.

## 5. Plantillas

13 familias: Minimalista, Moderno, Premium, Personalizado, Luxury, Urban, Boutique, Natural, Tech, Playful, Gourmet, Artesanal y Editorial. Además de tipografía, radios, botones y densidad, cada una cambia la **composición** (`frontend/src/lib/templateLayouts.ts`):

| Familia | Cabecera | Portada | Tarjeta de producto |
|---|---|---|---|
| Minimalista | estándar | centrada, foto debajo | mínima 1:1 |
| Moderno | estándar | dividida | en caja 4:5 |
| Premium | estándar | dividida invertida | clásica 4:5 |
| Personalizado (SneakerHub) | estándar | dividida | clásica 4:5 |
| Luxury | marca centrada + menú abajo | a sangre con texto encima | centrada 4:5, títulos en mayúscula |
| Urban | compacta | a sangre, mayúsculas | nombre sobre la foto 1:1 |
| Boutique | centrada | centrada | centrada 4:5 |
| Natural | estándar | centrada | en caja 4:5 |
| Tech | compacta | dividida, fondo cuadriculado | en caja 1:1 |
| Playful | estándar | centrada | en caja 1:1, formas redondeadas |
| Gourmet | centrada | a sangre | centrada 4:3 |
| Artesanal | estándar | dividida invertida | en caja 1:1, bordes orgánicos |
| Editorial | centrada | foto grande + titular de revista | mínima 4:5 |

Los colores salen de tokens por tienda (`--color-primary`, `--color-secondary`, `--color-accent`, `--color-background`, `--color-surface`, `--color-text`, `--color-border`, `--color-button`…), compartidos por inicio, catálogo, producto y carrito. Las tiendas sin plantilla guardada (SneakerHub) usan la composición “Personalizado”, idéntica a la anterior.

**Vista previa sin guardar:** `/admin/store-preview?template=<familia>&palette=<10 HEX>` (o `/t/<tienda>/admin/store-preview?...`). Requiere sesión; si hay que iniciar sesión, vuelve a la misma vista. Paletas ilegibles o valores desconocidos se ignoran. El bot genera estos enlaces en los botones 👁.

**Capturas:** [`docs/capturas-3-1/`](capturas-3-1/) — 13 plantillas en escritorio (1280 px), Urban y Editorial en móvil y la grilla de productos Urban. Tomadas en local con el catálogo demo y la paleta recomendada de cada familia.

## 6. Pruebas

```powershell
cd worker; npm test; npx tsc --noEmit
cd ..\frontend; npm test; npm run build
```

Resultados: Worker **202/202** (25 archivos) y `tsc` OK; frontend **67/67**, `tsc` y build OK.

| # | Criterio de aceptación | Evidencia |
|---|---|---|
| 1 | Propietario nuevo recibe bienvenida | `onboarding.test.ts` + E2E staging |
| 2 | Propietario existente no pierde configuración | `onboarding.test.ts` (saludo normal, sin fila) |
| 3 | Se reconocen datos de la tienda | paso de datos del negocio (`onboarding.test.ts`) |
| 4 | Logo válido se procesa | `onboarding.acceptance.test.ts` (paletas del logo, R2 `stores/<id>/store/`) |
| 5 | Logo inválido se rechaza | `onboarding.acceptance.test.ts` (40×40 px) |
| 6 | Paletas utilizables | 12 colores × 3 variantes legibles; PNG y monocromo en `logoPalette.test.ts` |
| 7 | Plantillas realmente diferentes | `previewOverride.test.ts` (5 portadas, 5 tarjetas, 12+ composiciones únicas) + capturas |
| 8 | Elegir y guardar plantilla | onboarding y `tpl:apply` (`onboarding.acceptance.test.ts`) + E2E staging |
| 9 | Personalización persiste al recargar | `GET /api/store` tras aplicar (test + staging) |
| 10 | Interrumpir y continuar | `/continuar`, ⏰, ↩ Atrás (`onboarding.test.ts`) |
| 11 | Gemini ayuda con un producto | `assistant.test.ts` (fotos → propuesta → guardar) |
| 12 | Precio y stock requieren datos válidos | `assistant.test.ts` (borrador del producto) |
| 13 | Sin productos duplicados | idempotencia de operaciones y `processed_updates` (`assistant.test.ts`, `telegram.test.ts`) |
| 14 | Revisar antes de activar | vista privada + solicitud pendiente, tienda en borrador (test + staging) |
| 15 | Sin acceso cruzado | botones de otra tienda rechazados, operador sin permisos, `tenant-isolation.test.ts` |
| 16 | SneakerHub sigue funcionando | composición “Personalizado” sin cambios (verificado en navegador local); staging principal idéntica antes/después |
| 17 | Bot Maestro y bot de Pruebas sin cambios | `master/bot.test.ts`; staging `/api/master/webhook` 503 (sin configurar, igual que antes); webhook del asistente sin modificar |

## 7. Registro de staging (2026-11-03)

- Respaldo: `.tmp/staging-0008/staging-pre-0008.sql` (88.256 bytes, SHA-256 `f610787c…dc7`, ignorado por Git). Time Travel previo: `000000a7-00000000-00005119-1d8fb18e0efd16ec1b3a4bf6ae129278`.
- Verificación local sobre copia: migración y reversión con datos idénticos (hashes por tabla). El aviso “tablas de plataforma retiradas” del verificador corresponde a `0007` y no aplica.
- `0008` aplicada en `sneakerhub-telegram-staging-db` (config `wrangler.remote-staging.toml`): 1 tienda, 2 productos, 5 variantes, 0 violaciones de FK; tienda 1 registrada como existente.
- Worker `sneakerhub-telegram-staging`: `8a7afb51` → `9a7869f1` → **`b6b92066-2340-4620-abed-1d6bbe3aa4ac`** (protección de botones con URL relativa).
- E2E por HTTPS 15/15 con tiendas ficticias `prueba-onboarding-*` y un usuario de Telegram ficticio: bienvenida, datos, “tonos azules”, paleta, plantilla Urban persistente, `/ayuda`, botón de otra tienda rechazado, solicitud pendiente, tienda en borrador, 0 productos, tienda principal idéntica; tiendas ficticias eliminadas sin restos (solo quedan auditorías de plataforma `admin_login`/`store_purged`).
- Smoke: health 200, tienda 200, productos 200, tienda inexistente 404, admin sin sesión 401, webhook sin secreto 403, bot maestro 503 (no configurado en staging).
- No se modificaron webhooks, secretos ni bots. Producción y Netlify sin cambios.

Reversión de staging:

```powershell
cd worker
npx wrangler rollback 8a7afb51-665a-4eaf-a3b3-4fe14d9f3a1e --config wrangler.remote-staging.toml
npx wrangler d1 execute sneakerhub-telegram-staging-db --remote --config wrangler.remote-staging.toml --file ../database/rollback/0008_store_onboarding.down.sql
```

## 8. Publicación en producción

**Registro (2026-11-03, autorizado):** commit `b110b2d` en `main`; respaldo `.tmp/production-0008/production-pre-0008.sql` (205.972 bytes, SHA-256 `efb1e293573267d02c1fdef7a8ff8b9a049f813a16c257fde7a9e06329e5df02`); Time Travel previo `00000084-00000024-00005119-d451fe6e78c2eb96805659e29b3f44ca`. Verificación sobre copia: 18 tablas con hash idéntico tras migrar y revertir. `0008` aplicada en `catalogo-lite-production-db`: 3 tiendas, 29 productos, 114 variantes, 13 categorías, 7 pedidos y 54 auditorías sin cambios; 0 violaciones de FK; tiendas 1, 2 y 3 marcadas como existentes. Worker `catalogo-lite-api`: `88c33008` → `ac6acb57-4ee2-4174-8705-bff90877cf99`; 10 secretos intactos. Smoke: health 200, SneakerHub/Distribumax/Muy Parcero 200, tienda inexistente 404, admin 401, webhooks del asistente y del maestro 403 sin secreto. Netlify publicó `index-DrZH2Exj.js`; SneakerHub y Muy Parcero cargan sin errores ni desbordamiento (375 y 1280 px), SneakerHub con su composición anterior.

Reversión de producción (no bajar de `f9928a44`):

```powershell
cd worker
npx wrangler rollback 88c33008-53b2-4b2e-bf69-2837850a5ee8 --config wrangler.production.toml
npx wrangler d1 execute catalogo-lite-production-db --remote --config wrangler.production.toml --file ../database/rollback/0008_store_onboarding.down.sql
```

El frontend se revierte desde Netlify (publicar el deploy anterior) o con `git revert b110b2d`.

Procedimiento seguido:

1. Commit y push a `main` (Netlify publica el frontend: plantillas, vista previa y panel).
2. Respaldo de `catalogo-lite-production-db` (`wrangler d1 export … --remote --config wrangler.production.toml`) y bookmark de Time Travel.
3. `npx wrangler d1 migrations apply catalogo-lite-production-db --remote --config wrangler.production.toml` (solo `0008`).
4. `npx wrangler deploy --config wrangler.production.toml`. **No revertir por debajo de `f9928a44`** (secretos del bot maestro).
5. Smoke: tienda pública SneakerHub, `/api/store`, admin 401, webhooks 403, bot maestro `status`.
6. Prueba manual: crear una tienda de prueba desde el bot maestro con tu cuenta como propietario, recorrer el onboarding en `@SneakerHubAdmin_bot`, y eliminarla con la purga protegida.

Orden recomendado: Worker y frontend el mismo día. Mientras el Worker de producción sea el anterior, el panel nuevo puede guardar colores, pero el cambio de plantilla del panel solo queda registrado en `stores.template` tras desplegar el Worker.

## 9. Riesgos y limitaciones

- **Staging sin frontend ni URL pública:** los botones 👁 / Ver mi tienda se omiten en staging (no hay `PUBLIC_STORE_BASE_URL`). La vista previa se probó en local; en producción los enlaces apuntan a Netlify.
- **No se probó con Telegram real** (las actualizaciones de staging fueron simuladas con un usuario ficticio). Falta recorrer el flujo en `@SneakerHubPruebas_bot` o en producción con una tienda de prueba.
- La vista previa necesita sesión del panel; el propietario debe haber activado su acceso.
- Lectura determinista solo para PNG comunes; JPG/WebP dependen de Gemini y su presupuesto (si no hay, se ofrecen paletas accesibles).
- En Telegram la plantilla conserva los colores elegidos; en el panel, al elegir una plantilla se usan sus colores recomendados manteniendo los de marca que pasen el contraste. Ambos caminos guardan paletas legibles.
- La portada “a sangre” (Luxury, Urban, Gourmet) recorta los bordes de la foto para llenar el ancho (sin deformarla); las demás muestran la foto completa.
- Un mismo propietario con varias tiendas tiene un avance por tienda.
