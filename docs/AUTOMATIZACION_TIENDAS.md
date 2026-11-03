# Preparación del aprovisionamiento Cloudflare

## Estado actual

Esta fase documenta el flujo futuro. El generador actual solo crea demos
locales. No ejecutamos `wrangler d1 create`, creación de buckets, despliegues,
configuración de dominios ni llamadas al API de Cloudflare.

La documentación oficial vigente describe `wrangler d1 create` para crear una
D1 remota y devolver el UUID que se configura en Wrangler; las migraciones se
aplican después con `wrangler d1 migrations apply`. El comando de migraciones
presenta confirmación interactiva en uso normal y captura un backup después de
aplicar cada migración. [Comandos D1 de Wrangler](https://developers.cloudflare.com/d1/wrangler-commands/)

R2 ofrece `wrangler r2 bucket create <NAME>`; los buckets nuevos son privados
por defecto. [Comandos R2](https://developers.cloudflare.com/workers/wrangler/commands/r2/)
La plataforma Pages soporta creación con `wrangler pages project create` y
despliegue de assets compilados con `wrangler pages deploy <DIRECTORY>`.
[Comandos Pages](https://developers.cloudflare.com/workers/wrangler/commands/pages/)
Cloudflare hoy presenta Workers como su plataforma principal para proyectos
nuevos; antes de adoptar Pages para un cliente, el aprovisionamiento deberá
confirmar la opción y los límites vigentes de la cuenta.
[Cloudflare Pages](https://developers.cloudflare.com/pages/)

## Diseño propuesto

Una futura orden independiente, por ejemplo `scripts/provision-store.ps1`, debe
recibir el slug local y crear un manifiesto remoto separado. No debe ampliar
`new-store.ps1` con llamadas de red silenciosas.

1. **Preflight.** Confirmar cuenta/perfil Wrangler autenticado, permisos
   mínimos, facturación, ubicación/jurisdicción, dominios disponibles,
   dependencias del frontend y modo `production`. Consultar las tarifas y
   cuotas actuales: D1, Workers/Pages Functions y R2 tienen cuotas y criterios
   de cobro diferentes. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
   [D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
   [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
   [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
2. **Colisión y consentimiento.** Enumerar recursos con el nombre previsto,
   detenerse si alguno existe, mostrar cuenta, nombre, plan y recursos a crear,
   y exigir un parámetro explícito de confirmación antes de la primera
   mutación remota. No reutilizar recursos de otra tienda.
3. **Crear D1 y R2.** Crear una base y bucket con nombres únicos derivados del
   slug; guardar UUID, cuenta y región en el manifiesto sin secretos. Actualizar
   bindings en una copia de producción, nunca en la plantilla maestra.
4. **Aplicar esquema.** Aplicar migraciones numeradas a la D1 recién creada.
   Verificar nombres de tablas y `store_config`; aplicar catálogo solo si el
   manifiesto eligió explícitamente un seed.
5. **Secretos y Worker.** Usar un token API de alcance mínimo. No colocar
   secretos en `vars`, archivos versionados, manifiesto o argumentos de proceso.
   Usar el almacén de secretos de Wrangler. `wrangler secret put` crea una nueva
   versión y despliega el Worker inmediatamente; por eso debe ejecutarse
   después de compilar y revisar el Worker, o gestionarse como etapa de
   despliegue deliberada. [Secretos de Workers](https://developers.cloudflare.com/workers/configuration/secrets/)
6. **Build y Pages/Workers.** Compilar con la URL API correcta de la tienda.
   Crear el proyecto Pages si se eligió Pages y subir su directorio de salida;
   o desplegar el Worker si se eligió la arquitectura unificada. No enlazar el
   proyecto nuevo al repositorio o a dominios de SneakerHub.
7. **Dominios.** Verificar propiedad y DNS antes de asignar dominios. La
   asociación no debe reemplazar registros existentes. Mantener una URL de
   preview hasta aceptar API, storefront, imágenes, CORS y login.
8. **Verificación.** Consultar despliegues, salud API, configuración de tienda,
   productos, subida/lectura R2, CORS, credenciales y rutas públicas. Registrar
   resultado, timestamps y versiones en el manifiesto.

## Estado parcial y recuperación

Registrar cada recurso creado con su ID antes de avanzar a la siguiente
operación. El proceso debe poder reanudarse comprobando el manifiesto y la API
de Cloudflare. Si una etapa falla, dejar los recursos visibles como `partial`
y mostrar los pasos manuales de reparación. No borrar recursos automáticamente
como rollback: un bucket o D1 podría contener datos ya aceptados por el cliente.
La reversión de Worker debe apuntar a una versión previamente registrada y las
migraciones D1 requieren un plan de recuperación compatible con el cambio.

El manifiesto remoto debe registrar account ID, Worker name, database UUID,
bucket name, Pages/Workers project, hostname, migration hashes, commit del
template, seed, estado por etapa y fechas. Nunca almacena API tokens, passwords,
JWT secretos ni claves de Telegram/Gemini.

## Gate antes de implementar

- La fase de demos aisladas pasó sus conteos, builds y comprobaciones de
  aislamiento local.
- La futura orden debe mostrar el plan y pedir aprobación explícita de
  aprovisionamiento remoto.
- El primer uso remoto será un proyecto de demo sin dominio productivo y con
  credenciales nuevas.
- No se aplican despliegues ni se crean recursos remotos desde esta fase.

## Operaciones locales reutilizables

`worker/src/services/business.ts` concentra las operaciones que pueden invocar
las rutas administrativas y el ejecutor actual de acciones: alta/edición de
productos, precios, inventario, categorías, configuración de tienda y carga de
imágenes a R2. Cada invocación recibe el actor y origen para mantener una
auditoría común. Los canales de entrada deben conservar sus propias reglas de
autenticación, autorización y confirmación; el servicio compartido no sustituye
esas comprobaciones.

El cuestionario web aprovecha `PUT /api/admin/store` y las rutas de categorías
existentes con la sesión administrativa. El catálogo/fotos se completan en las
pantallas administrativas ya disponibles, sin insertar un producto marcador.
