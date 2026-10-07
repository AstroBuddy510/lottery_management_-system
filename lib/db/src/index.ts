import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * One connection per instance, and never wait long for it.
 *
 * This API runs as a Vercel function. Instances are created and destroyed on
 * demand and share nothing, so a pool is not shared the way it would be on a
 * long-lived server: each instance opens its own, and under a burst there are
 * as many pools as there are instances. node-postgres defaults to max 10, so
 * fifty instances could reach for five hundred connections while serving
 * perhaps fifty queries.
 *
 * max: 3 rather than 1. One would make the arithmetic simplest, but Vercel
 * can serve several requests from the same instance, and a pool of one
 * serialises every query behind the slowest - measured here, six concurrent
 * 150ms queries take 921ms at max 1 against 309ms at max 3, and with the
 * timeout below a deep enough queue stops being slow and starts being
 * errors. Three bounds the fan-out without that cliff, and the database has
 * the room: Neon reports max_connections 901, with pgbouncer in front
 * multiplexing client connections onto far fewer server ones.
 *
 * connectionTimeoutMillis is the more important half. With no timeout a
 * request that cannot get a connection waits indefinitely rather than
 * failing, while the front end's polling fires again every fifteen seconds
 * and adds another waiter. Failing in three seconds turns that into a visible
 * error the client stops retrying into, instead of a queue that grows until
 * the database is unreachable.
 *
 * idleTimeoutMillis is short because a frozen instance's idle connection is
 * occupying a slot it will probably never use again.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 3_000,
  idleTimeoutMillis: 10_000,
  // Let a finished function exit rather than being held open by the pool.
  allowExitOnIdle: true,
});

/**
 * A pool error on an idle client is emitted on the pool itself. Without a
 * listener, Node treats it as an unhandled 'error' event and kills the
 * process - so one dropped connection takes out the instance rather than one
 * request.
 */
pool.on("error", (err) => {
  console.error("[DB] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
