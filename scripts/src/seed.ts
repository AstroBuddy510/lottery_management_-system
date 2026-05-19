import bcrypt from "bcryptjs";
import { db, usersTable, systemSettingsTable, cashierTimeWindowsTable, agentsTable, writersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  const directorPhone = "8000001";
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, directorPhone))
    .limit(1);

  if (!existing) {
    const [director] = await db
      .insert(usersTable)
      .values({
        fullName: "System Director",
        phone: "8000001",
        pinHash: await bcrypt.hash("0001", 10),
        role: "director",
      })
      .returning({ id: usersTable.id, phone: usersTable.phone });
    console.log(`Created director: phone=8000001  PIN=0001`);

    await db.insert(usersTable).values({
      fullName: "Head Administrator",
      phone: "8000002",
      pinHash: await bcrypt.hash("0002", 10),
      role: "administrator",
    });
    console.log(`Created administrator: phone=8000002  PIN=0002`);

    await db.insert(usersTable).values({
      fullName: "Maria Cashier",
      phone: "8000003",
      pinHash: await bcrypt.hash("0003", 10),
      role: "cashier",
    });
    console.log(`Created cashier: phone=8000003  PIN=0003`);

    await db.insert(usersTable).values({
      fullName: "Juan Gross Entry",
      phone: "8000004",
      pinHash: await bcrypt.hash("0004", 10),
      role: "gross_entry",
    });
    console.log(`Created gross_entry: phone=8000004  PIN=0004`);

    await db.insert(usersTable).values({
      fullName: "Ana Wins Entry",
      phone: "8000005",
      pinHash: await bcrypt.hash("0005", 10),
      role: "wins_entry",
    });
    console.log(`Created wins_entry: phone=8000005  PIN=0005`);

    const [agentUser] = await db
      .insert(usersTable)
      .values({
        fullName: "Pedro Agent",
        phone: "8000006",
        pinHash: await bcrypt.hash("0006", 10),
        role: "agent",
      })
      .returning({ id: usersTable.id });

    console.log(`Created agent: phone=8000006  PIN=0006`);

    const [settings] = await db
      .insert(systemSettingsTable)
      .values({
        commissionPct: "0.0500",
        reservePct: "0.0300",
        effectiveDate: "2026-01-01",
        updatedBy: director!.id,
      })
      .returning({ id: systemSettingsTable.id });
    console.log("Created system settings:", settings);

    await db.insert(cashierTimeWindowsTable).values([
      { dayOfWeek: null, windowOpen: "08:00:00", windowClose: "20:00:00", isActive: true },
    ]);
    console.log("Created default time window: 08:00-20:00 (all days)");

    const [agentRecord] = await db
      .insert(agentsTable)
      .values({ userId: agentUser!.id, agentCode: "PA", fullCode: "VS-PA" })
      .returning();
    console.log("Created agent record:", agentRecord!.fullCode);

    await db.insert(writersTable).values([
      { agentId: agentRecord!.id, writerCode: "CK01", fullCode: "VS-PA-CK01", fullName: "Carlos" },
      { agentId: agentRecord!.id, writerCode: "LM02", fullCode: "VS-PA-LM02", fullName: "Luz" },
    ]);
    console.log("Created 2 writers for VS-PA");

    console.log("\n=== TEST CREDENTIALS ===");
    console.log("Phone    | Role          | PIN");
    console.log("---------|---------------|----");
    console.log("8000001  | director      | 0001");
    console.log("8000002  | administrator | 0002");
    console.log("8000003  | cashier       | 0003");
    console.log("8000004  | gross_entry   | 0004");
    console.log("8000005  | wins_entry    | 0005");
    console.log("8000006  | agent         | 0006");
  } else {
    console.log("Seed data already exists, skipping.");
  }

  console.log("\nSeed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
