# Módulos IA de MOSTRALO PUES! — Diagnóstico y plan (Fase 1)

Fecha: 2026-11-05. Alcance: los cinco módulos del «Prompt maestro de implementación». Este documento no cambia nada en producción.

## 1. Diagnóstico: lo que ya existe

| Área | Estado actual | Archivos |
|---|---|---|
| Llamadas a IA | Gemini por API REST desde el Worker. La clave vive solo en el backend. Modelo configurable con `GEMINI_MODEL`. | `worker/src/ai/geminiClient.ts` |
| Control de gasto IA | Presupuesto mensual por tienda en dólares estimados (`stores.ai_enabled`, `ai_monthly_budget_micros`, `ai_warn_percent`). El costo se estima por tokens, se registra *después* de cada llamada (`ai_usage_monthly`, `ai_usage_events`) y avisa al 80 %. Existe un tope global opcional (`PLATFORM_AI_MONTHLY_CAP_MICROS`). | `worker/src/ai/usage.ts`, migración `0007` |
| Panel del superadministrador | `PUT /api/platform/stores/:slug/ai` permite activar o desactivar la IA y fijar el presupuesto. | `routes/platform.ts`, `services/platform.ts` |
| Visión sobre fotos | Por Telegram: el borrador de producto desde una foto (`isProductPhoto`, nombre y descripción sugeridos) y los colores del logo. Las instrucciones ya ignoran texto escrito dentro de la imagen. **No está verificado contra la API real.** | `services/assistant/ai.ts`, `productDraft.ts`, `media.ts` |
| Importación masiva | Solo por Telegram: un CSV `sku, precio, stock` que **actualiza** productos existentes, con confirmación. No crea productos. No hay importación en el panel web. | `services/assistant/operations.ts`, `documents.ts` |
| Lectura de PDF y Excel | No existe. Ninguna dependencia lee PDF ni XLSX. Los documentos por Telegram solo se resumen con Gemini. | — |
| Plantillas | 13 plantillas (`TEMPLATE_KEYS`) con distribución por plantilla en el frontend. No hay formato vertical tipo historias. | `services/templates.ts`, `frontend/src/lib/templateLayouts.ts` |
| Prueba sin registro | No existe. Hay una demostración pública fija (`publicDemo.ts`) y la creación de tiendas por el bot maestro. | `frontend/src/lib/publicDemo.ts` |
| Planes | `basico`, `profesional`, `premium` y `legacy`, con límite de productos y presupuesto IA. Sus precios están en 0 en la base. | migración `0007` |

**Conclusión.** La base sirve: el backend ya es dueño de la clave, ya mide el consumo por `store_id` y ya existe el interruptor de IA por tienda. Faltan cuatro cosas:

- Un **saldo de créditos** con reserva previa: hoy se mide en dólares y se descuenta después de gastar.
- Un **importador web** que cree productos.
- La **plantilla vertical**.
- La **prueba anónima**.

## 2. Decisiones de diseño propuestas

### 2.1 Créditos (módulo 5, base de los demás)

- **Migración aditiva `0011`.** Tres tablas nuevas; no se toca ninguna columna existente.
  - `ai_credit_ledger`: un movimiento por fila, solo inserción. Campos:
    - `store_id`
    - `kind` ∈ `recarga | reserva | consumo | liberacion | ajuste`
    - `amount`, con signo
    - `idempotency_key` UNIQUE
    - `feature`
    - `actor`
    - `reason`
    - `created_at`

    El saldo se calcula como la suma de `amount`.
  - `ai_credit_costs`: créditos por acción, por ejemplo `foto_a_producto`, `estudio_fondo` o `pdf_pagina`. Solo el superadministrador la edita y **se crea vacía**: no fijo valores comerciales.
  - `ai_credit_requests`: solicitudes de recarga del comercio, con estado `pendiente | aprobada | rechazada`. **No hay pago en línea.** El superadministrador aprueba la solicitud después de cobrar por fuera, y esa aprobación crea la recarga en el libro.
- **Flujo de cada acción IA.**
  1. Reservar el costo, con una clave de idempotencia enviada por el cliente y ligada al `store_id` del token.
  2. Llamar a la IA.
  3. Convertir la reserva en consumo si salió bien, o liberarla si falló.
  - Una reserva sin cerrar se libera sola a los 15 minutos, con un cron que ya existe o al consultar el saldo.
- **Convivencia con lo actual.** El presupuesto en dólares se mantiene como tope de seguridad del costo real. El crédito es la unidad que ve el comercio.
  - Si una acción no tiene costo configurado, sigue funcionando como hoy, solo con el presupuesto.
  - Así nada que funcione hoy se bloquea por la migración.
- **Sin créditos o con la IA apagada**, todo lo básico sigue funcionando: crear productos a mano, editar, pedidos, Telegram y WhatsApp. Solo se deshabilitan los botones de IA y se explica el motivo.
- **Seguridad.**
  - El comercio solo **lee** su saldo y **pide** recargas.
  - Recargas y ajustes se hacen solo en `/api/platform/*`, con el rol superadmin, y quedan con el actor y el motivo.

### 2.2 Importación desde PDF, Excel y CSV (módulo 2)

- **Asistente de 6 pasos en el panel:** subir → detectar columnas → mapear → vista previa con errores → confirmar → resultado.
- **Lectura en el navegador** y validación en el Worker. El Worker tiene límites de CPU y memoria, así que el archivo se lee en el navegador y al backend solo llegan filas normalizadas en lotes de 50. El backend vuelve a validar todo con zod y usa el `store_id` del token.
- **Dependencias.** Requieren tu aprobación; se cargan solo dentro del asistente, con carga diferida.
  - `read-excel-file`: lee XLSX sin ejecutar fórmulas, toma el valor guardado, es pequeña y no tiene vulnerabilidades conocidas. Descarto `xlsx`/SheetJS de npm porque esa versión está desactualizada y tiene avisos de seguridad.
  - `pdfjs-dist`: extrae el texto de PDF con texto real, como el catálogo de Luz Mágica.
  - Para CSV no hace falta ninguna: se usa un lector propio con comillas y separador `,` o `;`.
- **PDF escaneado o sin tabla.** Opción con IA: Gemini lee cada página como imagen y propone filas. Cobra créditos por página y **siempre** pasa por la vista previa. Lo que no se pueda leer queda vacío y marcado; no se inventa precio, SKU ni stock.
- **Reglas.**
  - Crea solo productos nuevos.
  - Si el SKU ya existe, la fila se marca y **no se actualiza** el precio ni el stock, salvo que actives explícitamente la casilla «Actualizar existentes» en el paso 5.
  - Se respeta el límite de productos del plan.
  - Una tabla `import_jobs` en la migración `0012` guarda el estado de cada importación y su resumen para la auditoría.

### 2.3 Catálogo desde fotos y Estudio IA (módulos 1 y parte del 5)

- **Fotos a productos.** Subir varias fotos en el panel; Gemini propone nombre, categoría y descripción por foto; la tienda revisa y crea los productos.
  - El precio y el stock quedan vacíos, en estado borrador, hasta que la tienda los llene.
  - Se reutiliza el análisis que ya existe en `ai.ts`.
- **Estudio IA**: mejorar o cambiar el fondo de una foto.
  - Requiere un modelo de Gemini que genere imágenes. No está verificado en esta cuenta: lo pruebo primero en staging con una llamada real.
  - Si la cuenta no tiene ese modelo, **el botón no se muestra**; no habrá botones simulados.
  - La foto original nunca se reemplaza: el resultado se guarda como foto adicional.
- Todo texto o imagen importado se trata como contenido no confiable. Se envía delimitado y con la instrucción de ignorar las órdenes que contenga.

### 2.4 Plantilla vertical Stories (módulo 3)

- Nueva clave `stories` en `TEMPLATE_KEYS` y en las distribuciones del frontend.
- Formato: producto a pantalla completa 9:16, deslizamiento vertical, avance al tocar y botón fijo de WhatsApp.
- Usa el mismo carrito y el mismo pedido de hoy. Diseño propio, sin copiar la interfaz de otras apps.
- Es aditiva: ninguna tienda cambia de plantilla sola.

### 2.5 Prueba de catálogo sin registro (módulo 4)

- En la página de la plataforma: el visitante sube hasta 6 fotos o un CSV y ve una vista previa con la plantilla elegida.
- Se guarda **temporalmente**: tabla `trial_sessions` en la migración `0013`, archivos en `trials/<id>/` en R2 y borrado automático a las 48 horas.
- Siempre muestra el aviso «Vista previa temporal · no publicada».
- **No crea usuarios ni tiendas.** Al final ofrece «Crear mi tienda», que lleva al bot maestro o a WhatsApp con un código de la prueba.
- **Abuso.** Límite por IP con la API Rate Limiting del Worker, que no es un servicio externo nuevo.
  - La IA en la prueba usa un cupo global de la plataforma, apagado por defecto.
  - Opcional: Cloudflare Turnstile, que sí es un servicio adicional y necesita tu autorización.

## 3. Plan por fases

Todas las fases se hacen en local y staging. Producción solo con tu autorización expresa, al final.

| Fase | Entrega | Validación |
|---|---|---|
| 2. Créditos | Migración `0011`; libro de créditos; reserva y cierre con idempotencia; panel de superadmin (saldo, recarga, ajuste, costos, solicitudes); vista de saldo y solicitud de recarga en el panel del comercio | Pruebas unitarias del libro: doble envío, reserva vencida, saldo negativo imposible, el comercio no puede recargarse. Prueba de punta a punta en staging |
| 3. Importación | Asistente de 6 pasos; CSV, XLSX y PDF con texto; endpoint por lotes; `import_jobs` | Archivos de prueba con fórmulas, SKU duplicados, celdas vacías y texto con «instrucciones». Importación del catálogo de Luz Mágica a una tienda de staging |
| 4. Fotos a productos | Subida múltiple, borradores sugeridos y revisión | Llamada real a Gemini en staging, con créditos descontados y liberados al fallar |
| 5. Estudio IA | Solo si el modelo de imagen responde en la prueba real | Prueba real; si falla, el módulo queda documentado como «no disponible» |
| 6. Stories | Plantilla nueva | Playwright en Android, iPhone y escritorio; pedido por WhatsApp simulado |
| 7. Prueba sin registro | Página de prueba, almacenamiento temporal, límites y borrado | Expiración, límite por IP, sin tiendas creadas |
| 8. Validación | Pruebas completas, `typecheck` y `build`; reporte con la tabla de estado de los cinco módulos; plan de despliegue y reversión | — |

## 4. Riesgos y límites conocidos

- **Visión e imagen de Gemini** sin verificar en la cuenta real; el costo por imagen se conoce solo después de probarla.
- **PDF:** los catálogos diseñados como imagen (sin texto) solo se leen con IA y con revisión manual. Ningún lector garantiza precios correctos.
- **Créditos:** como la unidad comercial (cuánto vale un crédito) la defines tú, la tabla de costos arranca vacía y las acciones usan el presupuesto actual hasta que la configures.
- **Migración `0011`:** es aditiva, pero en producción requiere respaldo previo y tu autorización, como en `0009` y `0010`.
- **Tamaño:** son 5 módulos. Calculo varias sesiones de trabajo. Cada fase se entrega probada antes de pasar a la siguiente.

## 5. Avance

**Fase 2 — Créditos: hecha en local y staging (2026-11-05).**

- Migración `database/migrations/0011_ai_credits.sql`, con reversión en `database/rollback/0011_ai_credits.down.sql`.
- Servicio `worker/src/ai/credits.ts`, que expone `runWithCredits` para las fases 3 a 5.
- Rutas:
  - Plataforma: `/api/platform/credits/*` y `/api/platform/stores/:slug/credits`.
  - Comercio: `GET /api/admin/credits` y `POST /api/admin/credits/requests`.
- Pantallas: «Créditos IA» en el panel de la tienda y la sección «Créditos de IA» en Plataforma.
- Pruebas:
  - 15 nuevas en `worker/src/routes/credits.test.ts`.
  - Worker: 265/265. Frontend: 69/69, con `build` correcto.
  - Staging de punta a punta: 14/14, con una tienda temporal que se eliminó al final.
- Staging: `0011` aplicada y Worker `9b3af30b`. **Producción sin cambios.**
- Pendiente: definir los costos en créditos (es una decisión comercial) y la revisión visual de las pantallas con datos reales.

**Fase 3 — Importación: hecha en local y staging (2026-11-05).**

- Migración `0012_catalog_imports.sql` (`import_jobs`, `import_job_batches`), con reversión en `database/rollback/0012_catalog_imports.down.sql`.
- Servidor: `worker/src/services/catalogImport.ts`, con las rutas `GET/POST /api/admin/imports`, `POST /api/admin/imports/:id/preview`, `POST /api/admin/imports/:id/batches/:n` y `POST /api/admin/imports/:id/finish`. Exigen el rol admin o superior.
- Panel: lectores en `frontend/src/lib/import/` (CSV propio, `read-excel-file@9.3.12` y `pdfjs-dist@6.4.299`, ambos con carga diferida) y el asistente de 6 pasos en `/admin/importar`.
- Reglas:
  - Solo crea productos nuevos.
  - Un código que ya existe se omite, salvo que se marque «Actualizar productos que ya existen». En ese caso cambian solo el precio y las existencias, con la confirmación expresa del paso 5.
  - Una fila sin precio no se importa, porque el producto aparecería en $0 y el panel no muestra los productos ocultos.
  - Las filas sin código no se importan, salvo que se active «Crear códigos internos».
  - Si faltan existencias, quedan en 0, salvo que la tienda indique un valor por defecto.
  - Las fórmulas no se ejecutan: de Excel se lee solo el valor guardado, y un texto que empieza por «=» se rechaza.
  - Se respeta el límite de productos del plan.
  - Cada lote se aplica una sola vez, y un reintento devuelve el resultado guardado.
- Pruebas:
  - Servidor 273/273, con 8 pruebas nuevas.
  - Panel 77/77, con 8 pruebas nuevas, y `build` correcto.
  - Staging: `0012` aplicada y Worker `e102c4a8`. La prueba en navegador contra staging dio 18/18 con CSV, Excel (con una fórmula y un producto que ya existía) y PDF con tabla, en computador y celular, usando una tienda temporal que se eliminó al final.
- Pendiente:
  - **La lectura de PDF escaneados con IA se pasa a la Fase 4**, junto con la visión de Gemini, que hay que verificar con la API real. Hoy un PDF sin texto muestra un aviso y no se finge que se leyó.
  - El aviso de seguridad de `zod` en el panel ya existía antes de esta fase; no lo trajeron estas dependencias.
