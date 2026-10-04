-- Commission-inclusive e-token purchases.
--
-- A writer's commission is now built into the units they receive rather than
-- paid back after settlement, so a payment is grossed up:
--
--   units = paid / (1 - writer_commission_pct)
--
-- At 30%, GH¢100 buys 142.86 units. Selling all of them earns 30% (42.86) and
-- remits 100 - exactly the cash handed over, which is the sense in which the
-- commission is "fully inclusive".
--
-- Additive only. Until a writer commission rate is set in Settings the rate is
-- 0 and units equal the cash, so nothing changes until the office means it to.
--
-- Safe to run more than once.

-- What was actually credited, and the rate used, frozen at the moment of
-- crediting. `amount` keeps meaning the money that changed hands, so a receipt
-- and a bank reconciliation still agree; the two figures diverge on purpose.
ALTER TABLE writer_token_purchases
  ADD COLUMN IF NOT EXISTS credited_units numeric(12,2);

ALTER TABLE writer_token_purchases
  ADD COLUMN IF NOT EXISTS commission_pct numeric(5,4);

-- Purchases credited before this change had no uplift: units equalled cash.
-- Recording that explicitly means a later report never has to guess whether a
-- null means "no commission" or "not recorded".
UPDATE writer_token_purchases
   SET credited_units = amount,
       commission_pct = 0
 WHERE credited_units IS NULL
   AND status = 'credited';

DO $$
DECLARE backfilled integer; rate numeric;
BEGIN
  SELECT count(*) INTO backfilled FROM writer_token_purchases WHERE commission_pct = 0;
  SELECT writer_commission_pct INTO rate FROM system_settings ORDER BY effective_date DESC LIMIT 1;
  RAISE NOTICE 'Commission-inclusive units ready. % historic purchase(s) marked at 0%%.', backfilled;
  RAISE NOTICE 'Current writer commission: %. GH-100 will credit %.',
    coalesce(rate, 0),
    CASE WHEN coalesce(rate,0) > 0 AND coalesce(rate,0) < 1
         THEN round(100 / (1 - rate), 2) ELSE 100 END;
END $$;
