import { randomBytes } from "node:crypto";

/**
 * The one place the token signing secret is read.
 *
 * This used to be `process.env["SESSION_SECRET"] ?? "dev-secret-change-in-prod"`
 * written out in four files. Nothing failed at boot when the variable was
 * missing, so a deploy that lost it would keep serving happily while signing
 * every token with a string published in the repository - and anyone who read
 * that string could mint themselves a director session. The database module
 * has always thrown when DATABASE_URL is absent; this applies the same rule to
 * the secret that guards every session.
 *
 * Development still needs to work without anyone exporting a variable, so an
 * unset secret there is generated fresh per boot: unguessable, never committed,
 * and it invalidates yesterday's tokens on restart, which is no loss locally.
 * That branch requires NODE_ENV to say "development" explicitly, so anything
 * else - production, a bare `node dist/index.mjs`, an unset NODE_ENV - fails
 * closed rather than quietly inventing a key.
 */
function resolveJwtSecret(): string {
  const fromEnv = process.env["SESSION_SECRET"]?.trim();

  if (fromEnv) {
    // Not fatal: refusing to boot over a short secret would take the company
    // offline for a value only the operator can see and change.
    if (fromEnv.length < 32) {
      console.warn(
        "[SECURITY] SESSION_SECRET is shorter than 32 characters. Replace it with a long random value.",
      );
    }
    return fromEnv;
  }

  if (process.env["NODE_ENV"] === "development") {
    console.warn(
      "[SECURITY] SESSION_SECRET is not set. Using a random development secret - every restart signs everyone out.",
    );
    return randomBytes(32).toString("hex");
  }

  throw new Error(
    "SESSION_SECRET must be set. Refusing to start: without it every session token " +
      "would be signed with a predictable key and anyone could forge an administrator login.",
  );
}

export const JWT_SECRET: string = resolveJwtSecret();
