-- 0027: medición de la capa conversacional del Asistente TiendIA (latencia, costo y herramientas por mensaje).
-- Aditiva: una tabla nueva. No guarda el texto de los mensajes ni datos personales.
CREATE TABLE IF NOT EXISTS assistant_agent_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    channel TEXT NOT NULL DEFAULT 'telegram',
    -- rule = regla sin IA, parser = intérprete determinista, model = modelo, fallback = volvió al motor anterior
    path TEXT NOT NULL DEFAULT 'rule',
    tools TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT 'ok',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_micros INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assistant_agent_turns_store ON assistant_agent_turns(store_id, created_at);
