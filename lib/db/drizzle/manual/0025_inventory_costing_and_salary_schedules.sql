-- Inventory at cost, supplier payables, and the monthly salary schedule.
--
-- Booklet batches gain their supplier, invoice, serial range and whether
-- their cost has been checked against the invoice. Every batch on file
-- today starts unconfirmed: the one batch in the books (35,500 booklets)
-- carries a total cost of GH₵0.70, which cannot be its real cost, and the
-- right figure has to come from the supplier's invoice - it is not guessed.
-- A cost is corrected once, by the director, with the invoice reference,
-- and the old and new figures are kept.
--
-- Supplier payments record paying for a batch, in full or in part; what is
-- still unpaid is the supplier payable. Booklet adjustments record returns,
-- damage, loss and stock-count corrections.
--
-- Salary schedules: the administrator prepares the month's schedule, the
-- director approves it, and only then can its salaries be paid.
--
-- Safe to re-run.

ALTER TABLE booklet_batches ADD COLUMN IF NOT EXISTS supplier varchar(120);
ALTER TABLE booklet_batches ADD COLUMN IF NOT EXISTS invoice_ref varchar(120);
ALTER TABLE booklet_batches ADD COLUMN IF NOT EXISTS serial_from varchar(40);
ALTER TABLE booklet_batches ADD COLUMN IF NOT EXISTS serial_to varchar(40);
ALTER TABLE booklet_batches ADD COLUMN IF NOT EXISTS cost_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE booklet_batches ADD COLUMN IF NOT EXISTS cost_confirmed_by uuid REFERENCES users(id);
ALTER TABLE booklet_batches ADD COLUMN IF NOT EXISTS cost_confirmed_at timestamptz;
-- A booklet can cost less than a pesewa's worth of rounding at two places.
ALTER TABLE booklet_batches ALTER COLUMN cost_per_booklet TYPE numeric(12, 4);

ALTER TABLE thermal_roll_purchases ADD COLUMN IF NOT EXISTS invoice_ref varchar(120);

CREATE TABLE IF NOT EXISTS inventory_cost_corrections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type    varchar(20) NOT NULL CONSTRAINT inventory_cost_corrections_type CHECK (item_type IN ('booklet_batch', 'thermal_purchase')),
  item_id      uuid NOT NULL,
  old_total    numeric(14, 2) NOT NULL,
  new_total    numeric(14, 2) NOT NULL,
  invoice_ref  varchar(120) NOT NULL,
  reason       text NOT NULL,
  corrected_by uuid NOT NULL REFERENCES users(id),
  corrected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_supplier_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type   varchar(20) NOT NULL CONSTRAINT inventory_supplier_payments_type CHECK (item_type IN ('booklet_batch', 'thermal_purchase')),
  item_id     uuid NOT NULL,
  amount      numeric(14, 2) NOT NULL CONSTRAINT inventory_supplier_payments_amount_positive CHECK (amount > 0),
  paid_on     date NOT NULL,
  method      varchar(12) NOT NULL CONSTRAINT inventory_supplier_payments_method CHECK (method IN ('cash', 'momo', 'bank', 'cheque', 'transfer')),
  account_id  uuid NOT NULL REFERENCES fin_money_accounts(id),
  reference   varchar(120),
  note        text,
  paid_by     uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_supplier_payments_item_idx ON inventory_supplier_payments (item_type, item_id);

CREATE TABLE IF NOT EXISTS booklet_adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_type  varchar(20) NOT NULL CONSTRAINT booklet_adjustments_type CHECK (adjustment_type IN ('return_to_store', 'damaged', 'lost', 'count_correction')),
  -- Positive, except a count correction, which can go either way.
  quantity         integer NOT NULL CONSTRAINT booklet_adjustments_quantity CHECK (quantity <> 0 AND (adjustment_type = 'count_correction' OR quantity > 0)),
  agent_id         uuid REFERENCES agents(id),
  occurred_on      date NOT NULL,
  note             text NOT NULL,
  entered_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salary_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month   integer NOT NULL CONSTRAINT salary_schedules_month CHECK (period_month BETWEEN 1 AND 12),
  period_year    integer NOT NULL,
  status         varchar(10) NOT NULL DEFAULT 'submitted' CONSTRAINT salary_schedules_status CHECK (status IN ('submitted', 'approved', 'rejected')),
  total_amount   numeric(14, 2) NOT NULL,
  staff_count    integer NOT NULL,
  prepared_by    uuid NOT NULL REFERENCES users(id),
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  note           text,
  decided_by     uuid REFERENCES users(id),
  decided_at     timestamptz,
  decision_note  text,
  CONSTRAINT salary_schedules_maker_checker CHECK (decided_by IS NULL OR decided_by <> prepared_by)
);
-- One live schedule per month: a rejected one can be followed by a new submission.
CREATE UNIQUE INDEX IF NOT EXISTS salary_schedules_one_live ON salary_schedules (period_year, period_month) WHERE status IN ('submitted', 'approved');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_cost_corrections', 'inventory_supplier_payments', 'booklet_adjustments'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_append_only') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fin_forbid_change()', t || '_append_only', t);
    END IF;
  END LOOP;
END $$;

-- Salaries already paid before schedules existed are on record as paid; the
-- approval step applies to salaries paid from now on.
