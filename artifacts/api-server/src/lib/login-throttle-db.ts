import { db, authThrottleTable } from "@workspace/db";
import { sql, and, eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  ATTEMPT_WINDOW_SECONDS,
  decideIp,
  decidePhone,
  type AttemptRow,
  type ThrottleDecision,
} from "./login-throttle";

const ALLOWED: ThrottleDecision = { allowed: true, retryAfterSeconds: 0 };

/**
 * Throttling fails OPEN, deliberately.
 *
 * If this table is missing or unreachable - the code deployed ahead of its
 * migration, say - the choice is between letting sign-ins through unprotected
 * and locking every writer, agent and director out of the company at once.
 * The second is a worse outage than the attack this guards against, and a
 * far more likely one. So an error here lets the sign-in proceed and shouts
 * in the log, where the missing protection can be noticed and fixed.
 */
function failOpen(where: string, error: unknown): ThrottleDecision {
  logger.error(
    { err: error instanceof Error ? error.message : String(error) },
    `[THROTTLE] ${where} failed - sign-in allowed WITHOUT brute-force protection. Has 0012_auth_throttle.sql been run?`,
  );
  return ALLOWED;
}

async function readRows(phone: string, ip: string): Promise<Map<string, AttemptRow>> {
  const rows = await db
    .select()
    .from(authThrottleTable)
    .where(
      sql`(${authThrottleTable.scope} = 'phone' AND ${authThrottleTable.key} = ${phone})
          OR (${authThrottleTable.scope} = 'ip' AND ${authThrottleTable.key} = ${ip})`,
    );

  const out = new Map<string, AttemptRow>();
  for (const r of rows) {
    out.set(r.scope, { failedCount: r.failedCount, lastFailedAt: r.lastFailedAt });
  }
  return out;
}

/**
 * May this phone, from this address, attempt a sign-in right now?
 *
 * The phone verdict is checked first so the message a locked-out writer sees
 * is about their own account rather than their network.
 */
export async function checkLoginAllowed(
  phone: string,
  ip: string,
  nowMs = Date.now(),
): Promise<ThrottleDecision & { scope?: "phone" | "ip" }> {
  try {
    const rows = await readRows(phone, ip);

    const byPhone = decidePhone(rows.get("phone"), nowMs);
    if (!byPhone.allowed) return { ...byPhone, scope: "phone" };

    const byIp = decideIp(rows.get("ip"), nowMs);
    if (!byIp.allowed) return { ...byIp, scope: "ip" };

    return ALLOWED;
  } catch (e) {
    return failOpen("checkLoginAllowed", e);
  }
}

/**
 * Record a wrong PIN against both the account and the address.
 *
 * The increment happens inside the statement rather than as read-then-write,
 * because an attacker's requests arrive in parallel and two handlers that
 * each read 4 and each write 5 would let the ladder be outrun.
 */
export async function registerLoginFailure(phone: string, ip: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO auth_throttle (scope, key, failed_count, last_failed_at)
      VALUES ('phone', ${phone}, 1, now()), ('ip', ${ip}, 1, now())
      ON CONFLICT (scope, key) DO UPDATE SET
        failed_count = CASE
          WHEN auth_throttle.last_failed_at
               < now() - make_interval(secs => ${ATTEMPT_WINDOW_SECONDS})
          THEN 1
          ELSE auth_throttle.failed_count + 1
        END,
        last_failed_at = now()
    `);
  } catch (e) {
    logger.error(
      { err: e instanceof Error ? e.message : String(e) },
      "[THROTTLE] could not record a failed sign-in",
    );
  }
}

/**
 * A correct PIN clears both counters.
 *
 * Clearing the address matters as much as clearing the account: many writers
 * share one carrier-grade NAT address, so real traffic from that address has
 * to be able to undo the suspicion raised by someone else's typing.
 */
export async function registerLoginSuccess(phone: string, ip: string): Promise<void> {
  try {
    await db
      .delete(authThrottleTable)
      .where(
        sql`(${authThrottleTable.scope} = 'phone' AND ${authThrottleTable.key} = ${phone})
            OR (${authThrottleTable.scope} = 'ip' AND ${authThrottleTable.key} = ${ip})`,
      );
  } catch (e) {
    logger.error(
      { err: e instanceof Error ? e.message : String(e) },
      "[THROTTLE] could not clear sign-in counters",
    );
  }
}

/**
 * Drop the lock on one phone, used when a PIN is reissued.
 *
 * The address counter is left alone on purpose: reissuing a PIN says
 * something about this account, not about the network it was typed from.
 */
export async function clearLoginThrottle(phone: string): Promise<void> {
  try {
    await db
      .delete(authThrottleTable)
      .where(and(eq(authThrottleTable.scope, "phone"), eq(authThrottleTable.key, phone)));
  } catch (e) {
    logger.error(
      { err: e instanceof Error ? e.message : String(e) },
      "[THROTTLE] could not clear the lock after a PIN reset",
    );
  }
}
