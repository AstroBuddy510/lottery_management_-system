/**
 * What a bet costs, and what it pays.
 *
 * Every bet is priced in LINES. A line is one elementary wager - one pair for
 * a Perm 2, one triple for a Perm 3, one banker-and-partner pair for a Banker.
 * The writer quotes a stake PER LINE, so a GHS 1 Perm 2 on five numbers is ten
 * lines and costs GHS 10. A win pays that per-line stake times the bet type's
 * multiplier, once for every line that came in.
 *
 * That single rule is what makes the payouts scale correctly: two of the
 * player's numbers drawn is one winning pair (GHS 240), three is three
 * winning pairs (GHS 720), because three numbers contain three pairs.
 *
 * All arithmetic here is pure. The database stores the results, never the
 * reasoning.
 */

export const DRAW_SIZE = 5;
export const NUMBER_MIN = 1;
export const NUMBER_MAX = 90;

export type Mechanic =
  | "direct_one"
  | "direct_two"
  | "direct_three"
  | "perm_two"
  | "perm_three"
  | "banker_all"
  | "banker_against";

export const MECHANICS: Mechanic[] = [
  "direct_one",
  "direct_two",
  "direct_three",
  "perm_two",
  "perm_three",
  "banker_all",
  "banker_against",
];

export interface MechanicSpec {
  label: string;
  /** Numbers the player picks, excluding the banker. */
  minNumbers: number;
  maxNumbers: number;
  needsBanker: boolean;
  /** House multiplier this mechanic is normally sold at. */
  defaultMultiplier: number;
  blurb: string;
}

export const MECHANIC_SPECS: Record<Mechanic, MechanicSpec> = {
  direct_one: {
    label: "Direct One",
    minNumbers: 1,
    maxNumbers: 1,
    needsBanker: false,
    defaultMultiplier: 40,
    blurb: "One number, and it must be the first of the five drawn.",
  },
  direct_two: {
    label: "Two Direct (Two Sure)",
    minNumbers: 2,
    maxNumbers: 2,
    needsBanker: false,
    defaultMultiplier: 240,
    blurb: "Two numbers, both anywhere in the five drawn.",
  },
  direct_three: {
    label: "Three Direct",
    minNumbers: 3,
    maxNumbers: 3,
    needsBanker: false,
    defaultMultiplier: 1920,
    blurb: "Three numbers, all three anywhere in the five drawn.",
  },
  perm_two: {
    label: "Permutation Two",
    minNumbers: 3,
    maxNumbers: 20,
    needsBanker: false,
    defaultMultiplier: 240,
    blurb: "Every pair from the numbers picked. n x (n-1) / 2 lines.",
  },
  perm_three: {
    label: "Permutation Three",
    minNumbers: 4,
    maxNumbers: 20,
    needsBanker: false,
    defaultMultiplier: 1920,
    blurb: "Every triple from the numbers picked. n x (n-1) x (n-2) / 6 lines.",
  },
  banker_all: {
    label: "Banker All",
    minNumbers: 0,
    maxNumbers: 0,
    needsBanker: true,
    defaultMultiplier: 240,
    blurb: "One banker against all 89 other numbers.",
  },
  banker_against: {
    label: "Banker Against",
    minNumbers: 1,
    maxNumbers: 20,
    needsBanker: true,
    defaultMultiplier: 240,
    blurb: "One banker against a chosen few. One line per against-number.",
  },
};

export interface BetSelection {
  mechanic: Mechanic;
  /** Picked numbers, not counting the banker. */
  numbers: number[];
  bankerNumber?: number | null;
  stakePerLine: number;
  multiplier: number;
  /** Per-line stake bounds from the bet type. A zero max means no ceiling. */
  minStake?: number;
  maxStake?: number;
}

export interface BetQuote {
  lines: number;
  totalStake: number;
  /** Most the house could owe on this ticket. */
  maxPayout: number;
}

export interface BetOutcome {
  matchedNumbers: number[];
  winningLines: number;
  payout: number;
}

/** n choose k, exactly, without overflowing on the sizes involved here. */
export function choose(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i;
  }
  return Math.round(result);
}

function unique(numbers: number[]): number[] {
  return [...new Set(numbers)];
}

/**
 * Reject a selection the rules do not allow. Returns the reason, or null when
 * the bet is sound. Everything the writer portal and the API both need to
 * agree on lives here, so they cannot drift apart.
 */
export function validateSelection(selection: BetSelection): string | null {
  const spec = MECHANIC_SPECS[selection.mechanic];
  if (!spec) return "Unknown bet type";

  const numbers = selection.numbers;
  if (unique(numbers).length !== numbers.length) return "The same number is picked twice";

  for (const n of [...numbers, ...(selection.bankerNumber != null ? [selection.bankerNumber] : [])]) {
    if (!Number.isInteger(n) || n < NUMBER_MIN || n > NUMBER_MAX) {
      return `Numbers must be whole numbers from ${NUMBER_MIN} to ${NUMBER_MAX}`;
    }
  }

  if (spec.needsBanker) {
    if (selection.bankerNumber == null) return "Pick a banker number";
    if (numbers.includes(selection.bankerNumber)) {
      return "The banker cannot also be one of the against numbers";
    }
  } else if (selection.bankerNumber != null) {
    return "This bet type has no banker";
  }

  if (numbers.length < spec.minNumbers) {
    return spec.minNumbers === spec.maxNumbers
      ? `Pick exactly ${spec.minNumbers} number${spec.minNumbers === 1 ? "" : "s"}`
      : `Pick at least ${spec.minNumbers} numbers`;
  }
  if (numbers.length > spec.maxNumbers) {
    return spec.maxNumbers === 0
      ? "This bet type takes only a banker"
      : `Pick at most ${spec.maxNumbers} numbers`;
  }

  if (!(selection.stakePerLine > 0)) return "Stake per line must be more than zero";
  const min = selection.minStake ?? 0;
  const max = selection.maxStake ?? 0;
  if (min > 0 && selection.stakePerLine < min) {
    return `Stake per line must be at least ${min.toFixed(2)}`;
  }
  if (max > 0 && selection.stakePerLine > max) {
    return `Stake per line cannot be more than ${max.toFixed(2)}`;
  }
  if (!(selection.multiplier > 0)) return "This bet type has no payout multiplier set";

  return null;
}

/** How many elementary wagers this selection contains. */
export function lineCount(mechanic: Mechanic, numberCount: number): number {
  switch (mechanic) {
    case "direct_one":
    case "direct_two":
    case "direct_three":
      return 1;
    case "perm_two":
      return choose(numberCount, 2);
    case "perm_three":
      return choose(numberCount, 3);
    // The banker is played against every other number in the pool.
    case "banker_all":
      return NUMBER_MAX - 1;
    case "banker_against":
      return numberCount;
  }
}

/**
 * Price the ticket, and state the worst case. `maxPayout` is what the house
 * owes if the draw is as kind to this ticket as it can possibly be - the
 * figure the risk desk reads, so it is deliberately the ceiling and not an
 * expectation.
 */
export function quote(selection: BetSelection): BetQuote {
  const lines = lineCount(selection.mechanic, selection.numbers.length);
  const totalStake = lines * selection.stakePerLine;
  const unit = selection.stakePerLine * selection.multiplier;

  let bestLines: number;
  switch (selection.mechanic) {
    case "direct_one":
    case "direct_two":
    case "direct_three":
      bestLines = 1;
      break;
    case "perm_two":
      // At most five of the picked numbers can be drawn.
      bestLines = choose(Math.min(selection.numbers.length, DRAW_SIZE), 2);
      break;
    case "perm_three":
      bestLines = choose(Math.min(selection.numbers.length, DRAW_SIZE), 3);
      break;
    case "banker_all":
      bestLines = DRAW_SIZE - 1;
      break;
    case "banker_against":
      // The banker occupies one of the five slots, so at most four of the
      // against numbers can join it.
      bestLines = Math.min(selection.numbers.length, DRAW_SIZE - 1);
      break;
  }

  return { lines, totalStake, maxPayout: bestLines * unit };
}

/**
 * Settle the ticket against a draw. `drawnNumbers` is in draw order, which
 * only Direct One cares about.
 */
export function settleSelection(selection: BetSelection, drawnNumbers: number[]): BetOutcome {
  const drawn = drawnNumbers.filter((n) => Number.isInteger(n));
  const drawnSet = new Set(drawn);
  const matchedNumbers = selection.numbers.filter((n) => drawnSet.has(n));
  const matched = matchedNumbers.length;
  const bankerDrawn = selection.bankerNumber != null && drawnSet.has(selection.bankerNumber);

  let winningLines: number;
  switch (selection.mechanic) {
    case "direct_one":
      // Position matters here and nowhere else.
      winningLines = drawn[0] !== undefined && drawn[0] === selection.numbers[0] ? 1 : 0;
      break;
    case "direct_two":
      winningLines = matched === 2 ? 1 : 0;
      break;
    case "direct_three":
      winningLines = matched === 3 ? 1 : 0;
      break;
    case "perm_two":
      winningLines = choose(matched, 2);
      break;
    case "perm_three":
      winningLines = choose(matched, 3);
      break;
    case "banker_all":
      // Every other drawn number forms a winning pair with the banker.
      winningLines = bankerDrawn ? Math.max(drawn.length - 1, 0) : 0;
      break;
    case "banker_against":
      winningLines = bankerDrawn ? matched : 0;
      break;
  }

  return {
    matchedNumbers,
    winningLines,
    payout: winningLines * selection.stakePerLine * selection.multiplier,
  };
}

/** Comma-separated numbers, as stored on a ticket. */
export function parseNumberList(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n));
}
