-- Line-priced betting.
--
-- A bet is now priced in LINES: one pair for a Perm 2, one triple for a
-- Perm 3, one banker-and-partner pair for a Banker. The writer quotes a stake
-- PER LINE and the ticket's stake_amount holds the total taken, so every
-- sales figure downstream keeps meaning "money taken" without knowing about
-- lines at all.
--
-- Idempotent: safe to run more than once.

ALTER TABLE bet_types
  ADD COLUMN IF NOT EXISTS mechanic    varchar(30) NOT NULL DEFAULT 'direct_two',
  ADD COLUMN IF NOT EXISTS min_numbers integer     NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_numbers integer     NOT NULL DEFAULT 2;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS stake_per_line numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_count     integer        NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS banker_number  integer;

-- A perm selection is longer than two numbers.
ALTER TABLE tickets ALTER COLUMN numbers TYPE varchar(200);

-- Tickets sold before line pricing were all single-line, so their total stake
-- IS their per-line stake. Only fill rows still at the column default.
UPDATE tickets SET stake_per_line = stake_amount WHERE stake_per_line = 0;

-- Retire whatever was there. Nothing is deleted: tickets already sold must
-- keep resolving to the bet type they were sold on.
UPDATE bet_types SET is_active = false
WHERE code NOT IN ('D1', 'D2', 'D3', 'P2', 'P3', 'BA', 'BG');

INSERT INTO bet_types
  (name, code, description, mechanic, min_numbers, max_numbers,
   numbers_required, payout_multiplier, is_permutation, is_active)
VALUES
  ('Direct One',             'D1', 'One number, and it must be the first of the five drawn.',      'direct_one',     1, 1,  1,   40, false, true),
  ('Two Direct (Two Sure)',  'D2', 'Two numbers, both anywhere in the five drawn.',                'direct_two',     2, 2,  2,  240, false, true),
  ('Three Direct',           'D3', 'Three numbers, all three anywhere in the five drawn.',         'direct_three',   3, 3,  3, 1920, false, true),
  ('Permutation Two',        'P2', 'Every pair from the numbers picked. n x (n-1) / 2 lines.',     'perm_two',       3, 20, 3,  240, true,  true),
  ('Permutation Three',      'P3', 'Every triple picked. n x (n-1) x (n-2) / 6 lines.',            'perm_three',     4, 20, 4, 1920, true,  true),
  ('Banker All',             'BA', 'One banker against all 89 other numbers.',                     'banker_all',     0, 0,  1,  240, false, true),
  ('Banker Against',         'BG', 'One banker against a chosen few. One line per against-number.','banker_against', 1, 20, 1,  240, false, true)
ON CONFLICT (code) DO UPDATE SET
  name             = EXCLUDED.name,
  description      = EXCLUDED.description,
  mechanic         = EXCLUDED.mechanic,
  min_numbers      = EXCLUDED.min_numbers,
  max_numbers      = EXCLUDED.max_numbers,
  numbers_required = EXCLUDED.numbers_required,
  payout_multiplier = EXCLUDED.payout_multiplier,
  is_permutation   = EXCLUDED.is_permutation,
  is_active        = true,
  updated_at       = now();
