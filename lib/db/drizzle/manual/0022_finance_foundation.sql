-- Finance foundation: where the company's money actually is, every cedi that
-- moved in or out of it, what Paystack charged, and what has been set aside.
--
--   fin_money_accounts   real money: cash on hand, bank accounts, Paystack
--   fin_cash_book        every receipt and payment, one row each, append-only
--   fin_payment_fees     the fee Paystack actually charged, per reference
--   fin_funds            named earmarks (Salary Provision, Reserve, ...)
--   fin_fund_movements   allocations to and from those earmarks, append-only
--   fin_balance_checks   a counted or stated balance against the book's
--   fin_audit_log        who did what to a financial record, and when
--
-- Also reverses the GH₵100,000 of test credit in the Master Wallet
-- (references VS00010001 and VS00010002), with entries that say so.
--
-- Safe to re-run. Creates tables and adds one column; the only rows it writes
-- are the seed accounts and funds, and the two reversal entries.

-- ── Money accounts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_money_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             varchar(20) NOT NULL UNIQUE,
  name             varchar(120) NOT NULL,
  kind             varchar(12) NOT NULL CONSTRAINT fin_money_accounts_kind CHECK (kind IN ('cash', 'bank', 'paystack', 'momo', 'other')),
  institution      varchar(120),
  account_ref      varchar(60),
  opening_balance  numeric(14, 2) NOT NULL DEFAULT 0,
  opening_date     date,
  is_system        boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  notes            text,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO fin_money_accounts (code, name, kind, is_system, notes) VALUES
  ('CASH', 'Cash on hand', 'cash', true, 'Physical cash held by the cashiers. Receipts and payments in cash land here.'),
  ('PAYSTACK', 'Paystack balance', 'paystack', true, 'Money held by Paystack: MoMo collections in, transfers and fees out.')
ON CONFLICT (code) DO NOTHING;

-- ── Cash book ────────────────────────────────────────────────────────────────
-- One row per receipt or payment. Most rows are generated from the record that
-- caused them (a unit purchase, a settlement, an expense...) and carry that
-- record's type and id; the unique key is what makes generating them twice
-- impossible. Rows are never edited or deleted: a mistake is put right by a
-- second row that says so (reverses_id).
CREATE TABLE IF NOT EXISTS fin_cash_book (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  timestamptz NOT NULL,
  direction    varchar(3) NOT NULL CONSTRAINT fin_cash_book_direction CHECK (direction IN ('in', 'out')),
  amount       numeric(14, 2) NOT NULL CONSTRAINT fin_cash_book_amount_positive CHECK (amount > 0),
  account_id   uuid NOT NULL REFERENCES fin_money_accounts(id),
  method       varchar(20) NOT NULL,
  category     varchar(40) NOT NULL,
  source_type  varchar(40) NOT NULL,
  source_id    varchar(80) NOT NULL,
  leg          varchar(40) NOT NULL DEFAULT 'main',
  party_type   varchar(20),
  party_id     uuid,
  party_label  varchar(160),
  reference    varchar(120),
  memo         text,
  handled_by   uuid REFERENCES users(id),
  reverses_id  uuid REFERENCES fin_cash_book(id),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_cash_book_source_unique UNIQUE (source_type, source_id, leg)
);
CREATE INDEX IF NOT EXISTS fin_cash_book_occurred_idx ON fin_cash_book (occurred_at DESC);
CREATE INDEX IF NOT EXISTS fin_cash_book_account_idx ON fin_cash_book (account_id, occurred_at);
CREATE INDEX IF NOT EXISTS fin_cash_book_category_idx ON fin_cash_book (category, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS fin_cash_book_one_reversal ON fin_cash_book (reverses_id) WHERE reverses_id IS NOT NULL;

-- ── Paystack fees ────────────────────────────────────────────────────────────
-- The fee Paystack reports for a reference, never an estimate. A reference is
-- recorded once, however many times its webhook or a sync sees it. When
-- Paystack did not say, fee stays null and the row waits for the settlement
-- report to supply it.
CREATE TABLE IF NOT EXISTS fin_payment_fees (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference      varchar(120) NOT NULL UNIQUE,
  kind           varchar(12) NOT NULL CONSTRAINT fin_payment_fees_kind CHECK (kind IN ('collection', 'transfer')),
  source_type    varchar(40) NOT NULL,
  source_id      varchar(80) NOT NULL,
  gross          numeric(14, 2) NOT NULL,
  fee            numeric(14, 2) CONSTRAINT fin_payment_fees_fee_nonneg CHECK (fee IS NULL OR fee >= 0),
  captured_from  varchar(12) NOT NULL CONSTRAINT fin_payment_fees_from CHECK (captured_from IN ('webhook', 'verify', 'settlement', 'manual')),
  occurred_at    timestamptz NOT NULL,
  fee_set_by     uuid REFERENCES users(id),
  fee_set_at     timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fin_payment_fees_occurred_idx ON fin_payment_fees (occurred_at DESC);

-- ── Funds (earmarks) ─────────────────────────────────────────────────────────
-- A fund is money set aside inside the money accounts, not money of its own.
-- Its balance never adds to the company's total; it divides it.
CREATE TABLE IF NOT EXISTS fin_funds (
  code         varchar(30) PRIMARY KEY,
  name         varchar(120) NOT NULL,
  description  text,
  is_system    boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO fin_funds (code, name, description, is_system) VALUES
  ('SALARY', 'Salary Provision Fund', 'Set aside by the director ahead of payday; drawn down as salaries are paid.', true),
  ('RESERVE', 'Reserve Fund', 'Accumulates a share of every draw''s net sales and covers writer deficits. Derived from the draw calculations.', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS fin_fund_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_code      varchar(30) NOT NULL REFERENCES fin_funds(code),
  entry_type     varchar(10) NOT NULL CONSTRAINT fin_fund_movements_type CHECK (entry_type IN ('allocate', 'release', 'spend', 'adjust')),
  -- Signed: allocations add, releases and spending subtract.
  delta          numeric(14, 2) NOT NULL CONSTRAINT fin_fund_movements_delta_nonzero CHECK (delta <> 0),
  account_id     uuid REFERENCES fin_money_accounts(id),
  reason         text NOT NULL,
  reference      varchar(120),
  source_type    varchar(40),
  source_id      varchar(80),
  authorised_by  uuid REFERENCES users(id),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_fund_movements_source_unique UNIQUE (source_type, source_id)
);
CREATE INDEX IF NOT EXISTS fin_fund_movements_fund_idx ON fin_fund_movements (fund_code, occurred_at);

-- ── Balance checks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_balance_checks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES fin_money_accounts(id),
  as_of              timestamptz NOT NULL,
  statement_balance  numeric(14, 2) NOT NULL,
  book_balance       numeric(14, 2) NOT NULL,
  difference         numeric(14, 2) NOT NULL,
  source             varchar(12) NOT NULL CONSTRAINT fin_balance_checks_source CHECK (source IN ('manual', 'paystack_api')),
  note               text,
  entered_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fin_balance_checks_account_idx ON fin_balance_checks (account_id, as_of DESC);

-- ── Audit log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at             timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid REFERENCES users(id),
  actor_role     varchar(30),
  action         varchar(60) NOT NULL,
  entity         varchar(40) NOT NULL,
  entity_id      varchar(80),
  detail         jsonb,
  note           text
);
CREATE INDEX IF NOT EXISTS fin_audit_log_at_idx ON fin_audit_log (at DESC);
CREATE INDEX IF NOT EXISTS fin_audit_log_entity_idx ON fin_audit_log (entity, entity_id);

-- ── Append-only: the cash book, fund movements, balance checks and audit log ─
CREATE OR REPLACE FUNCTION fin_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never edited or deleted; post a correcting entry instead', TG_TABLE_NAME;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fin_cash_book', 'fin_fund_movements', 'fin_balance_checks', 'fin_audit_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_append_only') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fin_forbid_change()', t || '_append_only', t);
    END IF;
  END LOOP;
END $$;

-- ── Master Wallet: reversals point at what they reverse ─────────────────────
ALTER TABLE master_wallet_ledger ADD COLUMN IF NOT EXISTS reverses_id uuid REFERENCES master_wallet_ledger(id);
CREATE UNIQUE INDEX IF NOT EXISTS master_wallet_ledger_one_reversal ON master_wallet_ledger (reverses_id) WHERE reverses_id IS NOT NULL;

-- ── Issue 1: reverse the GH₵100,000 test credit ─────────────────────────────
-- The two 50,000 top-ups (VS00010001, VS00010002) were the director testing
-- the deposit screen; Paystack never held the money. Each gets a withdraw
-- entry pointing back at it. Nothing is deleted: the test and its reversal
-- both stay on the ledger, and the finance reports leave both out.
-- Runs only while the wallet still holds the money unpromised.
DO $$
DECLARE
  r record;
  avail numeric;
  held_now numeric;
BEGIN
  FOR r IN
    SELECT l.id, l.amount, l.reference
    FROM master_wallet_ledger l
    WHERE l.entry_type = 'fund' AND l.reference IN ('VS00010001', 'VS00010002')
      AND NOT EXISTS (SELECT 1 FROM master_wallet_ledger x WHERE x.reverses_id = l.id)
    ORDER BY l.created_at
  LOOP
    SELECT available, held INTO avail, held_now FROM master_wallet WHERE id = 1 FOR UPDATE;
    IF avail < r.amount THEN
      RAISE NOTICE 'Master Wallet has only % available; % not reversed', avail, r.reference;
      CONTINUE;
    END IF;
    UPDATE master_wallet SET available = available - r.amount, updated_at = now() WHERE id = 1;
    INSERT INTO master_wallet_ledger (entry_type, amount, available_after, held_after, actor_role, reference, note, reverses_id)
    VALUES ('withdraw', r.amount, avail - r.amount, held_now, 'system', 'REV-' || r.reference,
            'Reversal of test credit ' || r.reference || ': a test of the deposit screen, not company money. Management instruction, 16 Nov 2026.',
            r.id);
    INSERT INTO fin_audit_log (actor_role, action, entity, entity_id, detail, note)
    VALUES ('system', 'master_wallet.test_credit_reversed', 'master_wallet_ledger', r.id::text,
            jsonb_build_object('reference', r.reference, 'amount', r.amount),
            'GH₵100,000 test credit removed from the Master Wallet');
  END LOOP;
END $$;
