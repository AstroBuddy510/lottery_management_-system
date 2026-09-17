import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Printer, Copy, MessageSquare, MessageCircle, Check, ImageDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { captureTicketPng, downloadBlob, shareImage, TICKET_SLIP_ID } from "@/lib/ticket-image";

/**
 * The printed document for several bets bought together.
 *
 * Deliberately a sibling of the single-ticket receipt rather than a variant of
 * it: the body text is built server-side for both, but a slip has items and a
 * grand total where a ticket has one bet, and forcing one component to be both
 * made each harder to read than the two apart.
 */

const COMPANY_LOGO = "/company-logo-v3.png";

export interface SlipReceipt {
  slip: {
    slipNumber: string;
    ticketCount: number;
    totalStake: string;
    totalPotentialPayout: string;
    saleDate: string;
    validUntil: string;
  };
  game: { name: string; eventNumber: string; drawDate: string };
  writer: { code: string; name: string };
  agent: { code: string; name: string | null };
  items: Array<{
    betTypeName: string;
    numbers: string;
    bankerNumber?: number | null;
    lines: number;
    unitPrice: string;
    amount: string;
    ticketNumber: string;
  }>;
  qrPayload: string;
  receiptText: string;
  headerBlock?: { name: string; tagline: string; full: string };
  smsText: string;
}

export function useSlipReceipt(slipNumber: string | null) {
  return useQuery<SlipReceipt>({
    queryKey: ["/api/tickets/slip/receipt", slipNumber],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/slip/${encodeURIComponent(slipNumber!)}/receipt`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load slip");
      return res.json();
    },
    enabled: !!slipNumber,
  });
}

const escapeHtml = (text: string) =>
  text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);

/** Masthead split off the top, so the name can carry weight and the slogan not. */
function splitHeader(data: SlipReceipt): { name: string; tagline: string; rest: string } | null {
  const block = data.headerBlock;
  if (!block?.full || !data.receiptText.startsWith(block.full)) return null;
  return { name: block.name, tagline: block.tagline, rest: data.receiptText.slice(block.full.length) };
}

export function SlipBody({ data, printRef }: { data: SlipReceipt; printRef?: string }) {
  const header = useMemo(() => splitHeader(data), [data]);
  const body = header ? header.rest : data.receiptText;

  return (
    <div
      id={printRef}
      className="bg-white text-black mx-auto"
      style={{ width: "58mm", padding: "3mm", fontFamily: "'Courier New', monospace" }}
    >
      <div style={{ textAlign: "center" }}>
        <img src={COMPANY_LOGO} alt="" style={{ width: "22mm", height: "auto", display: "inline-block", marginBottom: "1mm" }} />
      </div>
      {header && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: "9pt", lineHeight: 1.2, fontWeight: 700, whiteSpace: "pre-wrap" }}>
            {header.name.trim()}
          </div>
          {header.tagline && (
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: "8pt", lineHeight: 1.2, fontWeight: 400, whiteSpace: "pre-wrap" }}>
              {header.tagline.trim()}
            </div>
          )}
        </div>
      )}
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
        {body}
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

function printSlipDoc(data: SlipReceipt) {
  const w = window.open("", "_blank", "width=380,height=700");
  if (!w) return;
  const qrNode = document.querySelector(`#${TICKET_SLIP_ID} svg`);
  const qrSvg = qrNode ? qrNode.outerHTML : "";
  const header = splitHeader(data);
  const body = header ? header.rest : data.receiptText;
  const masthead = header
    ? `<div class="mast">${escapeHtml(header.name.trim())}</div>` +
      (header.tagline ? `<div class="slogan">${escapeHtml(header.tagline.trim())}</div>` : "")
    : "";

  w.document.write(`
    <html><head><title>Slip ${data.slip.slipNumber}</title>
    <style>
      @page { size: 58mm auto; margin: 0; }
      body { margin: 0; padding: 3mm; width: 58mm; font-family: 'Courier New', monospace; }
      pre { font-size: 8.5pt; line-height: 1.25; margin: 0; white-space: pre-wrap; word-break: break-word; }
      .c { text-align: center; }
      img { width: 22mm; margin-bottom: 1mm; }
      svg { width: 28mm; height: 28mm; }
      .mast { text-align: center; font-size: 9pt; line-height: 1.2; font-weight: 700; white-space: pre-wrap; }
      .slogan { text-align: center; font-size: 8pt; line-height: 1.2; font-weight: 400; white-space: pre-wrap; }
    </style></head>
    <body>
      <div class="c"><img src="${COMPANY_LOGO}" alt=""></div>
      ${masthead}
      <pre>${escapeHtml(body)}</pre>
      <div class="c" style="margin-top:2mm">${qrSvg}<div style="font-size:7pt">Scan to verify</div></div>
    </body></html>
  `);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

export function SlipReceiptView({ data }: { data: SlipReceipt }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const smsHref = useMemo(() => `sms:?body=${encodeURIComponent(data.smsText)}`, [data.smsText]);
  const whatsappHref = useMemo(
    () => `https://wa.me/?text=${encodeURIComponent(data.smsText)}`,
    [data.smsText],
  );

  const saveImage = async () => {
    setSaving(true);
    try {
      const blob = await captureTicketPng(TICKET_SLIP_ID);
      const filename = `${data.slip.slipNumber}.png`;
      downloadBlob(blob, filename);
      const outcome = await shareImage(blob, filename, data.smsText);
      if (outcome !== "shared") {
        toast({ title: "Image saved", description: "The picture is in your downloads." });
      }
    } catch (e) {
      toast({ title: "Couldn't make the image", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-xs text-muted-foreground">
          {data.slip.ticketCount} bet{data.slip.ticketCount === 1 ? "" : "s"} · total staked
        </div>
        <div className="text-2xl font-bold tabular-nums">
          GHS {Number(data.slip.totalStake).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>

      <div className="border rounded-lg overflow-x-auto py-3 bg-muted/30">
        <SlipBody data={data} printRef={TICKET_SLIP_ID} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => printSlipDoc(data)}>
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
        <Button variant="outline" className="col-span-2" disabled={saving} onClick={saveImage}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ImageDown className="h-4 w-4 mr-2" />}
          {saving ? "Preparing image…" : "Download Image"}
        </Button>
        <Button variant="outline" asChild className="col-span-2">
          <a href={smsHref}>
            <MessageSquare className="h-4 w-4 mr-2" /> Send SMS
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="col-span-2"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(data.receiptText);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast({ title: "Couldn't copy", variant: "destructive" });
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5 mr-2" /> : <Copy className="h-3.5 w-3.5 mr-2" />}
          Copy full slip
        </Button>
      </div>
    </div>
  );
}

/** Shown straight after a slip is sold. */
export function SlipReceiptDialog({
  slipNumber,
  onClose,
}: {
  slipNumber: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useSlipReceipt(slipNumber);

  return (
    <Dialog open={!!slipNumber} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bet Slip</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-10 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-destructive">{(error as Error).message}</p>
        ) : data ? (
          <SlipReceiptView data={data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
