import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_wtgZicly61Fa@ep-bold-heart-abagp4kx-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
});

async function main() {
  await client.connect();
  console.log("Connected to database.");

  // Get daily calculations where game_id is null, casting calc_date as text
  const calcsRes = await client.query("SELECT id, writer_id, calc_date::text FROM daily_calculations WHERE game_id IS NULL");
  console.log(`Found ${calcsRes.rows.length} calculations with NULL game_id.`);

  let updatedCount = 0;

  for (const row of calcsRes.rows) {
    const calcDateStr = row.calc_date; // This will be exact "YYYY-MM-DD"
    
    // Find game_id from gross_entries on this date for this writer
    const grossRes = await client.query(
      "SELECT game_id FROM gross_entries WHERE writer_id = $1 AND entry_date = $2 AND game_id IS NOT NULL LIMIT 1",
      [row.writer_id, calcDateStr]
    );

    let gameId = grossRes.rows[0]?.game_id;

    // If not found in gross_entries, check wins_entries
    if (!gameId) {
      const winsRes = await client.query(
        "SELECT game_id FROM wins_entries WHERE writer_id = $1 AND entry_date = $2 AND game_id IS NOT NULL LIMIT 1",
        [row.writer_id, calcDateStr]
      );
      gameId = winsRes.rows[0]?.game_id;
    }

    if (gameId) {
      await client.query(
        "UPDATE daily_calculations SET game_id = $1 WHERE id = $2",
        [gameId, row.id]
      );
      updatedCount++;
    } else {
      console.log(`Could not find game_id for calculation ${row.id} (writer: ${row.writer_id}, date: ${calcDateStr})`);
    }
  }

  console.log(`Successfully updated ${updatedCount} calculations.`);
  await client.end();
}

main().catch(console.error);
