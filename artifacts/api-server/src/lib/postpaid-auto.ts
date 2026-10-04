/**
 * Automated postpaid settlement: when a writer must pay, and when selling stops.
 *
 * The manual flow collects once, after the draw, which leaves the company
 * carrying a whole game's sales on trust. This collects at the halfway point of
 * each game's selling window and again at the end of the day, and stops the
 * terminal selling until the bill clears.
 *
 * Everything that decides money or timing lives here as a pure function, so it
 * can be tested without a database or a clock. The routes do the reading and
 * writing; they do not do the arithmetic.
 *
 * Two rules carried over from the manual flow, unchanged and deliberately so:
 * wins never reduce what a writer owes, and the commission rate is frozen when
 * the bill is quoted.
 */

export interface AutoPostpaidConfig {
  enabled: boolean;
  reminderLeadMinutes: number[];
  graceMinutes: number;
  blockNextDay: boolean;
  minimumChargeable: number;
}

export interface GameWindow {
  goLiveAt: Date;
  closeAt: Date;
}

export interface LedgerState {
  /** Everything sold into this game so far, before commission. */
  totalStakes: number;
  /** Already collected against this ledger. */
  amountPaid: number;
  /** Frozen at quote time; falls back to the live rate before then. */
  commissionPct: number | null;
  remindersSent: number;
}

export type BlockReason =
  | "midpoint-unpaid"
  | "previous-day-unpaid"
  | null;

export interface SellGate {
  allowed: boolean;
  reason: BlockReason;
  /** What must be paid to lift the block, to the penny. */
  amountDue: number;
  /** When selling stops for this game, or null when it never will. */
  locksAt: Date | null;
  /** Midpoint of the selling window, for the countdown. */
  midpointAt: Date | null;
  /** Oldest unsettled day, when that is what is blocking. */
  owedFrom: string | null;
}

/** Round to the penny the same way money is stored. */
export function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The halfway point of a game's selling window.
 *
 * Measured from go-live to close, not from midnight: "half of the game's live
 * time" is the window a writer can actually sell in.
 */
export function midpointOf(game: GameWindow): Date {
  const open = game.goLiveAt.getTime();
  const close = game.closeAt.getTime();
  return new Date(open + (close - open) / 2);
}

/**
 * What a writer owes on a ledger right now.
 *
 * Gross less commission, less whatever has already been collected. Wins are
 * absent on purpose - see the module note.
 */
export function outstandingOn(ledger: LedgerState, liveCommissionPct: number): number {
  const pct = Math.min(Math.max(ledger.commissionPct ?? liveCommissionPct, 0), 1);
  const gross = Math.max(ledger.totalStakes, 0);
  const commission = money(gross * pct);
  const payable = Math.max(money(gross - commission), 0);
  return Math.max(money(payable - Math.max(ledger.amountPaid, 0)), 0);
}

/**
 * May this writer sell into this game right now?
 *
 * Order matters: an unpaid previous day blocks everything, whatever today's
 * game is doing. A writer who starts a new day owing money should be told that,
 * not handed a countdown to a midpoint they will never reach.
 */
export function sellGate(opts: {
  now: Date;
  config: AutoPostpaidConfig;
  game: GameWindow;
  ledger: LedgerState | null;
  liveCommissionPct: number;
  /** Unsettled ledgers from days before today, oldest first. */
  priorUnsettled: { ledgerDate: string; outstanding: number }[];
}): SellGate {
  const { now, config, game, ledger, liveCommissionPct, priorUnsettled } = opts;

  const midpointAt = midpointOf(game);
  const locksAt = new Date(midpointAt.getTime() + config.graceMinutes * 60_000);

  // Off means off: the manual flow, untouched.
  if (!config.enabled) {
    return { allowed: true, reason: null, amountDue: 0, locksAt: null, midpointAt: null, owedFrom: null };
  }

  if (config.blockNextDay) {
    const owed = priorUnsettled.filter((p) => p.outstanding > config.minimumChargeable);
    if (owed.length > 0) {
      const total = money(owed.reduce((sum, p) => sum + p.outstanding, 0));
      return {
        allowed: false,
        reason: "previous-day-unpaid",
        amountDue: total,
        locksAt,
        midpointAt,
        owedFrom: owed[0]!.ledgerDate,
      };
    }
  }

  const outstanding = ledger ? outstandingOn(ledger, liveCommissionPct) : 0;

  // Past the midpoint (plus any grace) with money owed: the terminal stops.
  if (now.getTime() >= locksAt.getTime() && outstanding > config.minimumChargeable) {
    return {
      allowed: false,
      reason: "midpoint-unpaid",
      amountDue: outstanding,
      locksAt,
      midpointAt,
      owedFrom: null,
    };
  }

  return { allowed: true, reason: null, amountDue: outstanding, locksAt, midpointAt, owedFrom: null };
}

/**
 * Which reminder is due, if any.
 *
 * Lead times are tried largest first so a writer who has been offline through
 * several of them gets the most urgent one rather than a stale one, and the
 * earlier ones are marked spent in the same pass so they never arrive late.
 * Returns the bit to set alongside the message, so the caller records exactly
 * what it sent.
 */
export function dueReminder(opts: {
  now: Date;
  config: AutoPostpaidConfig;
  game: GameWindow;
  outstanding: number;
  remindersSent: number;
}): { leadMinutes: number; mask: number; minutesLeft: number } | null {
  const { now, config, game, outstanding, remindersSent } = opts;
  if (!config.enabled) return null;
  if (outstanding <= config.minimumChargeable) return null;

  const midpoint = midpointOf(game).getTime();
  const msLeft = midpoint - now.getTime();
  // After the midpoint the lock speaks for itself; no more nagging.
  if (msLeft <= 0) return null;
  const minutesLeft = msLeft / 60_000;

  const leads = [...config.reminderLeadMinutes].sort((a, b) => b - a);
  let mask = 0;
  let chosen: number | null = null;

  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i]!;
    if (minutesLeft > lead) continue;
    const bit = 1 << i;
    if ((remindersSent & bit) !== 0) continue;
    mask |= bit;
    // Keep going: later entries are more urgent, and any we pass are spent.
    chosen = lead;
  }

  if (chosen === null) return null;
  // The message should name the most urgent threshold crossed, which is the
  // smallest lead time we just consumed.
  const consumed = leads.filter((l, i) => (mask & (1 << i)) !== 0);
  return { leadMinutes: Math.min(...consumed), mask, minutesLeft };
}

/** Parse the admin's comma-separated lead times into sane numbers. */
export function parseLeadMinutes(raw: string): number[] {
  const out = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 24 * 60);
  // Largest first, de-duplicated, capped so the bitmask stays within an int.
  return [...new Set(out)].sort((a, b) => b - a).slice(0, 8);
}
