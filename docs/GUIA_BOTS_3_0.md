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

Lenguaje natural: “crea una tienda llamada Moda Urbana”, “suspende moda-urbana por falta de pago”, “sube el límite de IA de moda-urbana a 5 dólares”, “muéstrame las tiendas activas”.

Una tienda nueva queda en **borrador**: privada hasta que la actives. Si la creación falla, “Reintentar” continúa el mismo proceso sin duplicarla.
