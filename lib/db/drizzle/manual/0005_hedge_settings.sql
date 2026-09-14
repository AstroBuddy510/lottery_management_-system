-- Hedge thresholds: when a line is big enough to lay off at the NLA.
--
-- hedge_settings is a singleton updated in place - a threshold has no
-- retroactive meaning, so unlike system_settings it is not versioned by
-- effective date. The row is created by the API on first read, so this
-- migration only has to make the tables exist.
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS hedge_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huge_win_threshold    numeric(14, 2) NOT NULL DEFAULT '10000',
  medium_coverage_pct   numeric(5, 4)  NOT NULL DEFAULT '0.25',
  high_coverage_pct     numeric(5, 4)  NOT NULL DEFAULT '0.5',
  critical_coverage_pct numeric(5, 4)  NOT NULL DEFAULT '1',
  hedge_coverage_pct    numeric(5, 4)  NOT NULL DEFAULT '1',
  min_hedge_stake       numeric(12, 2) NOT NULL DEFAULT '0',
  hedge_high_coverage   boolean        NOT NULL DEFAULT true,
  updated_by            uuid REFERENCES users(id),
  updated_at            timestamptz    NOT NULL DEFAULT now()
);

-- A bet type's own ceiling, which replaces the global one for that type.
CREATE TABLE IF NOT EXISTS hedge_bet_type_caps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_type_id   uuid NOT NULL UNIQUE REFERENCES bet_types(id),
  max_liability numeric(14, 2) NOT NULL,
  updated_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
