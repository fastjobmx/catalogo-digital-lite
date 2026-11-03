# Catálogo Digital IA 3.0 — Plataforma multitienda

Estado al 3 de noviembre de 2026. Etiquetas: **Verificada** (probada con pruebas automáticas y/o ejecución real local), **Implementada, no verificada en vivo** (código y pruebas locales, falta Cloudflare/Telegram/Gemini reales) y **Planificada**.

## 1. Decisión de arquitectura

**Multitenencia compartida**: un Worker, una D1 y un R2 para todas las tiendas, con `store_id` en cada dato y verificación de acceso en el backend.

Se descartó crear D1/Worker por tienda: los bindings de Workers son estáticos (cada tienda exigiría redeploy y credenciales de API en tiempo de ejecución), multiplica costos y operaciones, y el generador de instalaciones independientes (`scripts/new-store.ps1`) sigue disponible para clientes que exijan infraestructura propia.

```
Comprador ──▶ Netlify /t/<tienda> ──X-Store-Slug──▶ Worker ──▶ D1 (store_id) / R2 (stores/<id>/…)
Propietario ─▶ Panel /t/<tienda>/admin (JWT usuario + membresía)
Propietario ─▶ Asistente Telegram compartido ─(ID numérico → membresías)─▶ Worker
Operador ───▶ Bot maestro / /plataforma (superadministrador por secretos) ─▶ Worker
```

- La tienda 1 (SneakerHub) sigue en la raíz; las nuevas en `/t/<dirección>`. Dominio propio: tabla `store_domains` + cabecera `X-Store-Host` (activación manual de DNS/Netlify).
- El cliente **nunca** envía un `store_id`: envía la dirección (slug) y el backend resuelve la tienda y comprueba la membresía y el rol.

## 2. Modelo de datos (migración 0007)

| Tabla | Propósito |
|---|---|
| `stores` | Registro: slug único, estado (`draft`, `active`, `suspended`, `cancelled`), plan, plantilla, límites de IA. `id` = `store_config.id`. |
| `platform_users`, `store_memberships` | Usuarios y roles por tienda: `owner`, `admin`, `operator`. |
| `user_access_tokens` | Activación de cuenta y vinculación de Telegram (solo hash, un uso, expiran). |
| `plans`, `store_services` | Planes (Básico, Profesional, Premium, Instalación existente) y servicios contratados (instalación, mantenimiento, dominio, IA…). Precios en 0: los define el operador. Sin cobros automáticos. |
| `ai_usage_events`, `ai_usage_monthly` | Consumo de Gemini por tienda: tokens, costo estimado, bloqueos, aviso al 80 %. |
| `provisioning_jobs` | Aprovisionamiento idempotente con pasos, intentos y errores. |
| `platform_operations`, `platform_conversations`, `platform_processed_updates` | Confirmaciones, asistente `/crear_tienda` y deduplicación del bot maestro. |
| `telegram_sessions`, `assistant_messages` | Tienda activa y memoria corta (24 h, 8 turnos) del asistente. |
| `platform_events` | Errores y avisos sanitizados para supervisión. |

`categories (store_id, slug)` y `products (store_id, sku)` son únicos **por tienda**: dos comercios pueden usar el mismo SKU o la misma categoría.

## 3. Roles y permisos

| Acción | Operador | Administrador | Propietario | Superadmin |
|---|---|---|---|---|
| Ver catálogo, pedidos, reportes | ✔ | ✔ | ✔ | ✔ |
| Ajustar stock, cambiar estado de pedidos | ✔ | ✔ | ✔ | ✔ |
| Productos, precios, categorías, apariencia, importaciones | | ✔ | ✔ | ✔ |
| Equipo (invitar/revocar) | | | ✔ | ✔ |
| Crear/suspender tiendas, planes, límites de IA, webhooks | | | | ✔ |

Una tienda suspendida bloquea su panel y su asistente; una en borrador solo la ve su equipo (vista previa privada).

## 4. Sistemas

### Sistema A — Bot maestro (`/api/master/webhook`)
Menú: Crear nueva tienda · Ver mis tiendas · Administrar propietarios · Configuración de plataforma · Estadísticas · Ayuda con IA. `/crear_tienda` guiado (nombre → tipo → estilo con botones → color si es personalizado → WhatsApp → propietario → plan → resumen con **Crear / Modificar / Cancelar**), `/tiendas`, `/tienda`, `/activar`, `/suspender`, `/plan`, `/limite_ia`, `/asignar_admin`, `/acceso`, `/dominio`, `/resumen`, `/salud`, `/errores`, `/propietarios`, `/configuracion`, `/pregunta`, y lenguaje natural (determinista + Gemini como respaldo). Todo cambio se confirma y se audita. Verificación y registro del webhook sin leer secretos: `POST /api/master/maintenance/status|webhook` (superadministrador o código de un solo uso; ver `DESPLIEGUE_Y_RECUPERACION_3_0.md` §4). — **Implementada; 14 pruebas del bot y 9 de mantenimiento con Telegram simulado**. Bot creado y secretos cargados; falta desplegar en producción, registrar el webhook (con autorización) y probar en Telegram real.

### Aprovisionamiento automático
Pasos: validar → identificador único → registro → configuración → plantilla → categorías iniciales → plan/servicios/IA → propietario → accesos de un solo uso → verificación (registro, configuración, plantilla, categorías, propietario, aislamiento). Reintento con la misma clave = mismo trabajo, nunca otra tienda. — **Verificada** en pruebas y en `workerd` local sobre copia de producción.

### Sistema B — Asistente por tienda (`/api/telegram/webhook`)
Un bot compartido; cada usuario de Telegram se asocia a sus tiendas (selector si tiene varias). Saludo con menú, alta de producto con **fotos → Gemini sugiere nombre/descripción/categoría/color → precio → stock → SKU sugerido → vista previa → publicar**, notas de voz, CSV de precios/stock con vista previa, PDF/TXT para consulta, cambio de banner/logo por foto con vista previa, consultas (poco stock, agotados, sin descripción/fotos, pendientes, más vendidos con datos reales), cambios confirmados (precio, stock, nombre, color, portada, WhatsApp, horario, redes, destacados, ocultar agotados, mover a categoría, descripción redactada por IA). Mensajes amables; errores técnicos solo en logs y `platform_events`. — **Implementada; flujos verificados con Telegram/Gemini simulados (21 pruebas)**. Gemini real ya respondió en sesiones anteriores; voz y visión reales no se probaron en esta sesión.

## 5. Seguridad y costos

- Acciones tipadas (Zod) y SQL parametrizado; Gemini nunca genera SQL ni ejecuta: propone acciones que el backend valida, autoriza y confirma.
- Regla anti-inyección en todos los prompts: el contenido de fotos, audios y documentos es dato, no instrucción. CSV con fórmulas se rechaza.
- Confirmación con instantánea “antes” y reclamación atómica (`pending → applying → applied`) en un lote D1: sin duplicados ni cambios a medias; propuestas obsoletas se rechazan.
- Imágenes nuevas en `stores/<id>/…`; el backend rechaza URLs de imágenes de otra tienda.
- Límites: 20 mensajes/minuto por chat (30 en el bot maestro), login con bloqueo tras 8 fallos, pedidos públicos limitados por IP, presupuesto mensual de IA por tienda con aviso y bloqueo, tope global opcional.

## 6. Pruebas

Worker 181/181 (21 archivos) con SQLite real sobre todas las migraciones (`worker/test/sqliteD1.js`): aislamiento entre tiendas (11 pruebas negativas), plataforma y aprovisionamiento (10), asistente (23), bot maestro (17), entrega de extremo a extremo (1) y mantenimiento (9), negocio (14), pedidos con disparadores reales (10), webhook (7). Frontend 58/58 y build OK. Detalle de comandos en `docs/PRUEBAS.md`.

## 7. Pendiente / planificado

Ver `docs/PENDIENTES.md` (sección Plataforma 3.0): aplicar `0007` y desplegar con autorización, crear el bot maestro, decidir el bot del asistente compartido, prueba real de voz/visión con Gemini, interfaz de equipo en el panel, automatización de dominios propios y cobros (fuera de alcance sin autorización).
