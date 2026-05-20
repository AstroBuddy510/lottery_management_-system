import { pgTable, uuid, date, numeric, timestamp } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const agentDebtReductionsTable = pgTable("agent_debt_reductions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
  calcDate: date("calc_date").notNull(),
  netGrossAmount: numeric("net_gross_amount", { precision: 12, scale: 2 }).notNull(),
  reductionAmount: numeric("reduction_amount", { precision: 12, scale: 2 }).notNull(),
  debtBefore: numeric("debt_before", { precision: 12, scale: 2 }).notNull(),
  debtAfter: numeric("debt_after", { precision: 12, scale: 2 }).notNull(),
  surplus: numeric("surplus", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentDebtReduction = typeof agentDebtReductionsTable.$inferSelect;
