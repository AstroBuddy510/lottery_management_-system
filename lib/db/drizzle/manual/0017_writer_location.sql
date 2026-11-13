-- Where each writer sells from, so their terminal can be put on a map.
--
-- Nullable on purpose, even though the creation form requires it. Seventy-odd
-- writers predate this field; NOT NULL would have meant either refusing to
-- load them or inventing coordinates for them. They read as "no location set"
-- and stay off the terminal map until someone edits them.
--
-- `location` is the text an agent typed, lat/lng are geocoded from it. Both
-- are kept: the text is what a human recognises, and it is what lets the
-- coordinates be recomputed if they turn out wrong.
--
-- Mirrors the columns agents already carry, same types and precision.
--
-- Safe to re-run.

ALTER TABLE writers ADD COLUMN IF NOT EXISTS location varchar(200);
ALTER TABLE writers ADD COLUMN IF NOT EXISTS lat numeric(9,6);
ALTER TABLE writers ADD COLUMN IF NOT EXISTS lng numeric(9,6);

-- The terminal map asks for "writers with coordinates" and nothing else.
CREATE INDEX IF NOT EXISTS writers_located_idx
  ON writers (agent_id)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;
