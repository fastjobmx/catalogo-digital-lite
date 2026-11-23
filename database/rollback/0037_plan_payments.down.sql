-- Rollback de 0037: quita los intentos de pago del plan con Bold (las contrataciones y activaciones se conservan).
DROP TABLE IF EXISTS plan_payment_attempts;
