-- Reserve made a ledger; expired wins released; shortfall contributions.
--
-- 1. Reserve draws carry the draw they belong to, whether they were automatic
--    or applied by hand, and - instead of ever being deleted - when and why
--    they were set aside. A re-run of a draw supersedes that draw's own
--    automatic draws instead of adding a second set.
-- 2. The one duplicate automatic draw already on the books (a draw calculated
--    twice) is superseded, with the reason.
-- 3. The reserve_fund summary is rebuilt from the two records it summarises:
--    reserve set aside by the draw calculations, less draws still standing.
--    It had been kept as running totals, which a re-run inflated.
-- 4. Agency debt reductions carry their draw too, so a re-run can undo its own.
-- 5. winnings_expiries: a POS win not claimed within 15 days is released from
--    the winnings liability once, with its dates, and becomes Expired/
--    Unclaimed Winnings Income.
-- 6. winnings_contributions: cash put up by writers or others to clear wins
--    the reserve could not cover.
--
-- Safe to re-run.

-- ── 1. Reserve draws ─────────────────────────────────────────────────────────
ALTER TABLE reserve_allocations ADD COLUMN IF NOT EXISTS game_id uuid REFERENCES games(id);
ALTER TABLE reserve_allocations ADD COLUMN IF NOT EXISTS source varchar(10) NOT NULL DEFAULT 'auto';
ALTER TABLE reserve_allocations ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE reserve_allocations ADD COLUMN IF NOT EXISTS superseded_reason text;
ALTER TABLE reserve_allocations ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS reserve_allocations_game_idx ON reserve_allocations (game_id);
CREATE INDEX IF NOT EXISTS reserve_allocations_writer_date_idx ON reserve_allocations (writer_id, allocation_date);

UPDATE reserve_allocations SET source = 'manual'
 WHERE source = 'auto' AND coalesce(reason, '') NOT LIKE 'Auto-draw%';

-- Which draw an older automatic draw belongs to, where the writer had exactly
-- one calculated draw that day. Ambiguous days are left blank, not guessed.
UPDATE reserve_allocations a
   SET game_id = c.game_id
  FROM (SELECT writer_id, calc_date, min(game_id::text)::uuid AS game_id, count(DISTINCT game_id) AS n
          FROM daily_calculations WHERE game_id IS NOT NULL GROUP BY 1, 2) c
 WHERE a.game_id IS NULL AND a.source = 'auto'
   AND c.writer_id = a.writer_id AND c.calc_date = a.allocation_date AND c.n = 1;

-- ── 2. Duplicate automatic draws ─────────────────────────────────────────────
-- A writer can be drawn for once per calculated draw that day. Any automatic
-- draw beyond that number came from calculating the same draw again; the
-- earliest stand, the later ones are superseded.
CREATE TABLE IF NOT EXISTS fin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id), actor_role varchar(30), action varchar(60) NOT NULL,
  entity varchar(40) NOT NULL, entity_id varchar(80), detail jsonb, note text
);
WITH ranked AS (
  SELECT a.id, a.amount_drawn, a.allocation_date, a.writer_id,
         row_number() OVER (PARTITION BY a.writer_id, a.allocation_date ORDER BY a.created_at) AS rn,
         (SELECT count(*) FROM daily_calculations c WHERE c.writer_id = a.writer_id AND c.calc_date = a.allocation_date) AS calcs
    FROM reserve_allocations a
   WHERE a.source = 'auto' AND a.superseded_at IS NULL
), dup AS (
  UPDATE reserve_allocations a
     SET superseded_at = now(),
         superseded_reason = 'Duplicate automatic draw: this day''s draw was calculated a second time and drew from the reserve again for the same deficit. Superseded 16 Nov 2026.'
    FROM ranked r
   WHERE r.id = a.id AND r.rn > greatest(r.calcs, 1)
  RETURNING a.id, a.amount_drawn, a.allocation_date, a.writer_id
)
INSERT INTO fin_audit_log (actor_role, action, entity, entity_id, detail, note)
SELECT 'system', 'reserve.duplicate_draw_superseded', 'reserve_allocation', d.id::text,
       jsonb_build_object('amount', d.amount_drawn, 'date', d.allocation_date, 'writer_id', d.writer_id),
       'Duplicate automatic reserve draw superseded'
  FROM dup d;

-- ── 3. reserve_fund rebuilt from the ledger ─────────────────────────────────
DO $$
DECLARE before_c numeric; before_a numeric; after_c numeric; after_a numeric;
BEGIN
  SELECT coalesce(sum(total_contributed), 0), coalesce(sum(total_allocated), 0) INTO before_c, before_a FROM reserve_fund;
  WITH c AS (SELECT date_trunc('month', calc_date)::date AS p, sum(reserve_amount) AS s FROM daily_calculations GROUP BY 1),
       a AS (SELECT date_trunc('month', allocation_date)::date AS p, sum(amount_drawn) AS s FROM reserve_allocations WHERE superseded_at IS NULL GROUP BY 1),
       m AS (SELECT p FROM c UNION SELECT p FROM a UNION SELECT period_date FROM reserve_fund)
  INSERT INTO reserve_fund (period_date, total_contributed, total_allocated, balance)
  SELECT m.p, coalesce(c.s, 0), coalesce(a.s, 0), coalesce(c.s, 0) - coalesce(a.s, 0)
    FROM m LEFT JOIN c ON c.p = m.p LEFT JOIN a ON a.p = m.p
  ON CONFLICT (period_date) DO UPDATE
     SET total_contributed = excluded.total_contributed, total_allocated = excluded.total_allocated,
         balance = excluded.balance, updated_at = now();
  SELECT coalesce(sum(total_contributed), 0), coalesce(sum(total_allocated), 0) INTO after_c, after_a FROM reserve_fund;
  IF before_c <> after_c OR before_a <> after_a THEN
    INSERT INTO fin_audit_log (actor_role, action, entity, detail, note)
    VALUES ('system', 'reserve.summary_rebuilt', 'reserve_fund',
            jsonb_build_object('contributed_before', before_c, 'contributed_after', after_c, 'drawn_before', before_a, 'drawn_after', after_a),
            'Reserve summary rebuilt from the draw calculations and the standing reserve draws');
  END IF;
END $$;

-- ── 4. Agency debt reductions know their draw ───────────────────────────────
ALTER TABLE agent_debt_reductions ADD COLUMN IF NOT EXISTS game_id uuid REFERENCES games(id);
ALTER TABLE agent_debt_reductions ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE agent_debt_reductions ADD COLUMN IF NOT EXISTS superseded_reason text;
CREATE INDEX IF NOT EXISTS agent_debt_reductions_game_idx ON agent_debt_reductions (game_id, calc_date);

-- ── 5. Expired winnings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS winnings_expiries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_request_id  uuid NOT NULL UNIQUE REFERENCES payout_requests(id),
  ticket_id          uuid NOT NULL REFERENCES tickets(id),
  writer_id          uuid NOT NULL REFERENCES writers(id),
  game_id            uuid REFERENCES games(id),
  amount             numeric(12, 2) NOT NULL CONSTRAINT winnings_expiries_amount_positive CHECK (amount > 0),
  win_date           timestamptz NOT NULL,
  deadline           timestamptz NOT NULL,
  released_at        timestamptz NOT NULL DEFAULT now(),
  note               text
);
CREATE INDEX IF NOT EXISTS winnings_expiries_released_idx ON winnings_expiries (released_at);

-- ── 6. Shortfall contributions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS winnings_contributions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type         varchar(12) NOT NULL DEFAULT 'contribution' CONSTRAINT winnings_contributions_type CHECK (entry_type IN ('contribution', 'refund')),
  refund_of          uuid UNIQUE REFERENCES winnings_contributions(id),
  amount             numeric(12, 2) NOT NULL CONSTRAINT winnings_contributions_amount_positive CHECK (amount > 0),
  contributor_type   varchar(12) NOT NULL CONSTRAINT winnings_contributions_who CHECK (contributor_type IN ('writer', 'agent', 'staff', 'director', 'other')),
  contributor_id     uuid,
  contributor_name   varchar(160) NOT NULL,
  method             varchar(12) NOT NULL CONSTRAINT winnings_contributions_method CHECK (method IN ('cash', 'momo', 'bank', 'transfer')),
  account_id         uuid NOT NULL REFERENCES fin_money_accounts(id),
  purpose            text NOT NULL,
  payout_request_id  uuid REFERENCES payout_requests(id),
  game_id            uuid REFERENCES games(id),
  reference          varchar(120),
  received_by        uuid NOT NULL REFERENCES users(id),
  received_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT winnings_contributions_refund_shape CHECK ((entry_type = 'refund') = (refund_of IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS winnings_contributions_received_idx ON winnings_contributions (received_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['winnings_expiries', 'winnings_contributions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_append_only') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fin_forbid_change()', t || '_append_only', t);
    END IF;
  END LOOP;
END $$;
