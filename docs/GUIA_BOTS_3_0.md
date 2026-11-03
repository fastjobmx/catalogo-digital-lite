# Guía de los bots — Plataforma 3.0

## Asistente de tu tienda (propietarios y equipo)

### Vincular tu cuenta
1. Entra al panel de tu tienda → **Configuración → Telegram → Generar código**, o usa el enlace que te envió la plataforma.
2. En Telegram abre el asistente y envía `/link TU-CODIGO` (o toca el enlace de un toque). El código sirve una sola vez.
3. Escribe **hola**.

### Qué puedes pedirle
| Quieres… | Escribe o envía |
|---|---|
| Publicar un producto | “Quiero agregar unos tenis negros” y luego las fotos. El asistente propone nombre, descripción, categoría y color; tú das el precio y las unidades. |
| Ver inventario | “Muéstrame los productos con menos de cinco unidades”, “¿qué está agotado?” |
| Cambiar precios o stock | “Cambia el precio de ABC123 a 180.000”, “Actualiza el stock de ABC123 talla 38 a 7” |
| Ocultar agotados | “Oculta todos los productos agotados” |
| Mejorar textos | “Escribe una descripción más atractiva para ABC123” |
| Organizar | “Mueve ABC123 y XYZ789 a la categoría Ofertas”, “Pon ABC123, XYZ789 como destacados” |
| Agregar fotos a un producto | “Agrega estas fotografías al producto con SKU ABC123” |
| Cambiar la apariencia | “Cambia el banner principal” (luego la foto), “Cambia el color principal a azul oscuro” |
| Pedidos y ventas | “Muéstrame los pedidos pendientes”, “¿Cuáles son los más vendidos este mes?” |
| Consejos | “Explícame cómo mejorar mi catálogo” |
| Importar | Envía un CSV con columnas `sku;precio;stock;talla`. Un PDF de proveedor se resume. |

También funciona con **notas de voz**. Antes de cambiar algo verás una vista previa con **Confirmar / Cancelar**; nada cambia hasta que confirmes. `/cancelar` descarta lo pendiente (no revierte cambios ya confirmados). Si administras varias tiendas, `/tienda` cambia de tienda.

El asistente no inventa precios, stock, marcas ni ventas: si falta un dato, te lo pregunta. Si la IA alcanzó el límite mensual de tu tienda, los botones y comandos siguen funcionando.

## Bot maestro (solo administración de la plataforma)

Solo responde a los IDs de `MASTER_ADMIN_TELEGRAM_IDS`, en chat privado. `/start` muestra el menú:

| Botón | Qué hace |
|---|---|
| ➕ Crear nueva tienda | Abre el asistente de `/crear_tienda`. |
| 🏪 Ver mis tiendas | Listado con estado, catálogo, pedidos, uso de IA y ficha de cada tienda. |
| 👤 Administrar propietarios | Propietario de cada tienda (correo, Telegram vinculado, panel activado) y botón de nuevos accesos. Asignar con `/asignar_admin`. |
| ⚙️ Configuración de plataforma | Entorno, sitio público, asistente de tiendas, modelo y costo estimado de IA, tope global, número de administradores y planes. Nunca muestra claves ni tokens. |
| 📊 Estadísticas | Resumen de la plataforma, con accesos a salud técnica y errores recientes. |
| ✨ Ayuda con IA | Responde una pregunta usando solo datos de la plataforma (sin correos de propietarios). Si la pregunta es una orden, pasa por la confirmación habitual. También: `/pregunta <texto>`. |

| Comando | Qué hace |
|---|---|
| `/crear_tienda` | Asistente guiado: nombre, productos, estilo (Minimalista, Moderno, Premium, Personalizado), color, WhatsApp, propietario, plan → resumen → **Crear tienda**. Entrega URL, enlace de activación y código de Telegram del propietario. |
| `/tiendas [activas\|borrador\|suspendidas]` | Listado con estado, catálogo, pedidos y uso de IA. |
| `/tienda <dirección>` | Ficha, salud técnica y acciones. |
| `/activar <dirección>` · `/suspender <dirección> [motivo]` | Publicar o pausar (con confirmación). |
| `/plan <dirección> <plan>` · `/limite_ia <dirección> <USD>` | Plan y presupuesto mensual de IA. |
| `/asignar_admin <dirección> <correo o ID>` · `/acceso <dirección>` | Propietario y nuevos accesos de un solo uso. |
| `/dominio <dirección> <dominio>` | Registra un dominio propio como pendiente. |
| `/resumen` · `/salud` · `/errores` | Supervisión. |
| `/propietarios` · `/configuracion` · `/pregunta <texto>` | Igual que los botones del menú. |
| `/cancelar` | Cancela el asistente o la operación pendiente sin crear ni cambiar nada. |

Lenguaje natural: “crea una tienda llamada Moda Urbana”, “suspende moda-urbana por falta de pago”, “sube el límite de IA de moda-urbana a 5 dólares”, “muéstrame las tiendas activas”.

Una tienda nueva queda en **borrador**: privada hasta que la actives. Si la creación falla, “Reintentar” continúa el mismo proceso sin duplicarla.
