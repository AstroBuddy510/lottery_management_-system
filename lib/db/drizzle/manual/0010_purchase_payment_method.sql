-- How a writer is paying for e-token units.
--
-- "momo" goes through Paystack and is confirmed by its webhook; "cash" is
-- handed to the cashier in person, and their confirming receipt IS the
-- confirmation. Existing rows are all mobile money, which is the default.
--
-- Idempotent: safe to run more than once.

ALTER TABLE writer_token_purchases
  ADD COLUMN IF NOT EXISTS payment_method varchar(10) NOT NULL DEFAULT 'momo';

-- The cashier queue reads pending cash requests alongside paid MoMo ones.
CREATE INDEX IF NOT EXISTS writer_token_purchases_queue_idx
  ON writer_token_purchases (status, payment_method, created_at DESC);
