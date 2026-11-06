# Pedidos: seguimiento, envío y guías por foto

Antes de cambiar nada se revisaron la base de datos, las API, las estadísticas, el panel y el bot. Se reutilizaron:

- Los estados existentes.
- El historial `order_events`, que ya registraba pedidos reales desde 0006.
- El control de revisión, que rechaza ediciones simultáneas.
- Los disparadores de inventario.
- El servicio `transitionOrder`, que ya usaba el bot. El panel ahora usa el mismo servicio.

## 1. Estados del pedido

Se conservaron los identificadores internos, porque los usan los disparadores, las estadísticas y el bot. Esta es su equivalencia:

| Interno (sin cambios) | Equivalente | Etiqueta visible |
|---|---|---|
| `pendiente` | pending | Pendiente |
| `confirmado` | confirmed | Confirmado |
| `preparando` | preparing | En preparación |
| `enviado` | handed_to_carrier | **Entregado a transportadora** (antes «Despachado») |
| `entregado` | delivered | Entregado |
| `cancelado` | cancelled | Cancelado |

**Transiciones hacia adelante:**
- pendiente → confirmado o cancelado.
- confirmado → preparando, enviado, entregado (entrega local) o cancelado.
- preparando → enviado, entregado (entrega local) o cancelado.
- enviado → entregado.

**Volver atrás:**
- Se permite preparando → confirmado, enviado → preparando y entregado → enviado o preparando.
- Solo puede hacerlo el propietario o un administrador, y debe escribir un motivo, que queda en el historial.
- Nunca se toca la reserva de inventario: se reserva al confirmar y solo se libera al cancelar.

## 2. Estado de envío independiente

La columna nueva `shipping_status` admite estos valores:

- Pendiente de cotización
- Pendiente de despacho
- Preparando envío
- Entregado a transportadora
- En tránsito
- Entregado al cliente
- Incidencia de entrega
- Sin envío (entrega personal o retiro)

El servidor rechaza los estados contradictorios. Por ejemplo, «Entregado al cliente» no es válido si el pedido no está entregado, y «En tránsito» solo es válido si el pedido está entregado a transportadora. Cuando un pedido no tiene el estado de envío guardado, incluidos los pedidos antiguos, se muestra uno derivado del estado del pedido.

## 3. Datos de la transportadora

Al marcar «Entregado a transportadora» se registran:

| Dato | Regla |
|---|---|
| Transportadora | Obligatoria. |
| Número de guía | Nunca se genera. |
| Fecha de entrega a la transportadora | Por defecto, hoy. |
| Costo del envío | Número entero en la moneda del pedido. |
| URL de seguimiento | Opcional, solo `https://`. |
| Notas | Opcionales. |

No hay integración con transportadoras, así que el sistema nunca afirma que haya seguimiento automático.

## 4. Confirmación de entrega

Se registran la fecha, el método (transportadora, entrega personal, retiro en tienda, mensajero u otro), el receptor, las observaciones y la referencia de confirmación. El método es obligatorio y el estado del pago **no cambia**. Una entrega local no exige transportadora.

## 5. Historial

Cada cambio queda registrado con:

- El estado anterior y el nuevo.
- La fecha y la hora.
- El usuario que lo hizo.
- Las observaciones o el motivo.
- El identificador del evento.

El panel lo muestra como una línea de tiempo, junto con el avance «Pedido recibido → Confirmado → En preparación → Entregado a transportadora → Entregado». No se inventó historial para los pedidos antiguos.

## 6. Panel

El detalle del pedido se organiza en ocho secciones:

- **A.** Artículos del pedido
- **B.** Datos del comprador
- **C.** Resumen económico
- **D.** Estado del pedido
- **E.** Estado del pago
- **F.** Información de envío: incluye la foto de la guía, que se puede ver, descargar y subir.
- **G.** Historial del pedido
- **H.** Notas internas

**Indicadores:** cada estado se muestra con un ícono, un texto y un color, nunca solo con el color.

**Botón «Guardar cambios»:**
- Evita los dobles envíos.
- Muestra la confirmación real de lo que se guardó.
- En el celular queda fijo abajo.

**Otros controles:**
- Botón «Copiar datos de seguimiento».
- Botón «Avisar al cliente por WhatsApp»: abre un mensaje ya redactado para que el comerciante lo revise y lo envíe él mismo. No se envía nada automáticamente.

**Estadísticas:** pendientes, confirmados, en preparación, en transportadora, en tránsito, entregados y cancelados. Cada pedido cuenta una sola vez y cada tarjeta funciona como filtro.

## 7. TiendIA en Telegram

**Mensajes que entiende:**
- «Marca el pedido 123 como entregado a transportadora».
- «El pedido 123 ya fue entregado»: pregunta el método de entrega.
- «¿Qué pedidos tengo pendientes de enviar?».
- «Muéstrame los pedidos que están en tránsito».
- «¿Qué pedidos entregué a transportadora hoy?».
- «Muéstrame la guía del pedido 123».
- «¿Qué número de guía tiene el pedido 123?».
- «Corrige la transportadora de ese pedido».

Ahora también reconoce los números de pedido cortos, como «pedido 123». Antes solo leía los códigos de cuatro o más caracteres.

En todos los casos el bot sigue estos pasos:
1. Identifica el pedido.
2. Verifica los permisos.
3. Consulta el estado real.
4. Prepara el cambio y pide confirmación.
5. Lo aplica con el servicio de pedidos y confirma el resultado.

**Guía por fotografía** (`services/assistant/shippingGuide.ts`):

1. **Cómo se activa.** La guía llega como foto o como archivo. Se activa con un texto como «Registra esta guía» o «Esta es la guía del pedido 123», con el botón «📷 Registrar guía» del pedido o con la opción «🚚 Es una guía de envío».
2. **De dónde salen los datos.** Primero del texto que escribe el comerciante. La IA de visión solo se usa si el comerciante pulsa «Leer la guía con IA», que antes muestra el costo. La IA pasa por el sistema de créditos con la función `leer_guia_envio`: si falla no se cobra y la misma foto no se cobra dos veces. Sin créditos ni IA, los datos se pueden escribir a mano.
3. **Número de guía.** Solo se acepta si está rotulado como tal. Si hay números ambiguos, se muestran como opciones y nunca se elige uno solo. Los campos escritos a mano se marcan para revisarlos.
4. **Qué pedido es.** Se usa la referencia que escribe el comerciante, luego el pedido de la conversación y luego la referencia impresa en la guía. Si el destinatario coincide con varios pedidos, se muestran opciones y nunca se vinculan solos. Nunca se buscan pedidos de otro comercio.
5. **Tarjeta de confirmación.** Muestra «Encontré estos datos de envío» con los botones Confirmar y actualizar, Corregir datos, Elegir otro pedido y Cancelar. Las correcciones se escriben en lenguaje natural, por ejemplo «No es Servientrega, es Coordinadora».
6. **Al confirmar.**
   - Se verifican los permisos, que el pedido es de la tienda y su estado actual.
   - Se guarda la foto y se aplica el cambio por el servicio de pedidos.
   - El estado pasa a «Entregado a transportadora» solo si el pedido estaba confirmado o en preparación.
   - Si la guía parece sin despachar, primero pregunta si el paquete ya se entregó a la transportadora.
   - Una guía **nunca** marca el pedido como entregado al cliente.
7. **Duplicados.** Una foto o una guía ya registrada no genera eventos ni cambios nuevos. Los reintentos de Telegram se ignoran, porque cada mensaje se procesa una sola vez y la tarjeta solo se aplica una vez.
8. **Almacenamiento.** La foto queda en R2, bajo `order-docs/<tienda>/<pedido>/`. Ese prefijo está bloqueado en la ruta pública de imágenes. La foto solo se descarga con la sesión de la tienda, con `private, no-store`, y se borra automáticamente 180 días después de que el pedido se entrega o se cancela. Si falla el almacenamiento, el pedido no cambia. Las respuestas del bot no muestran direcciones ni teléfonos.

## 8. Archivos

| Parte | Archivos |
|---|---|
| Migración aditiva | `database/migrations/0016_order_tracking.sql` (reversión en `database/rollback/0016_order_tracking.down.sql`) |
| Servidor | `worker/src/services/orders.ts`, `orderDocuments.ts`, `assistant/shippingGuide.ts`, `assistant/orders.ts`, `routes/orders.ts`, `routes/upload.ts`, `services/platform.ts` (el borrado de una tienda incluye sus guías), `index.ts` (limpieza programada) y `ai/credits.ts` |
| Panel | `frontend/src/admin/pages/Orders.tsx`, `frontend/src/lib/orderStatus.ts`, `services/api.ts` y `Dashboard.tsx` |
| Pruebas | `worker/src/routes/orders-tracking.test.ts` (6) y `worker/src/services/assistant/shippingGuide.test.ts` (17, que cubren los 18 escenarios exigidos y los casos de Telegram) |

## 9. Verificación

- Servidor: **363/363**. Panel: **81/81**.
- Staging de punta a punta: **24/24**. Se usaron el servidor, D1 y R2 reales, y una tienda, una cuenta y unos pedidos ficticios que se eliminaron al final. Se cubrieron:
  - el ciclo completo con historial;
  - la entrega local;
  - el pago independiente;
  - las estadísticas;
  - la guía privada;
  - Telegram (despacho, guía escrita y entrega);
  - el panel en escritorio y en celular.

## 10. Limitaciones

- **Lectura de la foto:** Cloudflare Workers no tiene un OCR convencional ni un lector de códigos de barras sin agregar dependencias pesadas. Por eso los datos salen del texto que escribe el comerciante o, si lo autoriza, de la IA de visión.
- **Prueba en staging de la foto desde Telegram:** el flujo completo se probó con pruebas automáticas que simulan Telegram. Una prueba real necesita que una persona envíe una foto al bot.
- **Seguimiento:** no hay seguimiento automático con las transportadoras. «En tránsito» e «Incidencia» los marca el equipo.
- **Avisos al cliente:** no se envían automáticamente, porque no hay un canal autorizado con su consentimiento. El panel prepara el mensaje de WhatsApp.
- **«Muéstrame la guía» en Telegram:** el bot reenvía las fotos que se recibieron por Telegram. Las que se subieron desde el panel se ven en el panel.
- **Costo de la IA:** `leer_guia_envio` no tiene costo en créditos configurado, así que usa el presupuesto de IA del plan. El superadministrador puede asignarle un costo.

## 11. En producción (2026-11-06, autorizado)

| Paso | Resultado |
|---|---|
| Respaldo | `.tmp/production-0016/production-pre-0016.sql`. Time Travel `000001d0-00000000-0000511b-1c651258aebd7695cbf7ff96e6ca0782`. |
| Migración | `0016` aplicada. Se verificaron 7 columnas, la tabla `order_documents` y 2 índices. |
| Servidor | `87e31055` → `60ed2b6e-91e4-4f35-8201-85f415e2b202`. |
| Panel | `f3011324` → `4f9f13de-6b87-4886-a643-5ee94f0ce305`. |
| Verificación | Salud 200 y los 10 secretos intactos. Ambos webhooks responden 403 sin secreto. Las estadísticas y las guías piden sesión (401). La ruta pública no sirve `order-docs/` (404). Datos sin cambios: 4 tiendas, 161 productos, 14 pedidos con los mismos estados, 24 eventos y 3 usuarios; ningún estado de envío quedó marcado automáticamente. El panel y la tienda cargan sin errores. No se tocaron pedidos reales. |
| Commit | `3b1ddd7` |

## 12. Pasos para producción (referencia)

1. Respaldar la base de datos.
2. Aplicar `0016` y **verificar las columnas**. En staging el primer intento falló de forma transitoria sin aplicar nada.
3. Desplegar el servidor.
4. Desplegar el panel.

Para revertir: volver a las versiones anteriores del servidor y del panel, y después aplicar `0016`.down.
