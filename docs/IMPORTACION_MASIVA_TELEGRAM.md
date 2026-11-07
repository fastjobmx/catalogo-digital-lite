# Importación masiva de productos desde Telegram

La importación guarda cada lote y cada producto provisional en D1. Las fotos se almacenan temporalmente en R2 hasta que el administrador confirme la publicación. El flujo sirve para cargar productos manualmente; la IA es opcional.

## Flujo de demostración

En una tienda de prueba, abre el bot vinculado a la tienda y envía:

1. `/lote`
2. Una foto por producto, sola o en álbum. Puedes escribir los datos en el pie de foto, por ejemplo: `Nombre: Camiseta clásica, descripción: algodón liviano, precio 85000, 4 unidades, talla M, color negro, categoría Ropa, SKU CAM-M-NG`.
3. Más fotos o álbumes. Cada foto se convierte en un producto y las fotos de un álbum mantienen su orden de mensaje. Los reintentos duplicados de Telegram no crean otra fila.
4. `/listo` para cerrar la recepción y revisar las páginas del lote. Cada página muestra hasta ocho productos.
5. Completa o corrige los datos por Telegram. Ejemplos: `El producto 3 vale 85000`, `Corrige nombre producto 2 a Camiseta azul`, `1 al 5 ponles categoría Ropa`, `Todos los productos tienen 3 unidades`, `El producto 4 es talla M`, `5 omitir`. También puedes enviar una lista numerada, una línea por foto: `1. Camiseta, precio 85000, 4 unidades`.
6. Pulsa **Publicar listos** o escribe `/publicar`, revisa el resumen y confirma con el botón de confirmación. Solo entonces se crean productos, variantes e historial de auditoría en el catálogo.

El lote queda persistido si el webhook se reintenta o el Worker se reinicia. Un producto fallido no revierte los demás; puede corregirse y publicarse en un nuevo intento. `/cancelar` cancela el lote abierto y elimina sus fotos temporales. La publicación requiere rol administrador y respeta el máximo de productos del plan.

## Datos y revisión

- El nombre, el precio y la cantidad inicial se deben proporcionar antes de publicar. Una descripción y categoría mejoran el catálogo, pero no sustituyen los datos obligatorios.
- También se reconocen talla, color y SKU explícitos en el pie de foto. Si no se proporciona SKU, se crea un código interno único al publicar.
- Los campos comerciales se extraen solo del texto enviado. La imagen no determina precio, existencias, talla ni SKU.
- Los productos con el mismo nombre que otro producto activo se marcan como posible duplicado para revisión; no se descartan automáticamente.
- El panel autenticado incluye **Importaciones Telegram** en `/admin/importar`. Desde allí se puede revisar el lote, ver sus fotos y corregir datos antes de publicar.
- La importación empieza desactivada para todas las tiendas. El superadministrador puede habilitarla por tienda en **Plataforma → Importación Telegram**; el Worker vuelve a verificar la bandera al recibir fotos, revisar y publicar.

## IA opcional

Desde la revisión, el administrador puede pedir sugerencias para nombre, categoría, descripción y color. Antes de analizar, el bot informa el coste estimado en créditos y el saldo disponible; el análisis requiere confirmación explícita. Se procesa un máximo de tres fotos por confirmación. La IA nunca rellena precio, existencias, talla ni SKU. Sin Gemini, créditos suficientes o almacenamiento disponible, la edición manual sigue operativa.

## Límites de configuración

El Worker admite estas variables opcionales:

| Variable | Predeterminado | Límite efectivo |
|---|---:|---:|
| `TELEGRAM_BATCH_MAX_ITEMS` | 100 productos | máximo de 500; además se limita por el cupo disponible del plan |
| `TELEGRAM_BATCH_MAX_BYTES` | 209715200 bytes (200 MiB) | máximo de 1073741824 bytes (1 GiB) por lote |

Si no se definen, se usan los valores predeterminados. No incluyas tokens ni secretos en estos valores.

## Desarrollo local

Las migraciones `0017_telegram_product_batches.sql` (lotes e imágenes) y `0018_telegram_bulk_import_flag.sql` (bandera apagada por defecto) son aditivas. Wrangler toma el directorio de migraciones de `worker/wrangler.toml`. En la carpeta `worker`, aplica las migraciones pendientes solo a la base local de desarrollo:

```powershell
npx wrangler d1 migrations apply catalogo-lite-db --local
npm test -- src/services/telegramProductBatches.test.ts
```

La suite cubre importación individual y en lote, álbumes, duplicados, límites, recuperación, correcciones, IA con consentimiento y créditos, seguridad multi-tienda, confirmación, publicación parcial, permisos del superadministrador y el bloqueo por bandera apagada. Para producción, primero se debe revisar y aprobar un plan de despliegue por separado.
