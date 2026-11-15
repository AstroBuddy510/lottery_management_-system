-- POS wins: claim, verify, hold, cashier approval, Paystack disbursement.
--
-- What this adds, in the order the money moves:
--
--   writers            the MoMo wallet a win is paid into
--   payout_requests    the claim lifecycle on the existing registry row
--   master_wallet      one row: what is available, what is held
--   master_wallet_ledger   every movement, append-only by trigger
--   payout_claim_attempts  every scan, including the refused ones
--
-- Safe to re-run. Nothing here moves money or changes a paid request.

-- ── 1. New lifecycle states ────────────────────────────────────────────────
-- Added, never reordered. None of the new values is USED later in this file,
-- which matters: Postgres will not let a statement use an enum value added in
-- the same transaction, and a SQL editor may run this file as one.
ALTER TYPE payout_request_status ADD VALUE IF NOT EXISTS 'verified';
ALTER TYPE payout_request_status ADD VALUE IF NOT EXISTS 'awaiting_funds';
ALTER TYPE payout_request_status ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE payout_request_status ADD VALUE IF NOT EXISTS 'withheld';

ALTER TYPE ticket_event_type ADD VALUE IF NOT EXISTS 'claim_submitted';
ALTER TYPE ticket_event_type ADD VALUE IF NOT EXISTS 'claim_resolved';
ALTER TYPE ticket_event_type ADD VALUE IF NOT EXISTS 'claim_withheld';
ALTER TYPE ticket_event_type ADD VALUE IF NOT EXISTS 'transfer_failed';

-- ── 2. The payee's wallet ──────────────────────────────────────────────────
ALTER TABLE writers ADD COLUMN IF NOT EXISTS momo_number             varchar(20);
ALTER TABLE writers ADD COLUMN IF NOT EXISTS momo_provider           varchar(10);
ALTER TABLE writers ADD COLUMN IF NOT EXISTS momo_account_name       varchar(120);
ALTER TABLE writers ADD COLUMN IF NOT EXISTS paystack_recipient_code varchar(60);
ALTER TABLE writers ADD COLUMN IF NOT EXISTS momo_updated_at         timestamptz;
ALTER TABLE writers ADD COLUMN IF NOT EXISTS momo_updated_by         uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'writers_momo_updated_by_users_id_fk') THEN
    ALTER TABLE writers
      ADD CONSTRAINT writers_momo_updated_by_users_id_fk
      FOREIGN KEY (momo_updated_by) REFERENCES users(id);
  END IF;
END $$;

-- ── 3. The claim lifecycle on the registry row ─────────────────────────────
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS claimed_at            timestamptz;
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS claim_method          varchar(10);
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS payee_momo_number     varchar(20);
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS payee_momo_provider   varchar(10);
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS payee_name            varchar(120);
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS reviewed_by           uuid;
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS reviewed_at           timestamptz;
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS rejection_reason      text;
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS transfer_reference    varchar(60);
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS transfer_code         varchar(60);
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS transfer_status       varchar(30);
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS transfer_error        text;
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS transfer_initiated_at timestamptz;
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS transfer_attempts     integer NOT NULL DEFAULT 0;
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS flagged_at            timestamptz;
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS resolved_by           uuid;
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS resolved_at           timestamptz;
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS resolution_note       text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_requests_reviewed_by_users_id_fk') THEN
    ALTER TABLE payout_requests
      ADD CONSTRAINT payout_requests_reviewed_by_users_id_fk
      FOREIGN KEY (reviewed_by) REFERENCES users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_requests_resolved_by_users_id_fk') THEN
    ALTER TABLE payout_requests
      ADD CONSTRAINT payout_requests_resolved_by_users_id_fk
      FOREIGN KEY (resolved_by) REFERENCES users(id);
  END IF;
END $$;

-- One registry row per ticket, for ever. This is the constraint that makes a
-- second redemption impossible rather than merely checked for.
--
-- It cannot be created while duplicates exist, and silently deleting one of
-- two payout rows for the same ticket is not a decision a migration should
-- make. So: stop, and say which tickets.
DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg(ticket_id::text || ' (' || n || ' rows)', ', ')
    INTO dupes
    FROM (SELECT ticket_id, count(*) AS n FROM payout_requests GROUP BY ticket_id HAVING count(*) > 1) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'payout_requests has more than one row for these tickets, resolve them before re-running: %', dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payout_requests_ticket_unique
  ON payout_requests (ticket_id);
-- Superseded by the unique index above.
DROP INDEX IF EXISTS payout_requests_ticket_idx;

CREATE INDEX IF NOT EXISTS payout_requests_status_claimed_idx
  ON payout_requests (status, claimed_at);

CREATE UNIQUE INDEX IF NOT EXISTS payout_requests_transfer_reference_unique
  ON payout_requests (transfer_reference)
  WHERE transfer_reference IS NOT NULL;

-- The old flow let an administrator mark a request 'approved' ahead of
-- paying it. That authorisation no longer exists - a cashier approves, after
-- a claim. Anything left in that state was never paid and never claimed, so
-- it goes back to the registry to be claimed properly. Requests the new flow
-- has touched all carry claimed_at, which is what keeps a re-run from
-- touching them.
UPDATE payout_requests
   SET status = 'pending'
 WHERE status = 'approved'
   AND paid_at IS NULL
   AND claimed_at IS NULL;

-- ── 4. The Master Wallet ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_wallet (
  id          integer PRIMARY KEY DEFAULT 1,
  available   numeric(14,2) NOT NULL DEFAULT 0,
  held        numeric(14,2) NOT NULL DEFAULT 0,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT master_wallet_singleton        CHECK (id = 1),
  CONSTRAINT master_wallet_available_nonneg CHECK (available >= 0),
  CONSTRAINT master_wallet_held_nonneg      CHECK (held >= 0)
);

INSERT INTO master_wallet (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS master_wallet_ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type         varchar(12)   NOT NULL,
  amount             numeric(14,2) NOT NULL,
  available_after    numeric(14,2) NOT NULL,
  held_after         numeric(14,2) NOT NULL,
  payout_request_id  uuid,
  actor_user_id      uuid,
  actor_role         varchar(30),
  reference          varchar(120),
  note               text,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT master_wallet_ledger_amount_positive CHECK (amount > 0),
  CONSTRAINT master_wallet_ledger_entry_type      CHECK (entry_type in ('fund', 'withdraw', 'hold', 'release', 'disburse')),
  CONSTRAINT master_wallet_ledger_payout_request_id_payout_requests_id_fk
    FOREIGN KEY (payout_request_id) REFERENCES payout_requests(id),
  CONSTRAINT master_wallet_ledger_actor_user_id_users_id_fk
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS master_wallet_ledger_created_idx
  ON master_wallet_ledger (created_at);
CREATE INDEX IF NOT EXISTS master_wallet_ledger_payout_idx
  ON master_wallet_ledger (payout_request_id);

-- A request is disbursed at most once. The application checks status first;
-- this is the guard that still holds if that check is ever wrong.
CREATE UNIQUE INDEX IF NOT EXISTS master_wallet_ledger_one_disburse
  ON master_wallet_ledger (payout_request_id)
  WHERE entry_type = 'disburse';

-- Append-only, enforced. A ledger that can be edited is a spreadsheet.
CREATE OR REPLACE FUNCTION master_wallet_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'master_wallet_ledger is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS master_wallet_ledger_no_change ON master_wallet_ledger;
CREATE TRIGGER master_wallet_ledger_no_change
  BEFORE UPDATE OR DELETE ON master_wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION master_wallet_ledger_immutable();

DROP TRIGGER IF EXISTS master_wallet_ledger_no_truncate ON master_wallet_ledger;
CREATE TRIGGER master_wallet_ledger_no_truncate
  BEFORE TRUNCATE ON master_wallet_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION master_wallet_ledger_immutable();

-- ── 5. Every claim attempt, including the refused ones ─────────────────────
CREATE TABLE IF NOT EXISTS payout_claim_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  writer_id   uuid         NOT NULL,
  ticket_id   uuid,
  presented   varchar(200) NOT NULL,
  method      varchar(10)  NOT NULL,
  outcome     varchar(30)  NOT NULL,
  detail      text,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT payout_claim_attempts_writer_id_writers_id_fk
    FOREIGN KEY (writer_id) REFERENCES writers(id),
  CONSTRAINT payout_claim_attempts_ticket_id_tickets_id_fk
    FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

CREATE INDEX IF NOT EXISTS payout_claim_attempts_writer_idx
  ON payout_claim_attempts (writer_id, created_at);
CREATE INDEX IF NOT EXISTS payout_claim_attempts_outcome_idx
  ON payout_claim_attempts (outcome, created_at);
