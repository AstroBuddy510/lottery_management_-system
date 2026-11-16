-- Agency opening balances, and agent commission payouts.
--
-- agency_opening_balances: what each agency owed the company, or was owed by
-- it, from the years of manual operation before this system - with the
-- direction said in words, the date it is as at, and what it rests on. A
-- figure is proposed by one person and approved by another; until then the
-- agency's balance is shown as awaiting confirmation. Once approved, the
-- agency's balance is that opening figure plus every draw and payment after
-- it, and is never typed in again.
--
-- agent_commission_payouts: an agent's request to be paid commission, the
-- administrator's decision, and the cashier's payment. Commission earned is
-- worked out from the draw calculations each time (gross sales of the
-- agent's writers x the rate in force on the day); only requests and
-- payments are stored.
--
-- Safe to re-run. Changes no existing rows.

CREATE TABLE IF NOT EXISTS agency_opening_balances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       uuid NOT NULL REFERENCES agents(id),
  amount         numeric(14, 2) NOT NULL CONSTRAINT agency_opening_amount_nonneg CHECK (amount >= 0),
  direction      varchar(14) NOT NULL CONSTRAINT agency_opening_direction CHECK (direction IN ('agency_owes', 'company_owes')),
  as_of          date NOT NULL,
  basis          text NOT NULL,
  status         varchar(12) NOT NULL DEFAULT 'proposed' CONSTRAINT agency_opening_status CHECK (status IN ('proposed', 'approved', 'rejected', 'superseded')),
  proposed_by    uuid NOT NULL REFERENCES users(id),
  proposed_at    timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid REFERENCES users(id),
  decided_at     timestamptz,
  decision_note  text,
  stored_before  numeric(14, 2),
  CONSTRAINT agency_opening_maker_checker CHECK (decided_by IS NULL OR decided_by <> proposed_by)
);
-- One standing opening balance per agency, and one proposal waiting at a time.
CREATE UNIQUE INDEX IF NOT EXISTS agency_opening_one_approved ON agency_opening_balances (agent_id) WHERE status = 'approved';
CREATE UNIQUE INDEX IF NOT EXISTS agency_opening_one_proposed ON agency_opening_balances (agent_id) WHERE status = 'proposed';

CREATE TABLE IF NOT EXISTS agent_commission_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES agents(id),
  amount          numeric(12, 2) NOT NULL CONSTRAINT agent_commission_payouts_amount_positive CHECK (amount > 0),
  status          varchar(10) NOT NULL DEFAULT 'requested' CONSTRAINT agent_commission_payouts_status CHECK (status IN ('requested', 'approved', 'rejected', 'paid', 'cancelled')),
  requested_by    uuid NOT NULL REFERENCES users(id),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  request_note    text,
  reviewed_by     uuid REFERENCES users(id),
  reviewed_at     timestamptz,
  review_note     text,
  paid_by         uuid REFERENCES users(id),
  paid_at         timestamptz,
  method          varchar(12) CONSTRAINT agent_commission_payouts_method CHECK (method IS NULL OR method IN ('cash', 'momo', 'bank', 'transfer')),
  account_id      uuid REFERENCES fin_money_accounts(id),
  reference       varchar(120),
  -- Whoever asks cannot approve, and whoever approves cannot pay.
  CONSTRAINT agent_commission_payouts_separation CHECK (
    (reviewed_by IS NULL OR reviewed_by <> requested_by) AND (paid_by IS NULL OR paid_by <> reviewed_by)
  ),
  CONSTRAINT agent_commission_payouts_paid_shape CHECK (
    status <> 'paid' OR (paid_by IS NOT NULL AND paid_at IS NOT NULL AND method IS NOT NULL AND account_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS agent_commission_payouts_agent_idx ON agent_commission_payouts (agent_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS agent_commission_payouts_status_idx ON agent_commission_payouts (status);
