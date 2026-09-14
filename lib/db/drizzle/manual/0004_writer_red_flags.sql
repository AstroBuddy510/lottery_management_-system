-- Risk watch mark on a writer.
--
-- A red-flagged writer is one whose sales are large enough to move the
-- company's exposure on their own, so Risk Management keeps their book on
-- screen for every game. It is a standing property of the writer, not an
-- incident to review and close, which is why it lives here and not in
-- risk_flags.
--
-- Idempotent: safe to run more than once.

ALTER TABLE writers
  ADD COLUMN IF NOT EXISTS is_red_flagged  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS red_flag_reason text,
  ADD COLUMN IF NOT EXISTS red_flagged_by  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS red_flagged_at  timestamptz;

-- The risk screen reads only the flagged few out of every writer.
CREATE INDEX IF NOT EXISTS writers_red_flagged_idx
  ON writers (is_red_flagged)
  WHERE is_red_flagged;
