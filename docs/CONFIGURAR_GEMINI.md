# Configurar Gemini (IA)

Google Gemini permite interpretar lenguaje natural (texto y voz) para el agente de Telegram. Es **opcional**: sin Gemini, el intérprete local determinista sigue funcionando con comandos concretos, claramente marcado como **simulado**.

## 1. Obtener la API key

1. Entra a [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Crea una **API key**.
3. Cópiala. **Nunca** la pongas en el frontend ni en el repositorio.

## 2. Configurar el secret

En local, en `worker/.dev.vars`:

```
GEMINI_API_KEY=tu_api_key_aqui
GEMINI_MODEL=gemini-2.0-flash
```

En producción:

```powershell
cd worker
npx wrangler secret put GEMINI_API_KEY
```

`GEMINI_MODEL` es opcional; por defecto se usa `gemini-2.0-flash`.

## 3. Cómo se usa

Cuando llega un mensaje de texto libre a Telegram:

1. Se intenta primero el **intérprete local determinista** (`worker/src/ai/interpreter.ts`).
2. Si no reconoce la acción **y** existe `GEMINI_API_KEY`, se consulta a Gemini pidiendo **solo JSON** con la forma:

   ```json
   { "action": "...", "params": {}, "missing": [], "needsConfirmation": true, "summary": "..." }
   ```

3. La respuesta se valida contra `actionSchemas` (Zod). Si no encaja, se descarta y se avisa al usuario. **Nunca** se ejecuta SQL libre ni texto sin esquema.

### Acciones permitidas (20)

`create_product`, `update_product`, `archive_product`, `restore_product`, `update_stock`, `update_price`, `create_category`, `update_category`, `delete_category`, `set_featured_products`, `update_store_name`, `update_store_colors`, `update_store_logo`, `update_store_banner`, `update_whatsapp`, `update_business_hours`, `update_business_info`, `get_inventory`, `get_products`, `get_store_configuration`.

### Reglas del prompt

- No inventar precios, stock, SKU ni fotografías.
- Si falta un dato, devolverlo en `missing` y no ejecutar nada.
- Las operaciones que crean/eliminan datos requieren confirmación (`needsConfirmation: true`).

## 4. Notas de voz

Las notas de voz se aceptan en el webhook. Si `GEMINI_API_KEY` no está configurada, el bot responde que la función está `PENDIENTE DE CREDENCIALES`. Con la clave configurada, el flujo de transcripción usa el modelo configurado.

## 5. Verificar sin credenciales

Sin `GEMINI_API_KEY`, el bot responde a texto no reconocido con:

```
No reconocí una acción segura. Usa un comando concreto o configura Gemini.

Estado: SIMULADO local / PENDIENTE DE CREDENCIALES de Gemini.
```

Esto confirma que el agente **no finge** funcionar por IA cuando no hay integración.

## 6. Costes y límites

- Gemini se cobra por uso en la API de Google. Revisa los límites del plan en AI Studio.
- El Worker limita el tamaño de `maxOutputTokens` a 500 para acotar el consumo.
