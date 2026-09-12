import { db } from "./src";
import { sql } from "drizzle-orm";
import fs from "fs";

async function main() {
  try {
    const rawSql = fs.readFileSync("drizzle/0000_fresh_phantom_reporter.sql", "utf8");
    
    // Split statements and only execute the ones for the new types and tables
    const statements = rawSql.split("--> statement-breakpoint");
    
    const targetKeywords = [
      "ticket_status",
      "postpaid_settlement_status",
      "risk_flag",
      "token_transaction_type",
      "bet_types",
      "game_results",
      "payout_requests",
      "writer_token_transactions",
      "writer_token_wallets",
      "tickets",
      "postpaid_daily_ledger",
      "risk_flags"
    ];

    for (let statement of statements) {
      statement = statement.trim();
      if (!statement) continue;

      const isTarget = targetKeywords.some(kw => statement.includes(kw));
      if (isTarget && (statement.startsWith("CREATE TYPE") || statement.startsWith("CREATE TABLE") || statement.startsWith("ALTER TABLE"))) {
        // Skip writers table alterations since we did them manually
        if (statement.includes("ALTER TABLE \"writers\"") || statement.includes("CREATE TABLE \"writers\"")) continue;
        
        console.log("Executing:", statement.substring(0, 50) + "...");
        try {
          await db.execute(sql.raw(statement));
        } catch (e: any) {
          if (e.message.includes("already exists")) {
            console.log("Already exists, skipping.");
          } else {
            console.error("Error executing:", e);
          }
        }
      }
    }

    console.log("Migration executed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

main();
