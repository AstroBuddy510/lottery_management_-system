-- POS terminal registry and writer assignments.
--
-- Two tables, mirroring the padlocks/padlock_assignments pair: a registry of
-- devices, and an append-and-close log of who holds which one. Reassigning a
-- terminal stamps returned_at on the old row and inserts a new one, so the
-- history of custody survives.
--
-- The two partial unique indexes are the point of this migration. "One
-- terminal per writer" cannot be enforced by checking in the route first:
-- two assignment requests arriving together would both read "no open
-- assignment" and both insert. These indexes make Postgres reject the second
-- one. The same constraint in reverse stops one device being handed to two
-- writers at once.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS pos_terminals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number  varchar(100) NOT NULL,
  brand          varchar(100) NOT NULL,
  model          varchar(100) NOT NULL,
  -- 15 digits on nearly every device; wider so a 16/17-digit IMEISV still fits.
  imei           varchar(20)  NOT NULL,
  -- "available", "assigned", "damaged", "lost", "retired"
  status         varchar(50)  NOT NULL DEFAULT 'available',
  notes          text,
  -- Set by the database. When a device entered the estate is an audit fact,
  -- not something a form should be able to backdate.
  registered_at  timestamptz  NOT NULL DEFAULT now(),
  registered_by  uuid         NOT NULL REFERENCES users(id),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  -- Named explicitly to match what Drizzle generates for .unique(). An inline
  -- UNIQUE would get Postgres's default "..._key" name, and drizzle-kit push
  -- drops and recreates indexes whose names it does not recognise.
  CONSTRAINT pos_terminals_serial_number_unique UNIQUE (serial_number),
  CONSTRAINT pos_terminals_imei_unique UNIQUE (imei)
);

CREATE INDEX IF NOT EXISTS pos_terminals_status_idx
  ON pos_terminals (status);

CREATE TABLE IF NOT EXISTS terminal_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id  uuid        NOT NULL REFERENCES pos_terminals(id),
  writer_id    uuid        NOT NULL REFERENCES writers(id),
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  returned_at  timestamptz,
  notes        text,
  assigned_by  uuid        NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- A writer holds at most one terminal at a time.
CREATE UNIQUE INDEX IF NOT EXISTS terminal_assignments_one_open_per_writer
  ON terminal_assignments (writer_id)
  WHERE returned_at IS NULL;

-- A terminal is in at most one writer's hands at a time.
CREATE UNIQUE INDEX IF NOT EXISTS terminal_assignments_one_open_per_terminal
  ON terminal_assignments (terminal_id)
  WHERE returned_at IS NULL;

-- "What has this device's history been" and "what does this writer hold".
CREATE INDEX IF NOT EXISTS terminal_assignments_terminal_idx
  ON terminal_assignments (terminal_id, assigned_at);

CREATE INDEX IF NOT EXISTS terminal_assignments_writer_idx
  ON terminal_assignments (writer_id, assigned_at);
