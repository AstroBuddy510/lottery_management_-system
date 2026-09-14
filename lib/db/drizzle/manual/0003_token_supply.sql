-- Two-tier e-token supply chain.
--
--   pool -> cashier float -> writer wallet
--
-- Invariant: total_minted = pool.balance + sum(cashier floats) + sum(disbursed)
-- Idempotent: safe to run more than once.

DO $$ BEGIN
  CREATE TYPE token_pool_txn_type AS ENUM ('mint', 'issue_to_cashier', 'reversal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cashier_token_txn_type AS ENUM ('receipt', 'disbursement', 'reversal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS token_pool (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance       numeric(14, 2) NOT NULL DEFAULT '0',
  total_minted  numeric(14, 2) NOT NULL DEFAULT '0',
  total_issued  numeric(14, 2) NOT NULL DEFAULT '0',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS token_pool_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type token_pool_txn_type NOT NULL,
  amount           numeric(14, 2) NOT NULL,
  balance_after    numeric(14, 2) NOT NULL,
  cashier_id       uuid REFERENCES users(id),
  created_by       uuid NOT NULL REFERENCES users(id),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cashier_token_wallets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_id      uuid NOT NULL UNIQUE REFERENCES users(id),
  balance         numeric(14, 2) NOT NULL DEFAULT '0',
  total_received  numeric(14, 2) NOT NULL DEFAULT '0',
  total_disbursed numeric(14, 2) NOT NULL DEFAULT '0',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cashier_token_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_id       uuid NOT NULL REFERENCES users(id),
  transaction_type cashier_token_txn_type NOT NULL,
  amount           numeric(14, 2) NOT NULL,
  balance_after    numeric(14, 2) NOT NULL,
  writer_id        uuid REFERENCES writers(id),
  purchase_id      uuid,
  created_by       uuid NOT NULL REFERENCES users(id),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS token_pool_transactions_created_at_idx
  ON token_pool_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS token_pool_transactions_cashier_idx
  ON token_pool_transactions (cashier_id);
CREATE INDEX IF NOT EXISTS cashier_token_transactions_cashier_idx
  ON cashier_token_transactions (cashier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cashier_token_transactions_writer_idx
  ON cashier_token_transactions (writer_id);

-- The pool is a singleton; create the row if it isn't there yet.
INSERT INTO token_pool (balance, total_minted, total_issued)
SELECT '0', '0', '0'
WHERE NOT EXISTS (SELECT 1 FROM token_pool);
