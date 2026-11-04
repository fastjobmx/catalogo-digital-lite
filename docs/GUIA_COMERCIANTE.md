# Guía del comerciante

Esta guía explica, en lenguaje sencillo, cómo administrar tu tienda sin conocimientos técnicos. Puedes trabajar desde el **panel web** (`/admin`) o desde el **bot de Telegram**.

## Entrar al panel

1. Abre en el navegador: `https://tu-tienda.com/admin`
2. Escribe tu correo y contraseña.
3. Pulsa **Entrar**.

> En una demo local, consulta el archivo privado `worker/.dev.vars` de esa instalación. El generador crea credenciales únicas y el archivo no debe subirse a Git ni copiarse a chats. En producción usa los secrets del Worker.

El menú lateral tiene siete secciones:

| Sección | Para qué sirve |
|---|---|
| **Resumen** | Ver de un vistazo productos, categorías, stock total y pedidos del día |
| **Productos** | Crear, editar, archivar y restaurar productos, y ajustar el stock por talla |
| **Categorías** | Organizar el catálogo (Running, Casual, Accesorios…) |
| **Configuración** | Nombre, colores, logo, portada, WhatsApp, horarios y redes |
| **Cuestionario** | Configurar la tienda paso a paso (útil si aún no usas Telegram) |
| **Simulador IA** | Probar cómo interpretaría el asistente tus instrucciones |
| **Pedidos** | Consultar los pedidos recibidos |

## Crear tu primer producto

1. Ve a **Productos** → **Nuevo producto**.
2. Completa: nombre, referencia (SKU), precio, descripción y categoría.
3. Si el producto tiene varias tallas o colores, agrega **variantes**. Ejemplo:

   | Variante | Stock |
   |---|---|
   | Talla 38 | 20 |
   | Talla 39 | 20 |
   | Talla 40 | 20 |
   | Talla 41 | 20 |
   | Talla 42 | 20 |
   | Talla 43 | 20 |
   | Talla 44 | 20 |

   Esto significa **20 unidades por talla** (140 en total), no un solo número para todo el producto.
4. Sube las fotos.
5. Marca **Destacado** si quieres que aparezca en la portada.
6. Guarda.

> **Importante:** el inventario es **independiente por variante**. Si vendes 3 tallas 42, el stock de la talla 42 baja a 17, y las demás no cambian.

## Editar, archivar y restaurar

- **Editar**: cambia precio, fotos, categoría o destacado. Los cambios se ven al instante en la tienda.
- **Archivar**: retira un producto del catálogo **sin borrarlo**. Deja de mostrarse en la tienda, pero puedes recuperarlo.
- **Restaurar**: vuelve a publicar un producto archivado.

No existe el borrado definitivo desde el panel, para evitar pérdidas accidentales.

## Ajustar stock

En **Productos**, abre el producto y edita el stock de cada talla. Guarda y el cambio se refleja al momento.

## Personalizar la tienda

En **Configuración** puedes cambiar, sin tocar código ni volver a publicar:

- **Identidad**: nombre, descripción, eslogan, tipo de negocio.
- **Diseño**: colores primario, secundario, de acento y de botones; logo, favicon y portada.
- **Contacto**: WhatsApp (general y de pedidos), teléfono, correo, dirección, horarios.
- **Redes**: Instagram, Facebook, TikTok y enlace de mapa.
- **Tienda**: moneda, país, métodos de entrega, información de pago y mensaje predeterminado de WhatsApp.

Al guardar, la tienda muestra los nuevos colores y datos inmediatamente.

En **Apariencia** puedes probar 13 familias visuales con una vista previa de la tienda antes de guardar. El editor conserva tus productos y muestra 12 paletas listas para usar. También puedes subir un logotipo PNG, JPG o WebP, revisar tres combinaciones generadas y ajustar los tonos con el selector o con HEX. Si una combinación no tiene suficiente contraste, el panel te indica qué corregir.

Desde Telegram, usa **⚙️ Configurar mi tienda** o `/configurar` para abrir los accesos permanentes a datos de contacto, logotipo, colores, plantilla, portada, productos y vista previa privada. Esta vista previa pide iniciar sesión y no activa la tienda.

## Usar el bot de Telegram (opcional)

Con el bot puedes crear y modificar productos conversando:

> **Tú:** Agrega producto Reebok referencia RBK-2514 precio 189900 stock 20 desde 38 hasta 44
>
> **Bot:** Crear Reebok (RBK-2514) a 189900 con 7 variantes y 140 unidades en total.
> Responde SÍ para confirmar o NO para cancelar.
>
> **Tú:** Sí
>
> **Bot:** ✅ Producto creado.

Comandos útiles: `/stats`, `/productos`, `/categorias`, `/pedido`, `/configurar`, `/continuar`, `/ayuda`.

Si acabas de recibir una tienda nueva, el asistente te ofrecerá configurarla paso a paso. Puedes salir cuando quieras y retomarla con `/continuar`. Los propietarios de tiendas existentes conservan su saludo habitual; pueden iniciar el recorrido manualmente con ese comando.

El bot **nunca inventa** precios, stock ni fotos: si falta un dato, te lo pide.

## Recibir pedidos

Cuando un cliente arma su carrito y pulsa **Pedir por WhatsApp**, se abre WhatsApp con el pedido ya formateado (productos, tallas, cantidades y total). El pedido llega a tu número configurado en **Configuración → WhatsApp de pedidos**.

En **Pedidos** del panel puedes ver el historial registrado.

## Consejos

- Usa buenas fotos cuadradas (por ejemplo 800×800) para que las tarjetas se vean uniformes.
- Escribe textos concretos: "Tenis de cuero para uso diario", no frases vacías.
- Revisa **Resumen** cada mañana para detectar stock bajo.
- Cambia la contraseña de administrador antes de compartir la tienda.
