import { ticketEventsTable } from "@workspace/db";

/**
 * Ticket history, and what it says about fraud.
 *
 * Every rule here is a statement about ORDER or MULTIPLICITY, because that is
 * what forgery and collusion actually look like in a lottery: a ticket that
 * was checked before it existed, a payout that landed before the draw, a
 * second claim on a ticket already settled. None of those is visible in a
 * ticket's current status - only in the sequence of rows that produced it.
 */

export type TicketEventType =
  | "sold"
  | "validated"
  | "settled_won"
  | "settled_lost"
  | "claim_approved"
  | "claim_rejected"
  | "paid"
  | "voided"
  | "cancelled";

export interface RecordEventInput {
  ticketId: string;
  eventType: TicketEventType;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  source?: "portal" | "admin" | "settlement" | "system";
  note?: string | null;
  occurredAt?: Date;
}

/** Minimal shape of a Drizzle handle - the db, or a transaction. */
interface Inserter {
  insert: (table: typeof ticketEventsTable) => {
    values: (values: Record<string, unknown>) => Promise<unknown>;
  };
}

/**
 * Append one event. Call inside the same transaction as the state change it
 * describes, so the ticket and its history can never disagree.
 */
export async function recordTicketEvent(exec: Inserter, event: RecordEventInput): Promise<void> {
  await exec.insert(ticketEventsTable).values({
    ticketId: event.ticketId,
    eventType: event.eventType,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    actorUserId: event.actorUserId ?? null,
    actorRole: event.actorRole ?? null,
    source: event.source ?? "system",
    note: event.note ?? null,
    ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
  });
}

/**
 * Append an event that must never break the thing it is recording. A ticket
 * lookup that fails because its audit row failed would be worse than a
 * missing audit row.
 */
export async function recordTicketEventSafe(
  exec: Inserter,
  event: RecordEventInput,
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    await recordTicketEvent(exec, event);
  } catch (err) {
    onError?.(err);
  }
}

// --------------------------------------------------------------------------
// Anomaly detection
// --------------------------------------------------------------------------

export type AnomalySeverity = "medium" | "high" | "critical";

export type AnomalyCode =
  | "duplicate_ticket_number"
  | "duplicate_bet"
  | "validated_before_sale"
  | "sold_after_close"
  | "paid_before_draw"
  | "repeat_claim_attempts"
  | "validated_after_payout";

export interface AuditTicket {
  id: string;
  ticketNumber: string;
  writerId: string;
  writerName?: string;
  gameId: string;
  betTypeId: string;
  numbers: string;
  stakeAmount: string;
  status: string;
  createdAt: string | Date;
  gameCloseAt: string | Date | null;
  drawProcessedAt: string | Date | null;
}

export interface AuditEvent {
  ticketId: string;
  eventType: TicketEventType;
  occurredAt: string | Date;
  actorRole?: string | null;
  source?: string | null;
}

export interface Anomaly {
  code: AnomalyCode;
  severity: AnomalySeverity;
  ticketId: string;
  ticketNumber: string;
  detail: string;
  at: string | null;
}

/**
 * Rows are written by different requests, sometimes on different connections,
 * so two events that logically happen together can land a moment apart. Only
 * a gap wider than this counts as an ordering problem.
 */
export const CLOCK_SKEW_MS = 2_000;

/** Two identical bets this close together are one bet entered twice. */
export const DUPLICATE_WINDOW_MS = 60_000;

const ms = (value: string | Date | null | undefined): number | null => {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

const iso = (value: string | Date | null | undefined): string | null => {
  const t = ms(value);
  return t === null ? null : new Date(t).toISOString();
};

const CLAIM_EVENTS: TicketEventType[] = ["claim_approved", "paid"];

export function detectTicketAnomalies(tickets: AuditTicket[], events: AuditEvent[]): Anomaly[] {
  const found: Anomaly[] = [];
  const eventsByTicket = new Map<string, AuditEvent[]>();
  for (const e of events) {
    const list = eventsByTicket.get(e.ticketId);
    if (list) list.push(e);
    else eventsByTicket.set(e.ticketId, [e]);
  }
  for (const list of eventsByTicket.values()) {
    list.sort((a, b) => (ms(a.occurredAt) ?? 0) - (ms(b.occurredAt) ?? 0));
  }

  // --- the same printed number on more than one ticket ---------------------
  // The column is unique, so this is a backstop against a bad restore or a
  // future change that drops the constraint, not an everyday occurrence.
  const byNumber = new Map<string, AuditTicket[]>();
  for (const t of tickets) {
    const list = byNumber.get(t.ticketNumber);
    if (list) list.push(t);
    else byNumber.set(t.ticketNumber, [t]);
  }
  for (const [number, group] of byNumber) {
    if (group.length < 2) continue;
    for (const t of group) {
      found.push({
        code: "duplicate_ticket_number",
        severity: "critical",
        ticketId: t.id,
        ticketNumber: t.ticketNumber,
        detail: `Ticket number ${number} appears on ${group.length} tickets.`,
        at: iso(t.createdAt),
      });
    }
  }

  // --- the same bet entered twice in quick succession ----------------------
  const byBet = new Map<string, AuditTicket[]>();
  for (const t of tickets) {
    const numbers = t.numbers
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .sort()
      .join("-");
    const key = `${t.writerId}|${t.gameId}|${t.betTypeId}|${numbers}|${Number(t.stakeAmount)}`;
    const list = byBet.get(key);
    if (list) list.push(t);
    else byBet.set(key, [t]);
  }
  for (const group of byBet.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0));
    for (let i = 1; i < sorted.length; i++) {
      const prev = ms(sorted[i - 1].createdAt);
      const curr = ms(sorted[i].createdAt);
      if (prev === null || curr === null) continue;
      const gap = curr - prev;
      if (gap <= DUPLICATE_WINDOW_MS) {
        found.push({
          code: "duplicate_bet",
          severity: "high",
          ticketId: sorted[i].id,
          ticketNumber: sorted[i].ticketNumber,
          detail: `Identical bet to ${sorted[i - 1].ticketNumber}, sold ${Math.round(gap / 1000)}s earlier by the same writer.`,
          at: iso(sorted[i].createdAt),
        });
      }
    }
  }

  // --- per-ticket ordering -------------------------------------------------
  for (const t of tickets) {
    const sold = ms(t.createdAt);
    const list = eventsByTicket.get(t.id) ?? [];

    // Anything that happened before the ticket was sold.
    for (const e of list) {
      if (e.eventType === "sold") continue;
      const at = ms(e.occurredAt);
      if (at === null || sold === null) continue;
      if (at < sold - CLOCK_SKEW_MS) {
        found.push({
          code: "validated_before_sale",
          severity: "critical",
          ticketId: t.id,
          ticketNumber: t.ticketNumber,
          detail: `${e.eventType.replace(/_/g, " ")} recorded ${Math.round((sold - at) / 1000)}s before the ticket was sold.`,
          at: iso(e.occurredAt),
        });
      }
    }

    // Sold after betting closed.
    const closeAt = ms(t.gameCloseAt);
    if (sold !== null && closeAt !== null && sold > closeAt + CLOCK_SKEW_MS) {
      found.push({
        code: "sold_after_close",
        severity: "high",
        ticketId: t.id,
        ticketNumber: t.ticketNumber,
        detail: `Sold ${Math.round((sold - closeAt) / 1000)}s after betting closed on this game.`,
        at: iso(t.createdAt),
      });
    }

    // Paid before the draw was processed.
    const drawAt = ms(t.drawProcessedAt);
    const paid = list.find((e) => e.eventType === "paid");
    const paidAt = paid ? ms(paid.occurredAt) : null;
    if (paidAt !== null && drawAt !== null && paidAt < drawAt - CLOCK_SKEW_MS) {
      found.push({
        code: "paid_before_draw",
        severity: "critical",
        ticketId: t.id,
        ticketNumber: t.ticketNumber,
        detail: `Paid ${Math.round((drawAt - paidAt) / 1000)}s before the draw was processed.`,
        at: iso(paid!.occurredAt),
      });
    }

    // More than one claim run through on a single ticket.
    const claims = list.filter((e) => CLAIM_EVENTS.includes(e.eventType));
    const paidCount = claims.filter((e) => e.eventType === "paid").length;
    if (paidCount > 1) {
      found.push({
        code: "repeat_claim_attempts",
        severity: "critical",
        ticketId: t.id,
        ticketNumber: t.ticketNumber,
        detail: `Paid ${paidCount} times on one ticket.`,
        at: iso(claims[claims.length - 1]?.occurredAt),
      });
    } else if (claims.filter((e) => e.eventType === "claim_approved").length > 1) {
      found.push({
        code: "repeat_claim_attempts",
        severity: "high",
        ticketId: t.id,
        ticketNumber: t.ticketNumber,
        detail: `Claim approved ${claims.filter((e) => e.eventType === "claim_approved").length} times on one ticket.`,
        at: iso(claims[claims.length - 1]?.occurredAt),
      });
    }

    // Still being checked after it was paid - someone trying a spent ticket.
    if (paidAt !== null) {
      const after = list.filter(
        (e) => e.eventType === "validated" && (ms(e.occurredAt) ?? 0) > paidAt + CLOCK_SKEW_MS,
      );
      if (after.length >= 2) {
        found.push({
          code: "validated_after_payout",
          severity: "medium",
          ticketId: t.id,
          ticketNumber: t.ticketNumber,
          detail: `Checked ${after.length} times after it was already paid.`,
          at: iso(after[after.length - 1].occurredAt),
        });
      }
    }
  }

  const rank: Record<AnomalySeverity, number> = { critical: 0, high: 1, medium: 2 };
  return found.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (ms(b.at) ?? 0) - (ms(a.at) ?? 0),
  );
}
