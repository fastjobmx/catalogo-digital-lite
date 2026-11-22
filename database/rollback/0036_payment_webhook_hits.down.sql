-- Rollback de 0036: quita el registro de avisos recibidos de la pasarela (no afecta pagos ni pedidos).
DROP TABLE IF EXISTS payment_webhook_hits;
