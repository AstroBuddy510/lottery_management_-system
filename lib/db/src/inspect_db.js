import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_wtgZicly61Fa@ep-bold-heart-abagp4kx-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
});

async function main() {
  await client.connect();
  console.log("Connected to database.");

  const tables = ["booklet_batches", "booklet_allocations", "padlocks", "padlock_assignments"];
  for (const t of tables) {
    try {
      const res = await client.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`Table ${t}: exists, row count = ${res.rows[0].count}`);
    } catch (e) {
      console.error(`Error querying ${t}:`, e.message);
    }
  }

  // Also check column list of one of the tables
  try {
    const colRes = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'padlocks'
    `);
    console.log("\n=== padlocks columns ===");
    console.table(colRes.rows);
  } catch (e) {
    console.error(e);
  }

  // Also check booklets_count column on gross_entries
  try {
    const colRes = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'gross_entries' AND column_name = 'booklets_count'
    `);
    console.log("\n=== gross_entries booklets_count column ===");
    console.table(colRes.rows);
  } catch (e) {
    console.error(e);
  }

  await client.end();
}

main().catch(console.error);
