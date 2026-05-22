import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function run() {
  console.log("Setting up admin login details...");

  const phone = "0240546338";
  const pin = "1010";
  const pinHash = await bcrypt.hash(pin, 10);

  // Check if user already exists with this phone
  const [existingUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);

  if (existingUser) {
    console.log(`User with phone ${phone} already exists. Updating role to 'administrator' and resetting PIN to ${pin}...`);
    await db
      .update(usersTable)
      .set({
        role: "administrator",
        pinHash: pinHash,
        fullName: "Head Administrator"
      })
      .where(eq(usersTable.id, existingUser.id));
    console.log("Admin details updated successfully!");
  } else {
    console.log(`Creating new administrator account for phone ${phone} with PIN ${pin}...`);
    await db.insert(usersTable).values({
      fullName: "Head Administrator",
      phone: phone,
      pinHash: pinHash,
      role: "administrator",
    });
    console.log("Admin account created successfully!");
  }

  process.exit(0);
}

run().catch((err) => {
  console.error("Failed to set up admin login:", err);
  process.exit(1);
});
