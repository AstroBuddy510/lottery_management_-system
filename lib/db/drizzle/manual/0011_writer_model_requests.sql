-- A writer asking to sell on credit.
--
-- Postpaid means selling without buying units first, so the company carries
-- the exposure until settlement. That is a commercial decision about a
-- particular person, not a setting the writer flips themselves.
--
-- Before this table existed the portal told writers "ask your agent" and
-- created nothing, so the request reached no one at all.
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS writer_model_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  writer_id       uuid NOT NULL REFERENCES writers(id),
  requested_model varchar(10) NOT NULL,
  current_model   varchar(10) NOT NULL,
  status          varchar(10) NOT NULL DEFAULT 'pending',
  reason          text,
  decided_by      uuid REFERENCES users(id),
  decided_by_role varchar(20),
  decision_note   text,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS writer_model_requests_status_idx
  ON writer_model_requests (status, created_at);
CREATE INDEX IF NOT EXISTS writer_model_requests_writer_idx
  ON writer_model_requests (writer_id, created_at);

-- One open request per writer: a second would let two deciders reach
-- different answers about the same person at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS writer_model_requests_one_pending_idx
  ON writer_model_requests (writer_id)
  WHERE status = 'pending';
