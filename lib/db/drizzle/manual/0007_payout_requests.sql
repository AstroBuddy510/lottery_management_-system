-- payout_requests: the winners a settled draw produces, and the queue the
-- payout review screen works from.
--
-- This table was missing from production while the code that writes to it was
-- live, so settling a draw rolled back with "relation payout_requests does not
-- exist" and the run reported only "failed to run calculations". The game was
-- left closed with its numbers posted and no wins behind it.
--
-- Idempotent: safe to run more than once.

DO $$ BEGIN
  CREATE TYPE payout_request_status AS ENUM ('pending', 'approved', 'paid', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS payout_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      uuid NOT NULL REFERENCES tickets(id),
  game_result_id uuid NOT NULL REFERENCES game_results(id),
  writer_id      uuid NOT NULL REFERENCES writers(id),
  agent_id       uuid NOT NULL REFERENCES agents(id),
  payout_amount  numeric(12, 2) NOT NULL,
  status         payout_request_status NOT NULL DEFAULT 'pending',
  approved_by    uuid REFERENCES users(id),
  paid_at        timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_requests_ticket_idx       ON payout_requests (ticket_id);
CREATE INDEX IF NOT EXISTS payout_requests_writer_status_idx ON payout_requests (writer_id, status);
CREATE INDEX IF NOT EXISTS payout_requests_game_result_idx  ON payout_requests (game_result_id);
