import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_wtgZicly61Fa@ep-bold-heart-abagp4kx-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
});

async function main() {
  await client.connect();
  console.log("Connected to database.");

  console.log("\n=== GAMES ===");
  const gamesRes = await client.query("SELECT id, name, status, go_live_at, close_at, event_number FROM games ORDER BY go_live_at DESC LIMIT 10");
  console.table(gamesRes.rows);

  console.log("\n=== DAILY CALCULATIONS (GROUP BY GAME_ID) ===");
  const calcsRes = await client.query("SELECT game_id, COUNT(*) as count FROM daily_calculations GROUP BY game_id");
  console.table(calcsRes.rows);

  console.log("\n=== DAILY CALCULATIONS SAMPLES ===");
  const sampleRes = await client.query("SELECT id, writer_id, game_id, calc_date, gross_sales, wins_amount, writer_balance FROM daily_calculations LIMIT 5");
  console.table(sampleRes.rows);

  await client.end();
}

main().catch(console.error);
