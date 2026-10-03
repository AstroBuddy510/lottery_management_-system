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

-- 4. NOTE: slip_number is deliberately NOT unique.
--    It is a grouping key - every bet in one customer's basket carries the
--    same slip number so a single itemised receipt can be printed. An earlier
--    draft of this migration added UNIQUE (slip_number) and de-duplicated the
--    "duplicates"; checking production first showed all five such groups were
--    one writer each, i.e. ordinary multi-bet slips. That constraint would
--    have rejected every basket of more than one bet, and the de-duplication
--    would have broken their receipts. Deliberately not added.
--
--    Two different baskets colliding on one number is still the real risk, and
--    the sequence above is what removes it. Enforcing that properly would need
--    a slips table with its own primary key; it is not expressible as a
--    constraint on tickets alone.

-- 5. Say what happened, so running this is not a silent act.
DO $$
BEGIN
  RAISE NOTICE 'Numbering ready: next_ticket_number() and next_slip_number() installed, tickets.ticket_number defaulted.';
END $$;
