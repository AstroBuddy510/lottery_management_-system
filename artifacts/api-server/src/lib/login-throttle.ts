/**
 * Login throttling: the decision half, with no database in it.
 *
 * A PIN is four digits, which is ten thousand possibilities. bcrypt at cost
 * 10 is sound, but it only buys time per guess - a script pointed at a known
 * director's phone number walks the whole keyspace in minutes if nothing
 * counts the attempts. This is what counts them.
 *
 * Two scopes, for two different attacks:
 *
 * Per phone catches the real one - hammering a single account. The ladder is
 * deliberately shallow at the start, because a writer fat-fingering a PIN on
 * a phone mid-sale must not lose their afternoon: four wrong tries cost
 * nothing, the fifth costs a minute. By the tenth it is an hour, and a full
 * walk of the keyspace would take years.
 *
 * Per IP catches a scanner working across many accounts. Its threshold is
 * much higher and its lock much shorter, because Ghanaian mobile networks put
 * many subscribers behind one carrier-grade NAT address: a whole town can
 * share an IP, so a tight per-IP rule would lock out real writers who never
 * typed a wrong digit. The per-phone rule is the real defence; this one only
 * blunts broad scanning. A successful login clears the address, so an IP
 * carrying genuine traffic recovers on its own.
 *
 * Counters live in Postgres, not in memory. This API runs as a Vercel
 * serverless function: instances come and go and do not share memory, so an
 * in-process counter would reset on every cold start and an attacker spraying
 * requests would meet a fresh allowance each time.
 */

/** Wrong tries that cost nothing, per phone. The fifth starts the ladder. */
export const PHONE_LOCK_AFTER = 5;

/** Lock length in seconds, from the PHONE_LOCK_AFTER-th failure upward. */
export const PHONE_LADDER_SECONDS = [60, 120, 300, 900, 3600] as const;

/** Failures from one address before it is held off. High, because of CGNAT. */
export const IP_LOCK_AFTER = 30;

/** One step only, and a short one, for the same reason. */
export const IP_LADDER_SECONDS = [300] as const;

/**
 * Quiet time after which a counter is treated as spent.
 *
 * A day, not an hour. An hour looks friendlier but hands an attacker a way
 * around the ladder: wait it out and collect four free guesses every hour,
 * which walks the whole keyspace in about three months. At a day the patient
 * route is worse than simply pushing through the ladder, so the ladder is
 * what binds. It costs real users almost nothing, because any successful
 * sign-in clears the counter outright - only someone who keeps failing, and
 * never succeeds, carries anything over.
 */
export const ATTEMPT_WINDOW_SECONDS = 86400;

export interface AttemptRow {
  failedCount: number;
  lastFailedAt: Date;
}

export interface ThrottleDecision {
  allowed: boolean;
  /** Seconds the caller must wait. Zero when allowed. */
  retryAfterSeconds: number;
}

const ALLOWED: ThrottleDecision = { allowed: true, retryAfterSeconds: 0 };

/**
 * How long a lock lasts at this many failures, or 0 for no lock.
 *
 * Past the end of the ladder the last step repeats rather than growing, so
 * an account can never be locked out permanently by someone else's guessing.
 */
export function lockSeconds(
  failedCount: number,
  lockAfter: number,
  ladder: readonly number[],
): number {
  if (failedCount < lockAfter) return 0;
  const step = Math.min(failedCount - lockAfter, ladder.length - 1);
  return ladder[step]!;
}

export function decide(
  row: AttemptRow | null | undefined,
  nowMs: number,
  lockAfter: number,
  ladder: readonly number[],
): ThrottleDecision {
  if (!row || row.failedCount <= 0) return ALLOWED;

  // Stale counters do not hold anyone. The next failure restarts the count.
  const sinceLast = nowMs - row.lastFailedAt.getTime();
  if (sinceLast >= ATTEMPT_WINDOW_SECONDS * 1000) return ALLOWED;

  const seconds = lockSeconds(row.failedCount, lockAfter, ladder);
  if (seconds === 0) return ALLOWED;

  const remainingMs = seconds * 1000 - sinceLast;
  if (remainingMs <= 0) return ALLOWED;

  return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}

export const decidePhone = (row: AttemptRow | null | undefined, nowMs: number) =>
  decide(row, nowMs, PHONE_LOCK_AFTER, PHONE_LADDER_SECONDS);

export const decideIp = (row: AttemptRow | null | undefined, nowMs: number) =>
  decide(row, nowMs, IP_LOCK_AFTER, IP_LADDER_SECONDS);

/**
 * The client address, as far as it can be trusted.
 *
 * Vercel sets x-real-ip from the connection it terminated, so it is preferred
 * over x-forwarded-for, which a client can prepend entries to. This is why
 * the per-IP rule is the secondary one: a determined attacker may be able to
 * influence it, and nothing about the per-phone rule depends on it.
 */
export function clientIp(headers: Record<string, unknown>, fallback?: string): string {
  const real = headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();

  const fwd = headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return fallback?.trim() || "unknown";
}
