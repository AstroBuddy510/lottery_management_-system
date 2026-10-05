-- Make the float and the postpaid ledger safe under concurrent sales.
--
-- The application now does every wallet movement in a single UPDATE with the
-- guard in the WHERE clause. These are the database-side invariants that back
-- that up: the CHECK makes a negative float impossible however the code
-- changes later, and the unique index is what the ledger's ON CONFLICT rests
-- on - without it, the insert raises "no unique or exclusion constraint
-- matching the ON CONFLICT specification" and postpaid sales stop.
--
-- RUN THIS BEFORE DEPLOYING THE CODE. Verified against production first:
-- 0 wallets below zero and 0 duplicate (writer_id, game_id, ledger_date)
-- groups, so nothing existing violates either rule. Safe to re-run.

-- The wallet's writer_id must be unique for the credit upsert's ON CONFLICT.
-- Declared unique in the schema; asserted here because a schema declaration
-- is not evidence that the database agrees.
CREATE UNIQUE INDEX IF NOT EXISTS writer_token_wallets_writer_id_key
  ON writer_token_wallets (writer_id);

-- A float can never go below zero. Stated once, here, rather than trusted to
-- every present and future code path that touches money.
ALTER TABLE writer_token_wallets
  DROP CONSTRAINT IF EXISTS writer_token_wallets_balance_non_negative;
ALTER TABLE writer_token_wallets
  ADD CONSTRAINT writer_token_wallets_balance_non_negative
  CHECK (balance >= 0);

-- One ledger row per writer, per game, per day. Two concurrent sales used to
-- be able to create two rows, which split the writer's debt in half and
-- understated the bill they were asked to settle.
CREATE UNIQUE INDEX IF NOT EXISTS postpaid_daily_ledger_writer_game_date_key
  ON postpaid_daily_ledger (writer_id, game_id, ledger_date);
