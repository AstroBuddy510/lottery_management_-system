import { sql } from "drizzle-orm";

/**
 * Every movement of a writer's float, as one statement.
 *
 * The old shape was SELECT the balance, work out the new one in JavaScript,
 * UPDATE SET balance = <that number>. Postgres runs at READ COMMITTED, which
 * does not protect that: two sales from the same writer both read 100, both
 * write 60, and the writer has sold GHS 80 of tickets against GHS 40 of
 * float. The second write does not fail - it blocks, then overwrites. The
 * money is simply gone, and the balance_after on both audit rows records a
 * figure that was never true.
 *
 * Doing the arithmetic inside the UPDATE removes the window entirely: the row
 * is locked for the instant it takes, and the second statement reads the
 * first one's result. The guard rides in the WHERE clause, so "can they
 * afford it" and "take it" are the same indivisible act rather than two steps
 * with a gap between them.
 *
 * It also keeps the money in numeric. parseFloat on a decimal column is how
 * balances end up at 19.999999999999996.
 */

type Exec = { execute: (q: unknown) => Promise<unknown> };

function rowsOf(result: unknown): Record<string, unknown>[] {
  // node-postgres returns { rows }, some drivers return the array itself.
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const r = (result as { rows?: unknown })?.rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

const money = (n: number) => n.toFixed(2);

/**
 * Take `amount` off a writer's float.
 *
 * Returns the new balance, or null when the float will not cover it - which
 * is the same answer as "the wallet does not exist", deliberately: both mean
 * this writer cannot pay, and the caller has one case to handle.
 */
export async function debitWallet(
  exec: Exec,
  writerId: string,
  amount: number,
): Promise<string | null> {
  const result = await exec.execute(sql`
    UPDATE writer_token_wallets
       SET balance     = balance - ${money(amount)}::numeric,
           total_spent = total_spent + ${money(amount)}::numeric,
           updated_at  = now()
     WHERE writer_id = ${writerId}
       AND balance >= ${money(amount)}::numeric
    RETURNING balance
  `);
  const rows = rowsOf(result);
  return rows.length ? String(rows[0]!["balance"]) : null;
}

/**
 * Put `amount` onto a writer's float, creating the wallet if this is their
 * first credit. `countAsPurchase` keeps total_purchased meaning what it says:
 * units bought, not winnings paid in.
 */
export async function creditWallet(
  exec: Exec,
  writerId: string,
  amount: number,
  countAsPurchase: boolean,
): Promise<string> {
  const purchased = countAsPurchase ? money(amount) : "0";
  const result = await exec.execute(sql`
    INSERT INTO writer_token_wallets (writer_id, balance, total_purchased)
    VALUES (${writerId}, ${money(amount)}::numeric, ${purchased}::numeric)
    ON CONFLICT (writer_id) DO UPDATE
       SET balance         = writer_token_wallets.balance + EXCLUDED.balance,
           total_purchased = writer_token_wallets.total_purchased
                             + ${purchased}::numeric,
           updated_at      = now()
    RETURNING balance
  `);
  return String(rowsOf(result)[0]!["balance"]);
}

/**
 * An administrator's manual correction, which may be a deduction.
 *
 * Returns null when a deduction would take the float below zero. Without this
 * the CHECK constraint would reject the statement and the administrator would
 * see a database error instead of being told the writer does not hold that
 * much.
 */
export async function adjustWallet(
  exec: Exec,
  writerId: string,
  amount: number,
): Promise<string | null> {
  // A deduction never creates a wallet. Splitting the two cases matters: the
  // INSERT branch of an upsert is not covered by the ON CONFLICT guard, so a
  // deduction against a writer with no wallet would insert a negative balance
  // and hit the CHECK as a raw database error rather than a clean refusal.
  if (amount < 0) {
    const result = await exec.execute(sql`
      UPDATE writer_token_wallets
         SET balance    = balance + ${money(amount)}::numeric,
             updated_at = now()
       WHERE writer_id = ${writerId}
         AND balance + ${money(amount)}::numeric >= 0
      RETURNING balance
    `);
    const rows = rowsOf(result);
    return rows.length ? String(rows[0]!["balance"]) : null;
  }

  return creditWallet(exec, writerId, amount, true);
}
