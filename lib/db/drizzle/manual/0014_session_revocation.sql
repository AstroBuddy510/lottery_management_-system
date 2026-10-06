-- Session revocation.
--
-- One nullable timestamp per identity: nothing issued before this moment is a
-- valid session any more. That revokes every token for the account at once
-- and never grows, which a list of dead token ids would. NULL means nothing
-- has ever been revoked, which is every row today.
--
-- Checked only when a token is refreshed, so a signed-out access token can
-- still be used for the rest of its fifteen minutes. That is the deliberate
-- trade for not adding a database read to every request on an app that
-- already polls hard. Safe to re-run; adds no default, rewrites no rows.

ALTER TABLE users   ADD COLUMN IF NOT EXISTS sessions_valid_from timestamptz;
ALTER TABLE writers ADD COLUMN IF NOT EXISTS sessions_valid_from timestamptz;
