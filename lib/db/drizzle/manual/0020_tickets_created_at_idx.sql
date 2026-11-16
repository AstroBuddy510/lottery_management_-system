-- Live Ticker: "everything sold today" is a range on tickets.created_at.
--
-- The existing indexes start with writer_id or game_id, so without this the
-- ticker's snapshot reads the whole tickets table every time it loads. It is
-- the only schema change the Live Ticker needs, and the page works without
-- it - only slower as the table grows.
--
-- Safe to re-run. Creates an index; changes no rows.
CREATE INDEX IF NOT EXISTS tickets_created_at_idx
  ON tickets (created_at DESC);
