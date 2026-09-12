/**
 * 58mm thermal receipt formatting.
 *
 * 58mm paper at Font A (12x24 dots) fits 32 characters per line on virtually
 * every ESC/POS printer, so the layout is built to a fixed 32-column grid.
 * The same text is what writers copy into an SMS, so it must stay readable
 * as plain text with no styling at all.
 */
export const RECEIPT_COLUMNS = 32;

/** How long a ticket can be presented for payment after the draw. */
export const TICKET_VALIDITY_DAYS = 15;

export function centre(text: string, width = RECEIPT_COLUMNS): string {
  const clipped = text.slice(0, width);
  const pad = Math.max(0, Math.floor((width - clipped.length) / 2));
  return " ".repeat(pad) + clipped;
}

export function rule(char = "-", width = RECEIPT_COLUMNS): string {
  return char.repeat(width);
}

/**
 * Label on the left, value right-aligned. When the pair cannot fit on one
 * line the value moves to its own right-aligned line rather than being
 * truncated - a cut-off stake amount on a betting slip is worse than a wrap.
 */
export function row(label: string, value: string, width = RECEIPT_COLUMNS): string {
  const gap = width - label.length - value.length;
  if (gap >= 1) return label + " ".repeat(gap) + value;
  return `${label}\n${value.padStart(width)}`;
}

export function wrap(text: string, width = RECEIPT_COLUMNS): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function money(value: string | number): string {
  return Number(value).toFixed(2);
}

function stamp(d: Date): string {
  // Fixed-width, unambiguous, and sorts correctly: DD/MM/YYYY-HH:MM:SS
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}-${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function dateOnly(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export interface ReceiptData {
  companyName: string;
  tagline?: string;
  ticketId: string;
  ticketNumber: string;
  terminalId: string;
  agentCode: string;
  writerCode: string;
  writerName: string;
  drawNumber: string;
  drawName: string;
  drawDate: Date;
  saleDate: Date;
  betTypeName: string;
  numbers: string;
  lines: number;
  unitPrice: string;
  totalStake: string;
  potentialPayout: string;
  status: string;
  validityDays: number;
}

/** The QR replaces the printed barcode. Kept compact - QR density matters. */
export function buildQrPayload(d: ReceiptData): string {
  return JSON.stringify({
    t: d.ticketId,
    n: d.ticketNumber,
    w: d.writerCode,
    a: d.agentCode,
    ts: d.saleDate.toISOString(),
  });
}

export function expiryDate(drawDate: Date, validityDays: number): Date {
  const d = new Date(drawDate);
  d.setDate(d.getDate() + validityDays);
  return d;
}

/**
 * The printable / SMS-able ticket body. Deliberately plain text so the same
 * string drives the thermal printer and an SMS to the staker.
 */
export function buildReceiptText(d: ReceiptData): string {
  const out: string[] = [];

  out.push(centre(d.companyName.toUpperCase()));
  if (d.tagline) out.push(centre(d.tagline));
  out.push("");
  out.push(centre(d.drawName));
  out.push(rule("="));

  out.push(row("Terminal", d.terminalId));
  out.push(row("Agent", d.agentCode));
  out.push(row("Writer", d.writerCode));
  out.push(row("Draw No", d.drawNumber));
  out.push(row("Draw Date", dateOnly(d.drawDate)));
  out.push(row("Sale Date", stamp(d.saleDate)));
  out.push(rule());

  out.push(d.betTypeName.toUpperCase());
  for (const line of wrap(d.numbers)) out.push(`  ${line}`);
  out.push("");

  out.push(row("No Of Line(s)", String(d.lines)));
  out.push(row("Unit Price(GHS)", money(d.unitPrice)));
  out.push(row("Amount(GHS)", money(d.totalStake)));
  out.push(rule());
  out.push(row("TOTAL STAKE(GHS)", money(d.totalStake)));
  out.push(row("Potential Win(GHS)", money(d.potentialPayout)));
  out.push(rule("="));

  out.push(row("Ticket Validity", `${d.validityDays} days`));
  out.push(row("Valid Until", dateOnly(expiryDate(d.drawDate, d.validityDays))));
  out.push(row("Status", d.status.toUpperCase()));
  out.push("");
  out.push(centre("TICKET ID"));
  out.push(centre(d.ticketNumber));
  out.push("");
  out.push(centre("Keep this ticket safe."));
  out.push(centre("It is required to claim."));

  return out.join("\n");
}

/** Shorter variant for SMS - same facts, fewer characters to send. */
export function buildSmsText(d: ReceiptData): string {
  return [
    `${d.companyName.toUpperCase()} - ${d.drawName}`,
    `Ticket: ${d.ticketNumber}`,
    `Draw ${d.drawNumber} on ${dateOnly(d.drawDate)}`,
    `${d.betTypeName}: ${d.numbers}`,
    `Lines: ${d.lines} @ GHS ${money(d.unitPrice)}`,
    `Stake: GHS ${money(d.totalStake)}`,
    `Potential win: GHS ${money(d.potentialPayout)}`,
    `Sold ${stamp(d.saleDate)} by ${d.writerCode}`,
    `Valid ${d.validityDays} days (until ${dateOnly(expiryDate(d.drawDate, d.validityDays))})`,
  ].join("\n");
}
