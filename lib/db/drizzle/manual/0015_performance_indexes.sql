-- Indexes for the reads that happen on every sale, and a safety note.
--
-- Production today: tickets is 132 rows and 112 kB, so none of this is
-- urgent - a scan of 112 kB costs nothing. It is cheap now and expensive to
-- add once the table is large, which is the only reason to do it early.
--
-- daily_calculations is the one with a real gap: 339 rows and no index of
-- any kind, consulted twice on every gross or wins entry to ask whether a
-- game is locked.
--
-- Safe to re-run. At these sizes each statement is effectively instant, so
-- CONCURRENTLY is not used; it would be worth it above a few hundred
-- thousand rows, where plain CREATE INDEX holds a write lock.

-- A writer's own ticket list: their tickets, newest first.
CREATE INDEX IF NOT EXISTS tickets_writer_created_idx
  ON tickets (writer_id, created_at DESC);

-- Settlement and the live board sweep one game at a time, by state.
CREATE INDEX IF NOT EXISTS tickets_game_status_idx
  ON tickets (game_id, status);

-- "Has this game been calculated yet" - the lock check on every entry.
CREATE INDEX IF NOT EXISTS daily_calculations_game_idx
  ON daily_calculations (game_id);

CREATE INDEX IF NOT EXISTS daily_calculations_writer_date_idx
  ON daily_calculations (writer_id, calc_date);
