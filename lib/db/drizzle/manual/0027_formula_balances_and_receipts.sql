-- 0027: one accounting formula everywhere, and a receipt on every completed payment.
--
-- 1. Writer balances follow the platform formula exactly:
--      Profit/(Deficit) = Net After Commission - Reserve - Wins
--    Until now a deficit was shrunk by an automatic draw from the Reserve
--    Fund, so the stored balance hid part of what the company owed the
--    agency. The draws themselves stay on the Reserve ledger (the company
--    funding those payouts); only the balances are restated. The agency
--    figures that were built from the shrunken balances - the stored
--    outstanding_debt and each draw's debt-reduction record - are moved by
--    the same amounts, so a later re-run of one of those draws reverses the
--    right figure.
--
-- 2. Receipt numbers come from a sequence (no two cashiers can be handed the
--    same number), and the database refuses a completed payment without one.
--    Pending and rejected cash requests have no receipt by design.
--
-- Run the whole script at once (it is one transaction). Safe to re-run:
-- step 1 only touches rows that still differ from the formula; step 2 uses
-- IF NOT EXISTS / guards.

BEGIN;

-- ── 1. Restate balances to the formula ───────────────────────────────────
-- Each statement works out the difference itself, so no session state is
-- needed. Order matters: the agency figures are moved first, while the old
-- balances are still there to measure against; the balances last.
-- delta = formula - stored (negative: the deficit was larger than shown).

-- The draw's standing debt-reduction record carries the agency's net for the
-- draw; restate it by the same amount (per agency, day and game).
UPDATE agent_debt_reductions r
   SET reduction_amount = r.reduction_amount + d.delta,
       net_gross_amount = r.net_gross_amount + d.delta
  FROM (SELECT w.agent_id, c.calc_date, c.game_id,
               sum((c.net_gross - c.reserve_amount - c.wins_amount) - c.writer_balance) AS delta
          FROM daily_calculations c JOIN writers w ON w.id = c.writer_id
         WHERE c.writer_balance <> c.net_gross - c.reserve_amount - c.wins_amount
         GROUP BY 1, 2, 3) d
 WHERE r.agent_id = d.agent_id AND r.calc_date = d.calc_date
   AND r.game_id IS NOT DISTINCT FROM d.game_id
   AND r.superseded_at IS NULL;

-- The stored agency balance (negative: the agency owes the company) for
-- agencies not yet on an approved opening balance. Agencies with one are
-- recomputed from the ledger by the app on its next finance read.
UPDATE agents a
   SET outstanding_debt = a.outstanding_debt - d.delta,
       debt_since = CASE WHEN a.outstanding_debt - d.delta < 0 THEN coalesce(a.debt_since, now()) ELSE NULL END
  FROM (SELECT w.agent_id,
               sum((c.net_gross - c.reserve_amount - c.wins_amount) - c.writer_balance) AS delta
          FROM daily_calculations c JOIN writers w ON w.id = c.writer_id
         WHERE c.writer_balance <> c.net_gross - c.reserve_amount - c.wins_amount
         GROUP BY 1) d
 WHERE a.id = d.agent_id
   AND NOT EXISTS (SELECT 1 FROM agency_opening_balances o WHERE o.agent_id = a.id AND o.status = 'approved');

UPDATE daily_calculations
   SET writer_balance = net_gross - reserve_amount - wins_amount
 WHERE writer_balance <> net_gross - reserve_amount - wins_amount;

-- ── 2. Receipts ──────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS payment_receipt_seq START 1;
SELECT setval('payment_receipt_seq',
              greatest(coalesce((SELECT max(substring(receipt_number FROM 5)::bigint)
                                   FROM payments WHERE receipt_number ~ '^REC-[0-9]+$'), 0),
                       (SELECT last_value FROM payment_receipt_seq)),
              true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_completed_has_receipt') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_completed_has_receipt
      CHECK (status <> 'completed' OR (receipt_number IS NOT NULL AND receipt_number <> ''));
  END IF;
END $$;

COMMIT;

-- Check: both should be 0.
SELECT (SELECT count(*) FROM daily_calculations WHERE writer_balance <> net_gross - reserve_amount - wins_amount) AS balances_off_formula,
       (SELECT count(*) FROM payments WHERE status = 'completed' AND receipt_number IS NULL) AS completed_without_receipt;
