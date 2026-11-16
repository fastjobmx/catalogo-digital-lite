# Asistente TiendIA: rapidez y conversación natural (2026-11-16)

Rama local `feat/asistente-rapido` (desde `main` `289c55e`). Sin push ni despliegue.

## Diagnóstico (medido, no supuesto)

| Dónde | Dato real |
|---|---|
| Staging, mensajes que necesitan IA (capa conversacional) | 5,5 a 9,1 s por respuesta |
| Staging, mensajes resueltos con reglas | 0,3 a 1,3 s |
| Staging, mensaje que cae al motor anterior | 11,3 s (dos llamadas al modelo seguidas) |
| Causa principal | la llamada al modelo que elige herramientas: unos 3 s de media con `gemini-3.8-flash`, hasta 11 s |
| WhatsApp (WAHA) | además sumaba 1 a 3 s: «visto» y «escribiendo» bloqueaban, y había una pausa de 0,5 a 1,2 s por mensaje |
| Producción | la capa conversacional está **apagada para todas las tiendas** (`ASSISTANT_*_STORE_IDS` sin definir): los comerciantes reales hablan con el motor anterior |

## Cambios

1. **Modelo liviano para entender el mensaje** (`ASSISTANT_FAST_MODEL`, por ejemplo `gemini-3.1-flash-lite`). Tiene 3 s; si falla, tarda o responde fuera del contrato, sigue el modelo principal como antes. El modelo solo elige herramientas: las cifras siguen saliendo de la base de datos.
2. **Motor anterior más rápido** (`ASSISTANT_FAST_INTERPRET=true`): interpreta el texto sin razonamiento extendido. La voz no cambia.
3. **Menos espera fija**: catálogo, conversación reciente y señal de «escribiendo» se piden en paralelo.
4. **WhatsApp por WAHA**: «visto» y «escribiendo» van en segundo plano y la pausa antes de enviar baja a 0,1–0,4 s.
5. **Correcciones de la prueba real integradas** (estaban en `feat/asistente-conversacional`, sin subir): claves pegadas en el chat no se guardan, «ponle como nombre X», preguntas de totales y contexto tras una ambigüedad cancelada.

Los dos interruptores nuevos vacíos = comportamiento actual.

## Resultados (banco de 44 conversaciones con el modelo real, desde este equipo)

| Medida | Antes | Después |
|---|---|---|
| Capa conversacional: conversaciones correctas | 44 / 44 | 44 / 44 |
| Capa conversacional: turno con IA, media | 3,8 s | 1,2–1,3 s |
| Capa conversacional: turno con IA, percentil 90 | 7,6 s | 1,3 s |
| Motor anterior: turno con IA, media | 7,0 s | 4,8 s |
| Motor anterior: conversaciones correctas | 21 / 44 | 21 / 44 (las mismas) |

Suite: 899 pruebas pasan. **Sin medir todavía en Cloudflare ni con un teléfono real**; allí la latencia de red es mayor que desde este equipo.

## Para que el comerciante lo note

1. Desplegar en staging con `ASSISTANT_FAST_MODEL=gemini-3.1-flash-lite` y `ASSISTANT_FAST_INTERPRET=true`, y probar con el teléfono.
2. En producción, encender la capa conversacional por tienda (`ASSISTANT_AGENT_STORE_IDS`, `ASSISTANT_MEDIA_STORE_IDS`, `ASSISTANT_ORDERS_STORE_IDS`), empezando por una tienda interna. Requiere autorización; el motor anterior solo acierta 21 de 44 conversaciones del banco, la capa nueva 44.
