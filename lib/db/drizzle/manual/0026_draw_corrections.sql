-- Draw corrections: changing a draw's declared numbers after it has run.
--
-- An administrator proposes the corrected winning and machine numbers with a
-- reason; the director approves or rejects (never their own). Approval puts
-- the draw back to "not yet settled" - its unclaimed winning tickets are
-- returned to active and its unclaimed payouts removed, both recorded in the
-- correction itself - and unlocks one re-run, with exactly the approved
-- numbers, which settles the tickets afresh, recalculates the draw and lets
-- payouts and SMS go out again. A draw whose wins have already been claimed
-- or paid cannot be corrected this way.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS draw_corrections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id           uuid NOT NULL REFERENCES games(id),
  old_winning       varchar(50) NOT NULL,
  old_machine       varchar(50) NOT NULL,
  new_winning       varchar(50) NOT NULL,
  new_machine       varchar(50) NOT NULL,
  reason            text NOT NULL,
  status            varchar(10) NOT NULL DEFAULT 'pending' CONSTRAINT draw_corrections_status CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  requested_by      uuid NOT NULL REFERENCES users(id),
  requested_at      timestamptz NOT NULL DEFAULT now(),
  decided_by        uuid REFERENCES users(id),
  decided_at        timestamptz,
  decision_note     text,
  -- What approval undid: the payouts removed and tickets returned to active.
  reversed          jsonb,
  applied_by        uuid REFERENCES users(id),
  applied_at        timestamptz,
  CONSTRAINT draw_corrections_maker_checker CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT draw_corrections_numbers_changed CHECK (old_winning <> new_winning OR old_machine <> new_machine)
);
-- One correction in flight per draw: waiting for the director, or approved and waiting for the re-run.
CREATE UNIQUE INDEX IF NOT EXISTS draw_corrections_one_open ON draw_corrections (game_id) WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS draw_corrections_game_idx ON draw_corrections (game_id, requested_at DESC);

-- A ticket's settlement undone by an approved correction, on its audit trail.
ALTER TYPE ticket_event_type ADD VALUE IF NOT EXISTS 'settlement_reversed';
