import { db, agentsTable, paymentsTable, dailyCalculationsTable, writersTable, agentDebtReductionsTable, usersTable } from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import { dispatchSystemNotification } from "./notify";

export async function verifyLedgerAndEscalate(agentId: string, systemUserId?: string): Promise<boolean> {
  // 1. Get Agent
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1);

  if (!agent) return false;

  // 2. Get Writers
  const writers = await db
    .select()
    .from(writersTable)
    .where(eq(writersTable.agentId, agentId));
  const writerIds = writers.map((w) => w.id);

  // 3. Get all completed payments
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.agentId, agentId),
        eq(paymentsTable.status, "completed"),
        eq(paymentsTable.isVoided, false)
      )
    )
    .orderBy(asc(paymentsTable.createdAt));

  // 4. Get all calculations
  let calculations: any[] = [];
  if (writerIds.length > 0) {
    calculations = await db
      .select()
      .from(dailyCalculationsTable)
      .where(inArray(dailyCalculationsTable.writerId, writerIds))
      .orderBy(asc(dailyCalculationsTable.calculatedAt));
  }

  // 5. Get earliest reduction to find starting balance
  const [earliestReduction] = await db
    .select({ debtBefore: agentDebtReductionsTable.debtBefore })
    .from(agentDebtReductionsTable)
    .where(eq(agentDebtReductionsTable.agentId, agentId))
    .orderBy(asc(agentDebtReductionsTable.createdAt))
    .limit(1);

  const expectedBalance = earliestReduction ? parseFloat(earliestReduction.debtBefore) : 0;

  const events: Array<{
    createdAt: Date;
    amount: number;
  }> = [];

  calculations.forEach((c) => {
    events.push({
      createdAt: new Date(c.calculatedAt),
      amount: -parseFloat(c.writerBalance),
    });
  });

  payments.forEach((p) => {
    const amt = parseFloat(p.amount);
    const effect = p.transactionType === "pay_in" ? amt : -amt;
    events.push({
      createdAt: new Date(p.createdAt),
      amount: effect,
    });
  });

  // Sort events chronologically
  events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let balance = expectedBalance;
  events.forEach((e) => {
    balance += e.amount;
  });

  const storedBalance = parseFloat(agent.outstandingDebt);
  const discrepancy = Math.abs(balance - storedBalance);

  if (discrepancy > 0.01) {
    // Update agent status to flagged
    await db
      .update(agentsTable)
      .set({ status: "flagged" })
      .where(eq(agentsTable.id, agentId));

    // Find admin and director users
    const managers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(inArray(usersTable.role, ["administrator", "director"]));

    const managerIds = managers.map((m) => m.id);

    // Default system sender
    const senderId = systemUserId || (managerIds[0] || agent.userId);

    // Send notifications to managers
    await dispatchSystemNotification({
      sentBy: senderId,
      messageType: "alert",
      title: `Ledger Discrepancy Escalation — Agent ${agent.fullCode}`,
      body: `A ledger discrepancy of GH₵ ${discrepancy.toFixed(2)} was detected for agent ${agent.fullCode} (${agent.location || "Not Set"}). Expected: GH₵ ${balance.toFixed(2)}, Stored: GH₵ ${storedBalance.toFixed(2)}. Please audit recent entries.`,
      targetType: "agent",
      targetId: agentId,
      recipientUserIds: managerIds,
    });

    // Send warning to Agent
    await dispatchSystemNotification({
      sentBy: senderId,
      messageType: "alert",
      title: `Account Ledger Flagged`,
      body: `A balance discrepancy has been detected on your account. The platform administrator and director have been notified to review and resolve this conflict.`,
      targetType: "agent",
      targetId: agentId,
      recipientUserIds: [agent.userId],
    });

    return true;
  } else {
    // If no discrepancy and status was flagged, reset to active
    if (agent.status === "flagged") {
      await db
        .update(agentsTable)
        .set({ status: "active" })
        .where(eq(agentsTable.id, agentId));
    }
    return false;
  }
}
