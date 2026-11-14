-- A terminal stays with its writer indefinitely; it is unassigned, not returned.
--
-- "Returned" carried a meaning the business does not have: terminals are not
-- lent out and handed back on a schedule, they sit with a writer until
-- something changes - usually a fault. What gets recorded is the date the
-- pairing ended, so the column is named for that.
--
-- Only a rename. Postgres rewrites the predicates of dependent indexes with
-- the column, which was checked before writing this:
--
--   CREATE UNIQUE INDEX terminal_assignments_one_open_per_writer
--     ON ... (writer_id) WHERE (unassigned_at IS NULL)
--
-- so the two partial unique indexes that enforce one-terminal-per-writer
-- follow automatically. Dropping and recreating them would have opened a
-- window, however brief, in which two writers could be given the same device.
--
-- Guarded so a re-run is a no-op rather than an error: ALTER TABLE ... RENAME
-- has no IF EXISTS form for this case.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'terminal_assignments'
      AND column_name = 'returned_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'terminal_assignments'
      AND column_name = 'unassigned_at'
  ) THEN
    ALTER TABLE terminal_assignments RENAME COLUMN returned_at TO unassigned_at;
  END IF;
END $$;

-- Devices come back from a writer either working or faulty. A faulty one must
-- not be offered to the next writer, so it rests in 'repair' until somebody
-- says otherwise. No schema change - status is already a varchar - but the
-- index is worth having now that stock is filtered by it on every assignment.
CREATE INDEX IF NOT EXISTS pos_terminals_available_idx
  ON pos_terminals (status)
  WHERE status = 'available';
