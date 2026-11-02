# Gestión administrativa de pedidos

## Requisitos previos

El módulo requiere aplicar `database/migrations/0006_order_management.sql` a cada D1 antes de desplegar la versión correspondiente del Worker. La migración es aditiva: conserva `orders.items_json`, agrega los campos de entrega/pago, la clave idempotente, revisión e imagen de variante, y crea historial y operaciones de inventario. No hay una tabla `order_items` en el esquema anterior; las líneas se mantienen como instantáneas JSON para no duplicar información.

La migración no se ha aplicado a la D1 comercial. El Worker desplegado seguirá usando el contrato anterior hasta que haya revisión y despliegue coordinado.

## Comportamiento

- El catálogo del Worker aporta nombre, SKU, variante, talla, color, precio e imagen al tomar la instantánea. Se usa primero `product_variants.image_url` y luego la primera entrada de `products.image_urls`. Si no hay imagen válida, el panel muestra “Sin foto”.
- Un pedido nuevo queda `pendiente`. El backend calcula el subtotal y deja el envío y total definitivo como `NULL` hasta que un administrador cotice el envío. La moneda se toma de la configuración del Worker.
- La confirmación administrativa reserva el inventario en una transacción D1 y falla si alguna variante ya no tiene stock. Una cancelación antes del envío libera solo la reserva registrada para ese pedido. El flujo prohíbe cancelar después de enviado o entregado. Pedidos anteriores a esta migración quedan con `inventory_managed = 0` y no alteran stock al cambiar de estado.
- El estado de pago es independiente. Seleccionar transferencia u otro medio solo expresa la preferencia del comprador; no marca el pago como verificado.
- La clave de idempotencia del checkout evita duplicar el registro al reintentar el mismo contenido. WhatsApp se abre después de recibir el número del pedido. La interfaz dice que el pedido quedó registrado y que el mensaje solo se envía al pulsar Enviar.
- Las URL de fotos en WhatsApp son enlaces públicos del sitio; no se afirman como archivos adjuntos.
- Los datos personales aparecen solo en las rutas de administración protegidas por sesión. Los eventos y registros de auditoría no incluyen teléfono, dirección, correo ni observaciones.

## Revisión y despliegue

Antes de publicar, ejecutar la migración en el entorno aprobado y probarla con datos de respaldo/controlados. Después desplegar el Worker con el nuevo contrato y publicar el frontend. No mezclar el despliegue de esta versión con cambios de Telegram, D1/R2 adicionales o secretos.
