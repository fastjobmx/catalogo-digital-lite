# Entrega de una tienda nueva a un cliente

Todas las tiendas viven en la misma plataforma (un Worker, una base D1 y un bucket R2 compartidos) y quedan aisladas por `store_id`, validado en el backend. Crear una tienda **no** crea Workers, bases, buckets ni bots.

## 1. Crear la tienda (bot maestro)

En `@CatalogoDigitalMaestro_bot` (producción): **➕ Crear nueva tienda** o `/crear_tienda`. Preguntas, en orden:

1. Nombre del negocio.
2. Tipo de comercio (define las categorías iniciales: moda, calzado, tecnología, mascotas, belleza, hogar, joyería, alimentos o general).
3. Propietario: nombre y correo, o ID numérico de Telegram (o ambos). Ejemplo: `María Gómez maria@correo.com`.
4. WhatsApp comercial con código de país (o “Lo configura el propietario”).
5. Plantilla visual: Minimalista, Moderno, Premium o Personalizado.
6. Colores principales: uno o dos, por nombre o código (`azul oscuro y dorado`, `#153D70 #B08D57`), o los de la plantilla.
7. Logotipo opcional: foto o archivo PNG/JPG/WebP de al menos 128 px.
8. Plan (Básico, Profesional o Premium).

El resumen ofrece **Crear tienda · Modificar información · Cancelar**. Cancelar no deja registros. Tocar “Crear tienda” dos veces no duplica la tienda.

## 2. Qué recibe el administrador

- Nombre y dirección pública (`https://catalogo-digital-ia.netlify.app/t/<dirección>`).
- Estado: **Borrador** (privada; el público ve “Esta tienda no está disponible”).
- Panel: `…/t/<dirección>/admin`.
- Acceso del propietario: enlace de activación del panel (un solo uso, 72 h) y enlace de un toque al asistente IA de Telegram (o código `/link`). Si el propietario se registró con su ID de Telegram, ya queda vinculado.
- Instrucciones de uso y botones: Activar ahora · Ver ficha · Nuevos accesos · Crear otra.

No se muestran identificadores internos ni datos de infraestructura.

## 3. Entregar al cliente

1. Enviar **solo al propietario** el enlace de activación y el enlace del asistente (vencen en 72 h; si se pierden: “🔑 Nuevos accesos” o `/acceso <dirección>`).
2. El propietario abre el enlace, crea su contraseña y entra a su panel. Desde ahí carga productos, categorías, apariencia (logotipo, colores, portada) y datos de contacto.
3. Con el enlace del asistente, el propietario administra su tienda por Telegram en lenguaje natural: fotos para crear productos, notas de voz, cambios de precio o stock con confirmación. Solo ve y cambia su propia tienda.
4. Cuando tenga productos: **🚀 Activar ahora** (o `/activar <dirección>`). Desde ese momento la URL pública es visible.

## 4. Retirar una tienda de prueba

`DELETE /api/platform/stores/<dirección>` con sesión de superadministrador y cuerpo `{ "confirm": "<dirección>" }`.

- Solo para tiendas no activas: primero suspender (`/suspender` o `POST /api/platform/stores/<dirección>/status`).
- Nunca permite eliminar la tienda principal (SneakerHub).
- Borra en un solo lote todo lo de esa tienda (productos, variantes, categorías, pedidos, miembros, accesos, servicios, dominios, uso de IA, conversaciones, eventos y auditoría propios), los usuarios que solo pertenecían a ella y sus archivos en `stores/<id>/`. Deja constancia `store_purged` en la auditoría de la plataforma.
- No está en el bot maestro a propósito: es irreversible.

## 5. Asistente IA (Gemini) por tienda

- El asistente es **compartido**: un solo bot atiende a todos los propietarios. Producción usa `@SneakerHubAdmin_bot`; staging, `@SneakerHubPruebas_bot`.
- Cada cuenta de Telegram se asocia a tiendas por membresía (ID numérico de Telegram, nunca el nombre de usuario). Quien tiene una sola tienda trabaja siempre en ella. Si elige otra tienda en un botón, se ignora salvo que sea miembro. Todas las consultas y cambios usan el `store_id` de la sesión.
- La IA tiene presupuesto mensual por tienda según el plan (Básico US$ 1, Profesional US$ 3, Premium US$ 8; costo estimado), con aviso al 80 % y bloqueo al agotarse. Los botones y comandos siguen funcionando sin IA.
- Una tienda en borrador ya puede cargar productos por el asistente; una suspendida queda en pausa.

## 6. Verificación realizada (2026-11-03)

- Pruebas automáticas (Worker 181/181): conversación completa de `/crear_tienda` con logotipo, colores, entrega sin datos internos, doble toque sin duplicados, logotipo inválido, cancelación sin registros. También una entrega de extremo a extremo: activación del propietario, panel solo de su tienda, vista previa privada, personalización, publicación, catálogo separado, listado en el bot maestro, vínculo con el asistente limitado a su tienda, tienda principal idéntica y limpieza completa.
- Staging (`sneakerhub-telegram-staging`): tienda de prueba creada con el mismo servicio de aprovisionamiento, 10/10 pasos. Comprobado: idempotencia y dirección duplicada rechazada; activación y panel del propietario en el navegador; sin acceso a la tienda principal; publicación y URL pública; catálogo propio. Huella de la tienda principal idéntica antes y después. Luego se eliminó sin restos en 14 tablas.
