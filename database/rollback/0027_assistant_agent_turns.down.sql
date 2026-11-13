-- Reversión de 0027: solo retira la medición de la capa conversacional (apagar antes ASSISTANT_AGENT_STORE_IDS).
DROP TABLE IF EXISTS assistant_agent_turns;
DELETE FROM d1_migrations WHERE name = '0027_assistant_agent_turns.sql';
