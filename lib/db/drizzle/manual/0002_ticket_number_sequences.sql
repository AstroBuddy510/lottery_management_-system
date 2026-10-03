-- Ticket and slip numbers: random four digits -> database-owned sequences.
--
-- The old scheme drew a random number 1000-9999 within a day, behind a UNIQUE
-- constraint, with no retry, inside the sale transaction. A collision aborted
-- the whole slip: the customer got nothing and the writer got a 500. Measured
-- against a real Postgres, 10,000 sales in one day lost 3,944 of them - a 39%
-- failure rate - and past 9,000 every sale would fail permanently.
--
-- Safe to run more than once.

-- 1. The counters. nextval takes no row lock and never blocks, so a thousand
--    writers selling at once cannot queue behind one another the way a counter
--    table would make them. A rolled-back sale leaves a gap in the numbering,
--    which is the right trade: a gap is cosmetic, a collision loses a sale.
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq AS bigint START 1;
CREATE SEQUENCE IF NOT EXISTS slip_number_seq   AS bigint START 1;

-- 2. The number is built in the database, not in application code, so there is
--    no window between choosing one and storing it, and no second code path
--    can ever invent its own format.
--
--    VOLATILE is load-bearing. Postgres caches a STABLE function's result
--    within a statement, so a multi-row insert would hand every row the SAME
--    number; VOLATILE forces one call per row. This was caught in testing.
--
--    The CASE is also load-bearing. lpad() TRUNCATES when the input is longer
--    than the width - lpad('1000000', 6, '0') returns '100000' - so padding
--    alone would silently wrap past 999,999 and start colliding again. Below a
--    million the suffix is padded to six; above it, it simply grows wider.
CREATE OR REPLACE FUNCTION next_ticket_number() RETURNS text
  LANGUAGE sql VOLATILE AS $fn$
  SELECT 'TKT-' || to_char(now() AT TIME ZONE 'Africa/Accra', 'YYYYMMDD') || '-' ||
         CASE WHEN v < 1000000 THEN lpad(v::text, 6, '0') ELSE v::text END
    FROM (SELECT nextval('ticket_number_seq') AS v) q;
$fn$;

CREATE OR REPLACE FUNCTION next_slip_number() RETURNS text
  LANGUAGE sql VOLATILE AS $fn$
  SELECT 'SLIP-' || to_char(now() AT TIME ZONE 'Africa/Accra', 'YYYYMMDD') || '-' ||
         CASE WHEN v < 1000000 THEN lpad(v::text, 6, '0') ELSE v::text END
    FROM (SELECT nextval('slip_number_seq') AS v) q;
$fn$;

-- 3. Belt and braces: even a future insert that forgets to ask gets a valid
--    number instead of a constraint violation.
ALTER TABLE tickets ALTER COLUMN ticket_number SET DEFAULT next_ticket_number();

-- 4. Existing slip numbers used the same random scheme and had NO unique
--    constraint, so duplicates may already be in the table - two customers'
--    baskets silently sharing one receipt. Give every duplicate past the first
--    a distinct suffix before the constraint goes on, so the migration cannot
--    fail halfway and the older receipts stay traceable.
WITH ranked AS (
  SELECT id, slip_number,
         row_number() OVER (PARTITION BY slip_number ORDER BY created_at, id) AS rn
    FROM tickets
   WHERE slip_number IS NOT NULL
)
UPDATE tickets t
   SET slip_number = ranked.slip_number || '-D' || ranked.rn
  FROM ranked
 WHERE t.id = ranked.id AND ranked.rn > 1;

-- 5. A plain unique index, not a partial one: Postgres treats NULLs as
--    distinct, so single bets sold on their own (slip_number IS NULL) are all
--    still allowed. Plain also matches what the Drizzle schema declares, so
--    `drizzle-kit push` will not try to add a second, competing constraint.
CREATE UNIQUE INDEX IF NOT EXISTS tickets_slip_number_unique
    ON tickets (slip_number);

-- 6. Say what happened, so running this is not a silent act.
DO $$
DECLARE renamed integer;
BEGIN
  SELECT count(*) INTO renamed FROM tickets WHERE slip_number ~ '-D[0-9]+$';
  RAISE NOTICE 'Numbering ready. % slip number(s) carry a -D suffix from de-duplication.', renamed;
END $$;
