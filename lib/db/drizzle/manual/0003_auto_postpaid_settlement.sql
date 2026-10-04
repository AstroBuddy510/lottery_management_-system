-- Automated postpaid settlement.
--
-- Entirely additive, and inert until an administrator switches it on: the
-- settings row defaults to enabled = false, and every code path checks that
-- flag before changing anything about how a writer's day works.
--
-- Safe to run more than once.

-- 1. The feature's own settings. One row.
CREATE TABLE IF NOT EXISTS postpaid_auto_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled               boolean NOT NULL DEFAULT false,
  reminder_lead_minutes text    NOT NULL DEFAULT '30,15,5',
  grace_minutes         integer NOT NULL DEFAULT 0,
  block_next_day        boolean NOT NULL DEFAULT true,
  minimum_chargeable    numeric(12,2) NOT NULL DEFAULT 0,
  whatsapp_enabled      boolean NOT NULL DEFAULT false,
  last_swept_at         timestamptz,
  updated_by            uuid REFERENCES users(id),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Exactly one row, enforced rather than assumed.
CREATE UNIQUE INDEX IF NOT EXISTS postpaid_auto_settings_singleton
    ON postpaid_auto_settings ((true));

INSERT INTO postpaid_auto_settings (enabled)
SELECT false
 WHERE NOT EXISTS (SELECT 1 FROM postpaid_auto_settings);

-- 2. Part-payments on the daily ledger.
--
-- The manual flow settles a bill once, so it never needed to record how much
-- had been collected - only whether it had. The automated flow collects at the
-- midpoint and again at the end of the day, so a ledger can be part-paid while
-- its bill is still growing.
ALTER TABLE postpaid_daily_ledger
  ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0;

-- Bitmask of which reminder lead times have been sent for this ledger, so a
-- reminder goes out once however many times the sweep runs.
ALTER TABLE postpaid_daily_ledger
  ADD COLUMN IF NOT EXISTS reminders_sent integer NOT NULL DEFAULT 0;

-- 3. Ledgers already settled under the manual flow are fully paid by
--    definition. Without this they would read as owing their whole bill the
--    moment the feature is switched on, and lock out every writer at once.
UPDATE postpaid_daily_ledger
   SET amount_paid = amount_payable
 WHERE settlement_status = 'settled'
   AND amount_paid = 0
   AND amount_payable > 0;

-- 4. The sweep and the gate both look up a writer's unsettled days.
CREATE INDEX IF NOT EXISTS postpaid_ledger_writer_date_idx
    ON postpaid_daily_ledger (writer_id, ledger_date);
CREATE INDEX IF NOT EXISTS postpaid_ledger_open_idx
    ON postpaid_daily_ledger (ledger_date, settlement_status);

DO $$
DECLARE backfilled integer;
BEGIN
  SELECT count(*) INTO backfilled
    FROM postpaid_daily_ledger
   WHERE settlement_status = 'settled' AND amount_paid > 0;
  RAISE NOTICE 'Auto settlement installed, switched OFF. % settled ledger(s) marked fully paid.', backfilled;
END $$;
