/**
 * Pool exposure: what a draw would cost the company.
 *
 * Every active ticket is a promise to pay `potentialPayout` if its numbers
 * all come up. Tickets are not independent - thousands of writers land on the
 * same popular combinations - so the real question is not "how much have we
 * sold" but "which single combination, if the NLA draws it, do we owe the
 * most on". That combination is the company's worst case, and it is the one
 * worth laying off by staking the same numbers at the NLA.
 *
 * The numbers on a ticket are a set, not a sequence: settlement wins when
 * every played number appears among the drawn numbers, so "12,45" and
 * "45,12" are the same bet and must aggregate together. `combinationKey`
 * normalises that.
 */

export interface ExposureTicket {
  writerId: string;
  betTypeId: string;
  numbers: string;
  stakeAmount: string;
  potentialPayout: string;
}

export interface BetTypeInfo {
  id: string;
  name: string;
  code: string;
  payoutMultiplier: string;
}

export type Severity = "low" | "medium" | "high" | "critical";

export interface CombinationExposure {
  key: string;
  numbers: number[];
  betTypeId: string;
  betTypeName: string;
  betTypeCode: string;
  multiplier: number;
  ticketCount: number;
  writerCount: number;
  redFlagTicketCount: number;
  totalStake: number;
  /** What the company pays out if these numbers are drawn. */
  liability: number;
  /** Liability measured against everything taken on the game. */
  coverage: number;
  /** Company's net position if this combination hits: negative is a loss. */
  netIfDrawn: number;
  /** Stake at the NLA on these numbers to recover the full liability. */
  hedgeStake: number;
  severity: Severity;
}

export interface NumberExposure {
  number: number;
  ticketCount: number;
  totalStake: number;
  liability: number;
}

export interface ExposureReport {
  ticketCount: number;
  poolStake: number;
  totalLiability: number;
  peakLiability: number;
  peakCoverage: number;
  /** Cost of laying off every combination rated high or critical. */
  hedgeToCover: number;
  atRiskCount: number;
  combinations: CombinationExposure[];
  numberHeat: NumberExposure[];
}

/**
 * Severity is the share of the whole pool a single combination would consume.
 * At coverage >= 1 the payout on that one combination exceeds everything
 * taken on the game, so the draw is an outright loss however well the rest of
 * the book performs - that is the line worth insuring above all others.
 */
export const SEVERITY_THRESHOLDS = { critical: 1, high: 0.5, medium: 0.25 } as const;

export function severityFor(coverage: number): Severity {
  if (coverage >= SEVERITY_THRESHOLDS.critical) return "critical";
  if (coverage >= SEVERITY_THRESHOLDS.high) return "high";
  if (coverage >= SEVERITY_THRESHOLDS.medium) return "medium";
  return "low";
}

/** Sorted, de-duplicated numbers - the identity of a bet under the win rule. */
export function parseNumbers(raw: string): number[] {
  const seen = new Set<number>();
  for (const part of raw.split(",")) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n)) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

export function combinationKey(betTypeId: string, numbers: number[]): string {
  return `${betTypeId}:${numbers.join("-")}`;
}

export function buildExposureReport(
  tickets: ExposureTicket[],
  betTypes: BetTypeInfo[],
  redFlaggedWriterIds: Set<string>,
): ExposureReport {
  const betTypeById = new Map(betTypes.map((b) => [b.id, b]));

  let poolStake = 0;
  let totalLiability = 0;

  const groups = new Map<
    string,
    Omit<CombinationExposure, "coverage" | "netIfDrawn" | "hedgeStake" | "severity" | "writerCount"> & {
      writers: Set<string>;
    }
  >();
  const byNumber = new Map<number, NumberExposure>();

  for (const t of tickets) {
    const stake = parseFloat(t.stakeAmount) || 0;
    const payout = parseFloat(t.potentialPayout) || 0;
    poolStake += stake;
    totalLiability += payout;

    const numbers = parseNumbers(t.numbers);
    if (numbers.length === 0) continue;

    const betType = betTypeById.get(t.betTypeId);
    const key = combinationKey(t.betTypeId, numbers);

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        numbers,
        betTypeId: t.betTypeId,
        betTypeName: betType?.name ?? "Unknown",
        betTypeCode: betType?.code ?? "?",
        multiplier: parseFloat(betType?.payoutMultiplier ?? "0") || 0,
        ticketCount: 0,
        redFlagTicketCount: 0,
        totalStake: 0,
        liability: 0,
        writers: new Set<string>(),
      };
      groups.set(key, group);
    }
    group.ticketCount += 1;
    group.totalStake += stake;
    group.liability += payout;
    group.writers.add(t.writerId);
    if (redFlaggedWriterIds.has(t.writerId)) group.redFlagTicketCount += 1;

    for (const n of numbers) {
      let heat = byNumber.get(n);
      if (!heat) {
        heat = { number: n, ticketCount: 0, totalStake: 0, liability: 0 };
        byNumber.set(n, heat);
      }
      heat.ticketCount += 1;
      heat.totalStake += stake;
      heat.liability += payout;
    }
  }

  const combinations: CombinationExposure[] = [...groups.values()]
    .map(({ writers, ...g }) => {
      const coverage = poolStake > 0 ? g.liability / poolStake : 0;
      return {
        ...g,
        writerCount: writers.size,
        coverage,
        netIfDrawn: poolStake - g.liability,
        // What must be staked at the NLA on these numbers for their payout to
        // cover ours. Assumes the NLA pays these odds; where it differs, scale.
        hedgeStake: g.multiplier > 0 ? g.liability / g.multiplier : 0,
        severity: severityFor(coverage),
      };
    })
    .sort((a, b) => b.liability - a.liability);

  const atRisk = combinations.filter((c) => c.severity === "high" || c.severity === "critical");

  return {
    ticketCount: tickets.length,
    poolStake,
    totalLiability,
    peakLiability: combinations[0]?.liability ?? 0,
    peakCoverage: combinations[0]?.coverage ?? 0,
    hedgeToCover: atRisk.reduce((sum, c) => sum + c.hedgeStake, 0),
    atRiskCount: atRisk.length,
    combinations,
    numberHeat: [...byNumber.values()].sort((a, b) => b.liability - a.liability),
  };
}
