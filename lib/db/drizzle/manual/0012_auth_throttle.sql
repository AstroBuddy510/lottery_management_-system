-- Brute-force protection for sign-in.
--
-- A PIN is four digits. bcrypt makes each guess cost something, but nothing
-- was counting the guesses, so a script pointed at one known phone number
-- could walk all ten thousand. This table is the counter.
--
-- One row per watched thing, updated in place, so it stays about as large as
-- the number of people who recently mistyped a PIN. It is safe to re-run.

CREATE TABLE IF NOT EXISTS auth_throttle (
  scope           text        NOT NULL,
  key             text        NOT NULL,
  failed_count    integer     NOT NULL DEFAULT 0,
  last_failed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

-- Lets stale rows be swept cheaply; nothing depends on it for correctness.
CREATE INDEX IF NOT EXISTS auth_throttle_last_failed_at_idx
  ON auth_throttle (last_failed_at);

-- Housekeeping, safe to run any time: counters older than the reset window
-- hold nobody back, so they are only taking up space.
DELETE FROM auth_throttle WHERE last_failed_at < now() - interval '1 day';
