-- Per-line stake bounds on a bet type.
--
-- Zero means no limit, which is how the Bet Setups table reads "0 / 0".
-- Idempotent: safe to run more than once.

ALTER TABLE bet_types
  ADD COLUMN IF NOT EXISTS min_stake numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stake numeric(12, 2) NOT NULL DEFAULT 0;

-- Give the seven live setups the bounds the floor already works to. Only
-- rows still at the default are touched, so an edit is never overwritten.
UPDATE bet_types
SET min_stake = 0.10, max_stake = 50.00
WHERE code IN ('D1', 'D2', 'D3', 'P2', 'P3', 'BA', 'BG')
  AND min_stake = 0 AND max_stake = 0;
