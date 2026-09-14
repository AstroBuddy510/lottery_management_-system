import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Printer, Copy, MessageSquare, MessageCircle, Check, ImageDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  captureTicketPng,
  downloadBlob,
  shareImage,
  TICKET_SLIP_ID,
} from "@/lib/ticket-image";

/**
 * 58mm thermal receipt. The body text is built server-side so the printed
 * slip, the on-screen preview and the SMS all say exactly the same thing.
 */

export interface TicketReceipt {
  ticket: {
    id: string;
    ticketNumber: string;
    status: string;
    isWinner: boolean;
    winAmount: string;
    numbers: string;
    bankerNumber?: number | null;
    /**
     * The picks that actually earned the win, decided by the bet engine and
     * sent down settled - never worked out here. Empty on anything that did
     * not win, which is what keeps a losing slip unmarked.
     */
    winningNumbers?: number[];
    winningBanker?: number | null;
    stakeAmount: string;
    potentialPayout: string;
    saleDate: string;
    validUntil: string;
  };
  game: {
    name: string;
    eventNumber: string;
    drawDate: string;
    winningNumbers?: string | null;
  };
  betType: { name: string };
  writer: { code: string; name: string };
  agent: { code: string; name: string | null };
  qrPayload: string;
  receiptText: string;
  /** The exact slice of receiptText holding the played numbers. */
  numbersBlock?: string;
  smsText: string;
}

/** Ink for the winning ring. Dark enough to survive a screenshot or a print. */
const WIN_GREEN = "#059669";
const WIN_TEXT = "#047857";

/**
 * The picks to ring, as a set the slip can test each printed number against.
 * A ticket that did not win yields an empty set and is therefore left alone.
 */
function winningSet(data: TicketReceipt): Set<number> {
  if (!data.ticket.isWinner) return new Set();
  const picks = data.ticket.winningNumbers ?? [];
  const banker = data.ticket.winningBanker;
  return new Set(banker != null ? [...picks, banker] : picks);
}

/**
 * Where the played numbers sit inside the receipt body.
 *
 * The slip is one preformatted block built on the server, so rather than
 * guessing which lines hold numbers we find the exact substring the server
 * says it put there. No match - an older cached receipt, say - means no
 * markup rather than a mangled slip.
 */
function locateNumbers(data: TicketReceipt): { before: string; numbers: string; after: string } | null {
  const block = data.numbersBlock;
  if (!block) return null;

  // Only a match that starts its own line is the numbers block; anything
  // found mid-line is a coincidence in some other row.
  let at = data.receiptText.indexOf(block);
  while (at > 0 && data.receiptText[at - 1] !== "\n") {
    at = data.receiptText.indexOf(block, at + 1);
  }
  if (at < 0) return null;

  return {
    before: data.receiptText.slice(0, at),
    numbers: block,
    after: data.receiptText.slice(at + block.length),
  };
}

/**
 * A number with a green ring drawn round it.
 *
 * The ring is an overlay rather than a border or padding on the number
 * itself: the slip is monospaced to a 32-column grid, and anything that
 * changes a character's width would shunt the columns out of line.
 */
function WinnerRing({ children }: { children: ReactNode }) {
  return (
    <span style={{ position: "relative", display: "inline-block", color: WIN_TEXT, fontWeight: 700 }}>
      {children}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "-2px",
          right: "-3px",
          bottom: "-2px",
          left: "-3px",
          border: `1.5px solid ${WIN_GREEN}`,
          borderRadius: "50%",
          pointerEvents: "none",
        }}
      />
    </span>
  );
}

/** The numbers block, with every winning pick ringed. */
function MarkedNumbers({ text, winners }: { text: string; winners: Set<number> }) {
  const nodes: ReactNode[] = [];
  const re = /\d+/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  // Whole runs of digits, so 5 is never found inside 65.
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      winners.has(parseInt(m[0], 10)) ? <WinnerRing key={key++}>{m[0]}</WinnerRing> : m[0],
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

const COMPANY_LOGO = "/company-logo-v3.png";

export function useTicketReceipt(ticketId: string | null) {
  return useQuery<TicketReceipt>({
    queryKey: ["/api/tickets/receipt", ticketId],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId!)}/receipt`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load receipt");
      return res.json();
    },
    enabled: !!ticketId,
  });
}

function statusTone(status: string, isWinner: boolean): string {
  if (isWinner || status === "won") return "bg-emerald-500/10 text-emerald-700 border-emerald-200";
  if (status === "lost") return "bg-slate-500/10 text-slate-700 border-slate-200";
  if (status === "cancelled" || status === "void") return "bg-destructive/10 text-destructive border-destructive/20";
  return "bg-blue-500/10 text-blue-700 border-blue-200";
}

/** The slip itself, at true 58mm width. Also what gets printed. */
export function ReceiptSlip({ data, printRef }: { data: TicketReceipt; printRef?: string }) {
  // Rings are drawn only when this ticket won something. Everything else -
  // active, lost, void - renders as the plain slip it has always been.
  const winners = useMemo(() => winningSet(data), [data]);
  const split = useMemo(() => (winners.size > 0 ? locateNumbers(data) : null), [data, winners]);

  return (
    <div
      id={printRef}
      className="bg-white text-black mx-auto"
      style={{ width: "58mm", padding: "3mm", fontFamily: "'Courier New', monospace" }}
    >
      <div style={{ textAlign: "center" }}>
        <img
          src={COMPANY_LOGO}
          alt=""
          style={{ width: "22mm", height: "auto", display: "inline-block", marginBottom: "1mm" }}
        />
      </div>
      <pre
        style={{
          fontFamily: "'Courier New', monospace",
          fontSize: "8.5pt",
          lineHeight: 1.25,
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {split ? (
          <>
            {split.before}
            <MarkedNumbers text={split.numbers} winners={winners} />
            {split.after}
          </>
        ) : (
          data.receiptText
        )}
      </pre>
      <div style={{ textAlign: "center", marginTop: "2mm" }}>
        <QRCodeSVG value={data.qrPayload} size={110} level="M" includeMargin />
        <div style={{ fontSize: "7pt", fontFamily: "'Courier New', monospace", marginTop: "1mm" }}>
          Scan to verify
        </div>
      </div>
    </div>
  );
}

const escapeHtml = (text: string) =>
  text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);

/**
 * The receipt body as HTML for the print window, winners ringed.
 *
 * A thermal printer renders this monochrome and the ring simply comes out
 * black, which is still the mark a cashier needs; on an office printer it
 * comes out green like the screen.
 */
function receiptHtml(data: TicketReceipt): string {
  const winners = winningSet(data);
  const split = winners.size > 0 ? locateNumbers(data) : null;
  if (!split) return escapeHtml(data.receiptText);

  const ringed = escapeHtml(split.numbers).replace(/\d+/g, (digits) =>
    winners.has(parseInt(digits, 10))
      ? `<span class="w">${digits}<i></i></span>`
      : digits,
  );
  return escapeHtml(split.before) + ringed + escapeHtml(split.after);
}

function printSlip(data: TicketReceipt) {
  const w = window.open("", "_blank", "width=380,height=700");
  if (!w) return;
  // Inline the QR as an SVG string so the print window needs no scripts.
  const qrNode = document.querySelector("#ticket-receipt-slip svg");
  const qrSvg = qrNode ? qrNode.outerHTML : "";
  w.document.write(`
    <html><head><title>Ticket ${data.ticket.ticketNumber}</title>
    <style>
      @page { size: 58mm auto; margin: 0; }
      body { margin: 0; padding: 3mm; width: 58mm; font-family: 'Courier New', monospace; }
      pre { font-size: 8.5pt; line-height: 1.25; margin: 0; white-space: pre-wrap; word-break: break-word; }
      .c { text-align: center; }
      img { width: 22mm; margin-bottom: 1mm; }
      svg { width: 28mm; height: 28mm; }
      /* Ringed winning numbers. The ring is an overlay so the 32-column
         grid keeps its alignment. */
      .w { position: relative; display: inline-block; color: ${WIN_TEXT}; font-weight: 700; }
      .w i { position: absolute; top: -2px; right: -3px; bottom: -2px; left: -3px;
             border: 1.5px solid ${WIN_GREEN}; border-radius: 50%; }
      @media print { .w, .w i { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style></head>
    <body>
      <div class="c"><img src="${COMPANY_LOGO}" alt=""></div>
      <pre>${receiptHtml(data)}</pre>
      <div class="c" style="margin-top:2mm">${qrSvg}<div style="font-size:7pt">Scan to verify</div></div>
    </body></html>
  `);
  w.document.close();
  w.focus();
  // Give the logo a moment to load, otherwise it prints blank.
  setTimeout(() => w.print(), 400);
}

export function TicketReceiptView({ data }: { data: TicketReceipt }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<"sms" | "full" | null>(null);
  const [saving, setSaving] = useState(false);

  const smsHref = useMemo(() => `sms:?body=${encodeURIComponent(data.smsText)}`, [data.smsText]);
  /**
   * wa.me with no number opens WhatsApp on the writer's own contact picker,
   * so they hand the slip to whoever staked it without having to type the
   * number in first. Same text as the SMS and the printed slip.
   */
  const whatsappHref = useMemo(
    () => `https://wa.me/?text=${encodeURIComponent(data.smsText)}`,
    [data.smsText],
  );

  /**
   * Save the slip as a picture, then offer the share sheet.
   *
   * Download first, share second, and deliberately in that order: the file is
   * on the device whatever the browser makes of sharing, so a phone that
   * cannot share files still leaves the writer with something to send.
   */
  const saveImage = async () => {
    setSaving(true);
    try {
      const blob = await captureTicketPng(TICKET_SLIP_ID);
      const filename = `${data.ticket.ticketNumber}.png`;
      downloadBlob(blob, filename);

      const outcome = await shareImage(blob, filename, data.smsText);
      if (outcome === "unsupported") {
        toast({
          title: "Image saved",
          description: "Sharing straight from here isn't supported on this device — send it from your gallery.",
        });
      } else if (outcome === "failed") {
        toast({
          title: "Image saved",
          description: "The share sheet wouldn't open. The picture is in your downloads.",
        });
      } else if (outcome === "cancelled") {
        toast({ title: "Image saved", description: "Sharing cancelled. The picture is in your downloads." });
      }
    } catch (e) {
      toast({
        title: "Couldn't make the image",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string, which: "sms" | "full") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({ title: "Couldn't copy", description: "Select the text and copy manually.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-2">
        <Badge variant="outline" className={statusTone(data.ticket.status, data.ticket.isWinner)}>
          {data.ticket.isWinner ? `WON · GHS ${Number(data.ticket.winAmount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : data.ticket.status.toUpperCase()}
        </Badge>
      </div>

      <div className="border rounded-lg overflow-x-auto py-3 bg-muted/30">
        {/* The id sits on the slip itself, not this wrapper: capturing the
            wrapper would take its full width and bake the page background in
            as white margin either side of a 58mm slip. */}
        <ReceiptSlip data={data} printRef={TICKET_SLIP_ID} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => printSlip(data)}>
          <Printer className="h-4 w-4 mr-2" /> Print
        </Button>
        <Button
          variant="outline"
          asChild
          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
        >
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4 mr-2" /> WhatsApp
          </a>
        </Button>
        <Button
          variant="outline"
          className="col-span-2"
          disabled={saving}
          onClick={saveImage}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ImageDown className="h-4 w-4 mr-2" />
          )}
          {saving ? "Preparing image…" : "Download Image"}
        </Button>
        <Button variant="outline" asChild className="col-span-2">
          <a href={smsHref}>
            <MessageSquare className="h-4 w-4 mr-2" /> Send SMS
          </a>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => copy(data.smsText, "sms")}>
          {copied === "sms" ? <Check className="h-3.5 w-3.5 mr-2" /> : <Copy className="h-3.5 w-3.5 mr-2" />}
          Copy SMS text
        </Button>
        <Button variant="ghost" size="sm" onClick={() => copy(data.receiptText, "full")}>
          {copied === "full" ? <Check className="h-3.5 w-3.5 mr-2" /> : <Copy className="h-3.5 w-3.5 mr-2" />}
          Copy full slip
        </Button>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">SMS preview</summary>
        <pre className="mt-2 p-3 rounded-md bg-muted whitespace-pre-wrap font-mono text-[11px]">
          {data.smsText}
        </pre>
      </details>
    </div>
  );
}

/** Post-sale dialog shown to the writer straight after a bet is placed. */
export function TicketReceiptDialog({
  ticketId,
  onClose,
}: {
  ticketId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useTicketReceipt(ticketId);

  return (
    <Dialog open={!!ticketId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ticket</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-10 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-destructive">{(error as Error).message}</p>
        ) : data ? (
          <TicketReceiptView data={data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
