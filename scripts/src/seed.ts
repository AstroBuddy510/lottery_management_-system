import bcrypt from "bcryptjs";
import { db, usersTable, systemSettingsTable, cashierTimeWindowsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  const directorEmail = "director@vs2000.com";
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, directorEmail))
    .limit(1);

  if (!existing) {
    const passwordHash = await bcrypt.hash("Admin1234!", 12);
    const [director] = await db
      .insert(usersTable)
      .values({
        fullName: "System Director",
        email: directorEmail,
        passwordHash,
        role: "director",
      })
      .returning({ id: usersTable.id, email: usersTable.email });
    console.log("Created director:", director);

    const [admin] = await db
      .insert(usersTable)
      .values({
        fullName: "Head Administrator",
        email: "admin@vs2000.com",
        passwordHash: await bcrypt.hash("Admin1234!", 12),
        role: "administrator",
      })
      .returning({ id: usersTable.id, email: usersTable.email });
    console.log("Created administrator:", admin);

    const [cashier] = await db
      .insert(usersTable)
      .values({
        fullName: "Maria Cashier",
        email: "cashier@vs2000.com",
        passwordHash: await bcrypt.hash("Admin1234!", 12),
        role: "cashier",
      })
      .returning({ id: usersTable.id, email: usersTable.email });
    console.log("Created cashier:", cashier);

    const [grossEntry] = await db
      .insert(usersTable)
      .values({
        fullName: "Juan Gross Entry",
        email: "gross@vs2000.com",
        passwordHash: await bcrypt.hash("Admin1234!", 12),
        role: "gross_entry",
      })
      .returning({ id: usersTable.id, email: usersTable.email });
    console.log("Created gross entry:", grossEntry);

    const [winsEntry] = await db
      .insert(usersTable)
      .values({
        fullName: "Ana Wins Entry",
        email: "wins@vs2000.com",
        passwordHash: await bcrypt.hash("Admin1234!", 12),
        role: "wins_entry",
      })
      .returning({ id: usersTable.id, email: usersTable.email });
    console.log("Created wins entry:", winsEntry);

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
      { dayOfWeek: null, windowOpen: "08:00:00", windowClose: "17:00:00", isActive: true },
    ]);
    console.log("Created default time window: 08:00-17:00 (all days)");
  } else {
    console.log("Seed data already exists, skipping.");
  }

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
