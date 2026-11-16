-- Thermal Rolls: purchases by the box, allotments to agents, handovers to
-- writers, and the low-stock alert line.
--
-- Balances are not stored anywhere; they are computed from these movements.
-- Safe to re-run. Creates tables only; changes no existing rows.

CREATE TABLE IF NOT EXISTS thermal_roll_purchases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_date date NOT NULL,
  boxes         integer NOT NULL CONSTRAINT thermal_roll_purchases_boxes_positive CHECK (boxes > 0),
  rolls_per_box integer NOT NULL CONSTRAINT thermal_roll_purchases_rpb_positive CHECK (rolls_per_box > 0),
  total_rolls   integer GENERATED ALWAYS AS (boxes * rolls_per_box) STORED NOT NULL,
  total_cost    numeric(12, 2) NOT NULL CONSTRAINT thermal_roll_purchases_cost_nonneg CHECK (total_cost >= 0),
  supplier      varchar(120),
  notes         text,
  entered_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thermal_roll_purchases_date_idx ON thermal_roll_purchases (purchase_date DESC);

CREATE TABLE IF NOT EXISTS thermal_roll_allotments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES agents(id),
  allotted_date date NOT NULL,
  quantity      integer NOT NULL CONSTRAINT thermal_roll_allotments_qty_positive CHECK (quantity > 0),
  notes         text,
  entered_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thermal_roll_allotments_agent_idx ON thermal_roll_allotments (agent_id);
CREATE INDEX IF NOT EXISTS thermal_roll_allotments_date_idx ON thermal_roll_allotments (allotted_date DESC);

CREATE TABLE IF NOT EXISTS thermal_roll_distributions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         uuid NOT NULL REFERENCES agents(id),
  writer_id        uuid NOT NULL REFERENCES writers(id),
  distributed_date date NOT NULL,
  quantity         integer NOT NULL CONSTRAINT thermal_roll_distributions_qty_positive CHECK (quantity > 0),
  notes            text,
  entered_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thermal_roll_distributions_agent_idx ON thermal_roll_distributions (agent_id);
CREATE INDEX IF NOT EXISTS thermal_roll_distributions_writer_idx ON thermal_roll_distributions (writer_id);

CREATE TABLE IF NOT EXISTS thermal_roll_settings (
  id                  smallint PRIMARY KEY DEFAULT 1 CONSTRAINT thermal_roll_settings_singleton CHECK (id = 1),
  low_stock_threshold integer NOT NULL DEFAULT 50 CONSTRAINT thermal_roll_settings_threshold_nonneg CHECK (low_stock_threshold >= 0),
  alert_active        boolean NOT NULL DEFAULT false,
  last_alert_at       timestamptz,
  updated_by          uuid REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO thermal_roll_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
