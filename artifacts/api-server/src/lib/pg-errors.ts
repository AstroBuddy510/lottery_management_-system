/**
 * Reading a Postgres error through Drizzle's wrapper.
 *
 * Drizzle raises a DrizzleQueryError and puts the driver's DatabaseError on
 * `cause`. The wrapper has no `code` and no `constraint`, and its message is
 * the SQL statement - which means the column list is in the message text. Any
 * code that sniffs the wrapper's message for a column name will match the
 * wrong column: an IMEI collision on a table that also has a serial_number
 * column reads as a serial_number collision, and the operator is told to
 * correct the one field that was fine.
 *
 * So: walk to the error that actually carries a SQLSTATE and read the
 * constraint name off that.
 */

/** SQLSTATE 23505 - unique_violation. */
const UNIQUE_VIOLATION = "23505";
/** SQLSTATE 23503 - foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = "23503";

interface PgErrorish {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
  cause?: unknown;
}

/**
 * The first error in the cause chain with a SQLSTATE, or null. Depth-capped so
 * a self-referential cause cannot spin.
 */
export function pgError(error: unknown): PgErrorish | null {
  let current = error as PgErrorish | undefined;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current.code === "string" && /^\d{5}$/.test(current.code)) return current;
    current = current.cause as PgErrorish | undefined;
  }
  return null;
}

/** The violated constraint's name when this is a unique violation, else null. */
export function uniqueViolation(error: unknown): string | null {
  const pg = pgError(error);
  if (!pg || pg.code !== UNIQUE_VIOLATION) return null;
  return pg.constraint ?? "";
}

/** The violated constraint's name when this is a foreign-key violation, else null. */
export function foreignKeyViolation(error: unknown): string | null {
  const pg = pgError(error);
  if (!pg || pg.code !== FOREIGN_KEY_VIOLATION) return null;
  return pg.constraint ?? "";
}
