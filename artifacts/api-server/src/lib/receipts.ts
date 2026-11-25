import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

type Exec = Pick<typeof db, "execute">;

/**
 * The next payment receipt number, REC-000054 style.
 *
 * Drawn from the database sequence payment_receipt_seq (migration 0027), so
 * two cashiers approving at the same moment can never be handed the same
 * number - the old "highest receipt + 1" read could, and then one of them
 * failed on the unique constraint. Every completed payment must carry one:
 * the database refuses a completed payment without a receipt number.
 */
export async function nextReceiptNumber(exec: Exec = db): Promise<string> {
  const r = await exec.execute(sql`SELECT 'REC-' || lpad(nextval('payment_receipt_seq')::text, 6, '0') AS receipt`);
  const receipt = (r.rows[0] as { receipt?: string } | undefined)?.receipt;
  if (!receipt || !/^REC-\d{6,}$/.test(receipt)) throw new Error("Could not allocate a receipt number");
  return receipt;
}
