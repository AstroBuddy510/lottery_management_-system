import { sql } from "drizzle-orm";
import { masterWalletLedgerTable } from "@workspace/db";

/**
 * The Master Wallet's four movements.
 *
 * Every function here takes the caller's transaction and does two things
 * inside it: one UPDATE of the single wallet row, and one ledger row carrying
 * the balances that UPDATE left behind. Nothing else in the codebase writes to
 * either table, so the wallet and its ledger cannot disagree - they are only
 * ever changed together, and commit or roll back together with whatever claim
 * or approval caused them.
 *
 * The arithmetic is done by Postgres on numeric(14,2), never in JavaScript.
 * Money that has been through a float has already been rounded by something
 * that was not asked to.
 *
 * Concurrency needs no explicit lock: the UPDATE takes the wallet's row lock
 * and holds it until the transaction ends, so two claims arriving together
 * are served one after the other and the second sees what the first left.
 */

/** A Drizzle transaction, loosely - the two operations this file performs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export interface Actor {
  userId: string | null;
  role: string | null;
}

export interface WalletBalances {
  available: string;
  held: string;
}

/** Strictly a positive amount with at most two decimals, as a string. */
export function parseAmount(input: unknown): string | null {
  const text = typeof input === "number" ? String(input) : typeof input === "string" ? input.trim() : "";
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(text)) return null;
  if (Number(text) <= 0) return null;
  return Number(text).toFixed(2);
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/** The wallet row exists from migration 0019; this covers a database built by push alone. */
async function ensureWallet(tx: Tx): Promise<void> {
  await tx.execute(sql`insert into master_wallet (id) values (1) on conflict (id) do nothing`);
}

export async function readWallet(tx: Tx): Promise<WalletBalances> {
  await ensureWallet(tx);
  const rows = rowsOf(await tx.execute(sql`select available::text, held::text from master_wallet where id = 1`));
  return {
    available: String(rows[0]?.["available"] ?? "0.00"),
    held: String(rows[0]?.["held"] ?? "0.00"),
  };
}

async function writeLedger(
  tx: Tx,
  entry: {
    entryType: "fund" | "withdraw" | "hold" | "release" | "disburse";
    amount: string;
    after: WalletBalances;
    payoutRequestId?: string | null;
    actor: Actor;
    reference?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await tx.insert(masterWalletLedgerTable).values({
    entryType: entry.entryType,
    amount: entry.amount,
    availableAfter: entry.after.available,
    heldAfter: entry.after.held,
    payoutRequestId: entry.payoutRequestId ?? null,
    actorUserId: entry.actor.userId,
    actorRole: entry.actor.role,
    reference: entry.reference ?? null,
    note: entry.note ?? null,
  });
}

/** Director adds money. available + */
export async function fundWallet(
  tx: Tx,
  opts: { amount: string; actor: Actor; reference: string; note?: string | null },
): Promise<WalletBalances> {
  await ensureWallet(tx);
  const rows = rowsOf(
    await tx.execute(sql`
      update master_wallet
         set available = available + ${opts.amount}::numeric, updated_at = now()
       where id = 1
      returning available::text, held::text
    `),
  );
  const after = { available: String(rows[0]!["available"]), held: String(rows[0]!["held"]) };
  await writeLedger(tx, {
    entryType: "fund",
    amount: opts.amount,
    after,
    actor: opts.actor,
    reference: opts.reference,
    note: opts.note,
  });
  return after;
}

/**
 * Director takes money back out. available -
 *
 * Only from what is unpromised: the WHERE refuses anything larger than
 * `available`, so a claim that has been verified keeps its money whatever
 * happens here. Returns null, having changed nothing, when there is not enough.
 */
export async function withdrawFromWallet(
  tx: Tx,
  opts: { amount: string; actor: Actor; reference?: string | null; note: string },
): Promise<WalletBalances | null> {
  await ensureWallet(tx);
  const rows = rowsOf(
    await tx.execute(sql`
      update master_wallet
         set available = available - ${opts.amount}::numeric, updated_at = now()
       where id = 1
         and available >= ${opts.amount}::numeric
      returning available::text, held::text
    `),
  );
  if (rows.length === 0) return null;
  const after = { available: String(rows[0]!["available"]), held: String(rows[0]!["held"]) };
  await writeLedger(tx, {
    entryType: "withdraw",
    amount: opts.amount,
    after,
    actor: opts.actor,
    reference: opts.reference ?? null,
    note: opts.note,
  });
  return after;
}

/**
 * Reserve a verified claim's payout. available -, held +
 *
 * Returns false, having changed nothing, when the wallet cannot cover it. The
 * condition is in the UPDATE's WHERE rather than checked beforehand, so there
 * is no moment between looking and taking in which another claim could have
 * the same money.
 */
export async function holdForPayout(
  tx: Tx,
  opts: { payoutRequestId: string; amount: string; actor: Actor; note?: string | null },
): Promise<boolean> {
  await ensureWallet(tx);
  const rows = rowsOf(
    await tx.execute(sql`
      update master_wallet
         set available = available - ${opts.amount}::numeric,
             held      = held      + ${opts.amount}::numeric,
             updated_at = now()
       where id = 1
         and available >= ${opts.amount}::numeric
      returning available::text, held::text
    `),
  );
  if (rows.length === 0) return false;
  await writeLedger(tx, {
    entryType: "hold",
    amount: opts.amount,
    after: { available: String(rows[0]!["available"]), held: String(rows[0]!["held"]) },
    payoutRequestId: opts.payoutRequestId,
    actor: opts.actor,
    note: opts.note,
  });
  return true;
}

/** Let a held payout go - the claim was rejected or withheld. held -, available + */
export async function releaseHold(
  tx: Tx,
  opts: { payoutRequestId: string; amount: string; actor: Actor; note?: string | null },
): Promise<void> {
  const rows = rowsOf(
    await tx.execute(sql`
      update master_wallet
         set held      = held      - ${opts.amount}::numeric,
             available = available + ${opts.amount}::numeric,
             updated_at = now()
       where id = 1
         and held >= ${opts.amount}::numeric
      returning available::text, held::text
    `),
  );
  if (rows.length === 0) {
    // The caller believed this request held money and the wallet says nothing
    // that size is held. That is a broken invariant, not a business outcome.
    throw new Error(`Master Wallet has less than ${opts.amount} held; refusing to release`);
  }
  await writeLedger(tx, {
    entryType: "release",
    amount: opts.amount,
    after: { available: String(rows[0]!["available"]), held: String(rows[0]!["held"]) },
    payoutRequestId: opts.payoutRequestId,
    actor: opts.actor,
    note: opts.note,
  });
}

/**
 * The money has left: Paystack confirmed the transfer. held -
 *
 * At most once per payout request - the unique index on the ledger makes a
 * second disbursement row a constraint violation, which rolls back the
 * transaction that attempted it.
 */
export async function disburse(
  tx: Tx,
  opts: { payoutRequestId: string; amount: string; actor: Actor; reference: string; note?: string | null },
): Promise<void> {
  const rows = rowsOf(
    await tx.execute(sql`
      update master_wallet
         set held = held - ${opts.amount}::numeric, updated_at = now()
       where id = 1
         and held >= ${opts.amount}::numeric
      returning available::text, held::text
    `),
  );
  if (rows.length === 0) {
    throw new Error(`Master Wallet has less than ${opts.amount} held; refusing to disburse`);
  }
  await writeLedger(tx, {
    entryType: "disburse",
    amount: opts.amount,
    after: { available: String(rows[0]!["available"]), held: String(rows[0]!["held"]) },
    payoutRequestId: opts.payoutRequestId,
    actor: opts.actor,
    reference: opts.reference,
    note: opts.note,
  });
}
