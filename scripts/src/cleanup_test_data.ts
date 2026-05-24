import {
  db,
  salesLogsTable,
  grossEntriesTable,
  winsEntriesTable,
  dailyCalculationsTable,
  paymentsTable,
  agentDebtReductionsTable,
  entryChangeRequestsTable,
  notificationReceiptsTable,
  notificationsTable,
  reserveAllocationsTable,
  reserveFundTable,
  agentReserveReceiptsTable,
  salaryPaymentsTable,
  salaryWalletTransactionsTable,
  salaryWalletTable,
  companyExpensesTable,
  gamesTable,
  agentsTable
} from "@workspace/db";

async function cleanup() {
  console.log("Starting test transaction database cleanup...");

  try {
    // 1. Delete notification receipts first, then notifications (foreign key dependency)
    console.log("Deleting notifications...");
    await db.delete(notificationReceiptsTable);
    await db.delete(notificationsTable);

    // 2. Delete entry change requests
    console.log("Deleting entry change requests...");
    await db.delete(entryChangeRequestsTable);

    // 3. Delete gross & wins entries
    console.log("Deleting gross and wins entries...");
    await db.delete(grossEntriesTable);
    await db.delete(winsEntriesTable);

    // 4. Delete sales logs
    console.log("Deleting sales logs...");
    await db.delete(salesLogsTable);

    // 5. Delete daily calculations
    console.log("Deleting daily calculations...");
    await db.delete(dailyCalculationsTable);

    // 6. Delete debt reductions & payments
    console.log("Deleting debt reductions and payments...");
    await db.delete(agentDebtReductionsTable);
    await db.delete(paymentsTable);

    // 7. Delete reserve allocations & receipts
    console.log("Deleting reserve allocations and receipts...");
    await db.delete(reserveAllocationsTable);
    await db.delete(agentReserveReceiptsTable);
    await db.delete(reserveFundTable);

    // 8. Delete salary payments & transactions
    console.log("Deleting salary payments and wallet transactions...");
    await db.delete(salaryPaymentsTable);
    await db.delete(salaryWalletTransactionsTable);
    
    // Reset salary wallet
    console.log("Resetting salary wallet...");
    await db.update(salaryWalletTable).set({
      balance: "0",
      totalFunded: "0",
      totalDisbursed: "0"
    });

    // 9. Delete company expenses
    console.log("Deleting company expenses...");
    await db.delete(companyExpensesTable);

    // 10. Delete games
    console.log("Deleting games...");
    await db.delete(gamesTable);

    // 11. Reset agents outstanding debt to 0
    console.log("Resetting agents outstanding debt...");
    await db.update(agentsTable).set({
      outstandingDebt: "0.00",
      debtSince: null
    });

    console.log("Cleanup successfully completed! Ready for first testing.");
    process.exit(0);
  } catch (error) {
    console.error("Cleanup failed:", error);
    process.exit(1);
  }
}

cleanup();
