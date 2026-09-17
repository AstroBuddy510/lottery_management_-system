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
  /** Set only on banker bets. Stored apart from `numbers`, printed with them. */
  bankerNumber?: number | null;
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
 * The centred masthead: registered name, then slogan.
 *
 * Sent to the client as its own slice of the receipt text so the screen and
 * the print window can set the name in bold and leave the slogan light,
 * without either of them having to guess which lines are the letterhead.
 *
 * Wrapped rather than clipped: the current slogan is exactly
 * RECEIPT_COLUMNS characters, so any future rewording would otherwise be
 * silently truncated mid-word.
 */
export function buildHeaderBlock(d: ReceiptData): { name: string; tagline: string; full: string } {
  const nameLines = wrap(d.companyName.toUpperCase()).map((l) => centre(l));
  const taglineLines = d.tagline ? wrap(d.tagline).map((l) => centre(l)) : [];
  const name = nameLines.join("\n");
  const tagline = taglineLines.join("\n");
  return { name, tagline, full: [...nameLines, ...taglineLines].join("\n") };
}

/**
 * The played numbers, exactly as they appear on the slip.
 *
 * Kept as its own function - and sent to the client alongside the receipt -
 * so the screen can find this block inside the finished text and mark up the
 * winners without having to guess which lines are numbers.
 *
 * The banker rides with them rather than in the rows above: it is part of the
 * bet, and a slip that leaves it off does not state what was staked.
 */
export function buildNumbersBlock(d: ReceiptData): string {
  const lines = wrap(d.numbers).map((line) => `  ${line}`);
  if (d.bankerNumber != null) lines.push(`  BANKER ${d.bankerNumber}`);
  return lines.join("\n");
}

/**
 * The printable / SMS-able ticket body. Deliberately plain text so the same
 * string drives the thermal printer and an SMS to the staker.
 */
export function buildReceiptText(d: ReceiptData): string {
  const out: string[] = [];

  out.push(buildHeaderBlock(d).full);
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
  out.push(buildNumbersBlock(d));
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

export interface SlipItem {
  betTypeName: string;
  numbers: string;
  bankerNumber?: number | null;
  lines: number;
  unitPrice: string;
  amount: string;
  ticketNumber: string;
}

export interface SlipData {
  companyName: string;
  tagline?: string;
  slipNumber: string;
  terminalId: string;
  agentCode: string;
  writerCode: string;
  drawNumber: string;
  drawName: string;
  drawDate: Date;
  saleDate: Date;
  items: SlipItem[];
  totalStake: string;
  totalPotentialPayout: string;
  validityDays: number;
}

/**
 * One itemised slip for several bets bought together.
 *
 * Each bet is printed as its own numbered item with its own lines and money,
 * because each one settles and pays on its own - the slip records that they
 * were paid for once, not that they win or lose together. Every item carries
 * its own ticket number, which is what a cashier needs when only one of them
 * comes in to be claimed.
 */
export function buildSlipText(d: SlipData): string {
  const out: string[] = [];

  out.push(buildHeaderBlock({ companyName: d.companyName, tagline: d.tagline } as ReceiptData).full);
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
  out.push(row(`${d.items.length} BET${d.items.length === 1 ? "" : "S"}`, "AMOUNT(GHS)"));
  out.push(rule());

  d.items.forEach((item, i) => {
    out.push(`${i + 1}. ${item.betTypeName.toUpperCase()}`);
    for (const line of wrap(item.numbers)) out.push(`   ${line}`);
    if (item.bankerNumber != null) out.push(`   BANKER ${item.bankerNumber}`);
    out.push(row(`   ${item.lines} x ${money(item.unitPrice)}`, money(item.amount)));
    // The claim reference for this bet alone.
    out.push(`   ${item.ticketNumber}`);
    if (i < d.items.length - 1) out.push("");
  });

  out.push(rule());
  out.push(row("TOTAL STAKE(GHS)", money(d.totalStake)));
  out.push(row("Max Win(GHS)", money(d.totalPotentialPayout)));
  out.push(rule("="));

  out.push(row("Ticket Validity", `${d.validityDays} days`));
  out.push(row("Valid Until", dateOnly(expiryDate(d.drawDate, d.validityDays))));
  out.push("");
  out.push(centre("SLIP NO"));
  out.push(centre(d.slipNumber));
  out.push("");
  out.push(centre("Keep this slip safe."));
  out.push(centre("It is required to claim."));

  return out.join("\n");
}

/** Short SMS for a multi-bet slip. */
export function buildSlipSmsText(d: SlipData): string {
  return [
    `${d.companyName.toUpperCase()} - ${d.drawName}`,
    `Slip: ${d.slipNumber}`,
    `Draw ${d.drawNumber} on ${dateOnly(d.drawDate)}`,
    ...d.items.map(
      (item, i) =>
        `${i + 1}. ${item.betTypeName}: ${item.numbers}${item.bankerNumber != null ? ` (banker ${item.bankerNumber})` : ""} - GHS ${money(item.amount)} [${item.ticketNumber}]`,
    ),
    `Total stake: GHS ${money(d.totalStake)}`,
    `Max win: GHS ${money(d.totalPotentialPayout)}`,
    `Sold ${stamp(d.saleDate)} by ${d.writerCode}`,
    `Valid ${d.validityDays} days (until ${dateOnly(expiryDate(d.drawDate, d.validityDays))})`,
  ].join("\n");
}

/** Shorter variant for SMS - same facts, fewer characters to send. */
export function buildSmsText(d: ReceiptData): string {
  return [
    `${d.companyName.toUpperCase()} - ${d.drawName}`,
    `Ticket: ${d.ticketNumber}`,
    `Draw ${d.drawNumber} on ${dateOnly(d.drawDate)}`,
    `${d.betTypeName}: ${d.numbers}${d.bankerNumber != null ? ` (banker ${d.bankerNumber})` : ""}`,
    `Lines: ${d.lines} @ GHS ${money(d.unitPrice)}`,
    `Stake: GHS ${money(d.totalStake)}`,
    `Potential win: GHS ${money(d.potentialPayout)}`,
    `Sold ${stamp(d.saleDate)} by ${d.writerCode}`,
    `Valid ${d.validityDays} days (until ${dateOnly(expiryDate(d.drawDate, d.validityDays))})`,
  ].join("\n");
}
