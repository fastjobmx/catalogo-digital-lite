# Mini tienda de prueba y conversión a cliente (Tienda IA Express)

Este cambio mejora el módulo de prueba sin registro que ya existía (`/prueba`). Reutiliza su servidor, su token privado de edición y la limpieza programada. La conversión en tienda usa la creación normal de tiendas (`provisionStore`), el alta de productos (`createCatalogProduct`), el logo (`setStoreLogo`) y la invitación de cuenta (`sendInvitation`). No existe un segundo sistema de usuarios. La página MOSTRALO PUES! no se modificó.

## Qué hace

| Paso | Detalle |
|---|---|
| Crear | Se piden solo el nombre del negocio y la plantilla. No se pide correo ni contraseña. La plantilla por defecto es Clásica. |
| Editar | Se puede cambiar el logo (opcional), el color principal y el de acento, la plantilla (Clásica, Boutique o Stories) y el WhatsApp para recibir pedidos. Admite hasta 7 productos con una foto, nombre, precio y descripción opcional. La vista previa se actualiza al instante y los cambios se guardan solos. |
| Pantalla | En escritorio, el editor queda a la izquierda y la vista previa centrada (marco de celular), sin barras de desplazamiento internas. En celular hay pestañas «Editar» y «Vista previa». |
| Temporal | Dura 7 días. Una barra siempre visible dice «Tienda temporal» y muestra si recibe pedidos y el tiempo restante. La tienda lleva el enlace «Creado con Tienda IA Express». |
| Pedidos reales | Si el comercio puso su WhatsApp, los clientes agregan productos con precio al carrito y envían el pedido al WhatsApp del comercio. El servidor recalcula el total con los precios guardados, sin confiar en el navegador, y asigna un código `PRB-XXXXXX`. No hay pago en línea ni inventario: el pago y la entrega se acuerdan por WhatsApp, y así se le avisa al comprador. El comercio ve los pedidos en «Pedidos recibidos». No se guarda el teléfono del comprador. Los pedidos se borran con la prueba o al convertirla. Límites: 20 pedidos por red y hora, y 200 por tienda al día. El superadministrador puede apagar los pedidos de todas las pruebas. |
| Compartir | El enlace `/prueba/<id>` es solo de lectura. El token de edición queda únicamente en el dispositivo que creó la prueba y nunca va en el enlace. |
| Activar | El botón «QUIERO ACTIVAR MI TIENDA» aparece en la barra, en la pantalla final, en el enlace compartido y en la prueba vencida. Abre los planes reales del sitio comercial (Catálogo Lite, Catálogo IA, Soluciones a medida), sin precios. Luego pide nombre, correo, WhatsApp opcional y consentimiento, y entrega un código `TIE-XXXXXX`. Desde el enlace compartido solo ofrece WhatsApp o crear una prueba propia. |
| Vencer | Pasado el plazo, la prueba no se puede editar. El público ve el aviso y la fecha de borrado; quien la creó ve su catálogo y puede pedir la activación. Al terminar la conservación se borran las fotos y los datos; la fila queda vacía solo para las métricas. Una solicitud pendiente conserva la prueba al menos 14 días. |
| Convertir | El superadministrador confirma el plan con el cliente y pulsa «Convertir en tienda» en `/plataforma/pruebas`. Se crea una tienda **en borrador** con el mismo nombre, colores, plantilla, logo y productos (SKU `PRUEBA-1` a `PRUEBA-7`, fotos copiadas a la tienda; el WhatsApp de la prueba pasa a la tienda). El propietario es una cuenta normal con el correo de la solicitud. Recibe la invitación por correo si hay proveedor; si no, el enlace se muestra una sola vez para enviarlo en privado. Al abrir la invitación desde el correo, el correo queda verificado. La tienda se publica y recibe pedidos solo cuando la plataforma la activa, como cualquier otra. |

No hay cobro en línea ni activación automática. No se simulan pagos.

### Seguridad

- La conversión es idempotente: usa la clave de creación `trial-<id>`, SKU fijos y el resultado guardado. Convertir dos veces o reintentar tras un fallo no duplica nada.
- Solo quien tiene el token de la prueba puede pedir su activación. Solo el superadministrador convierte.
- No se guardan enlaces ni tokens en claro.
- Las pruebas no se mezclan con las tiendas reales.

## Ajustes (superadministrador, sin cambiar código)

Se editan en `/plataforma/pruebas` y se aplican a las pruebas nuevas:

| Ajuste | Valor por defecto |
|---|---|
| Duración | 168 h (7 días) |
| Conservación tras vencer | 72 h |
| Productos por prueba | 7 |
| Pedidos reales por WhatsApp | Activados |
| Tamaño máximo por foto | 3 MB |
| Plantillas disponibles | Clásica, Boutique y Stories |
| Pruebas por día | 300 |
| Pruebas por red y hora | 5 |

Límites fijos: 60 fotos y 600 guardados por red y hora, y como máximo (productos + 1) × 4 fotos subidas por prueba. Las fotos que dejan de usarse se borran al guardar y se validan por su contenido real. La prueba no usa IA.

Las métricas son reales: pruebas creadas, vigentes, vencidas, borradas y convertidas, plantillas elegidas, productos por prueba, solicitudes y tasa de conversión.

## Archivos

| Parte | Archivos |
|---|---|
| Migración aditiva | `database/migrations/0015_trial_minitienda.sql` (reversión en `database/rollback/0015_trial_minitienda.down.sql`) |
| Servidor | `worker/src/services/trials.ts`, `trialSettings.ts`, `trialConversion.ts`, `worker/src/routes/trial.ts`; rutas nuevas `/api/platform/trials/*` |
| Panel | `frontend/src/pages/TrialPage.tsx`, `frontend/src/pages/trial/{TrialPreview,ActivationDialog}.tsx`, `frontend/src/admin/PlatformTrialsPage.tsx` |

## Verificación (staging)

- Servidor: 319/319 pruebas, 17 de ellas de este módulo, que cubren los 14 casos obligatorios.
- Panel: 81/81 pruebas.
- Navegador contra staging, con la migración 0015 aplicada y el servidor en `2bf5cd38`: 33/33 comprobaciones, incluido un pedido real de un comprador que llega al WhatsApp del comercio con el total calculado por el servidor. Recorre todo el flujo, de crear la tienda sin registro a la conversión sin duplicados, el vencimiento y las tiendas existentes intactas. La tienda creada por la prueba se borró al terminar.

## En producción (2026-11-05, autorizado)

| Paso | Resultado |
|---|---|
| Respaldo | `.tmp/production-0015/production-pre-0015.sql`. Time Travel `0000018e-00000000-0000511a-6fccf280cb01e3d9dc533378a674cae2`. |
| Migración | `0015` aplicada en `catalogo-lite-production-db`. |
| Servidor | `catalogo-lite-api` pasó de `13561c72` a `dcb2c207-dff8-4a07-8681-e78234c7a106`. |
| Panel | `catalogo-digital-ia` en `8a155ad5-8521-479e-9a84-e70450c3880f`. |
| Verificación en vivo | Salud 200 y los 10 secretos intactos. Los ajustes quedan en 7 días, 7 productos y pedidos activos. Se creó una prueba, se le hizo un pedido (código `PRB-…`, total del servidor 36.000, sin acceso público a los pedidos), se rechazó un octavo producto y luego se borró la prueba. Las rutas de plataforma piden sesión. Siguen iguales 4 tiendas, 161 productos, 14 pedidos y 3 usuarios, sin pedidos de prueba guardados. `/prueba` carga sin errores. |
| Commit | `4a9a126` en `main`. |

## Pasos para producción (referencia)

1. Respaldar D1.
2. Aplicar `0015`.
3. Desplegar el servidor (`catalogo-lite-api`).
4. Desplegar el panel (`npm run deploy:cloudflare`).

Reversión: volver primero a las versiones anteriores del servidor y del panel, y después aplicar `0015`.down.
