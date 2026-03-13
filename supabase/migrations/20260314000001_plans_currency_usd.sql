-- ============================================================================
-- MohandisHub - Plans currency default to USD (platform currency)
-- ============================================================================

ALTER TABLE plans
  ALTER COLUMN currency SET DEFAULT 'USD';

UPDATE plans
SET currency = 'USD'
WHERE currency = 'EGP';
