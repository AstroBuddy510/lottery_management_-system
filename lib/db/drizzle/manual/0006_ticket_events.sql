-- Append-only history of everything that happens to a ticket.
--
-- The tickets table holds only current state, which cannot answer "who
-- touched this, and in what order". Fraud in a lottery is almost always a
-- statement about order or multiplicity - validated before it was sold, paid
-- before the draw, claimed twice - so the sequence has to be kept.
--
-- Nothing here is ever updated or deleted; a correction is another row.
-- Idempotent: safe to run more than once.

DO $$ BEGIN
  CREATE TYPE ticket_event_type AS ENUM (
    'sold', 'validated', 'settled_won', 'settled_lost',
    'claim_approved', 'claim_rejected', 'paid', 'voided', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ticket_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES tickets(id),
  event_type    ticket_event_type NOT NULL,
  from_status   varchar(20),
  to_status     varchar(20),
  actor_user_id uuid REFERENCES users(id),
  actor_role    varchar(30),
  source        varchar(20) NOT NULL DEFAULT 'system',
  note          text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events (ticket_id, occurred_at);
CREATE INDEX IF NOT EXISTS ticket_events_type_idx   ON ticket_events (event_type, occurred_at);
