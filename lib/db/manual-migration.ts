import { db } from "./src";
import { sql } from "drizzle-orm";

async function main() {
  try {
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
          -- Wait, user_role enum is already there, we just need to add 'writer'
          ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'writer';
        END IF;
      END $$;
    `);
    
    await db.execute(sql`
      ALTER TABLE "writers" ADD COLUMN IF NOT EXISTS "phone" varchar(20) UNIQUE;
      ALTER TABLE "writers" ADD COLUMN IF NOT EXISTS "pin_hash" text;
      ALTER TABLE "writers" ADD COLUMN IF NOT EXISTS "id_type" varchar(30);
      ALTER TABLE "writers" ADD COLUMN IF NOT EXISTS "id_number" varchar(50);
      ALTER TABLE "writers" ADD COLUMN IF NOT EXISTS "operation_model" varchar(10) NOT NULL DEFAULT 'postpaid';
      ALTER TABLE "writers" ADD COLUMN IF NOT EXISTS "registration_source" varchar(20) NOT NULL DEFAULT 'agent';
      ALTER TABLE "writers" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'approved';
      ALTER TABLE "writers" ADD COLUMN IF NOT EXISTS "approved_by" uuid REFERENCES "users"("id");
    `);

    console.log("Migration executed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

main();
