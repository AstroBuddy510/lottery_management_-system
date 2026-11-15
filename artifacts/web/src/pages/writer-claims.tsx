import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ScanLine, Camera, CameraOff, Smartphone, CheckCircle2, XCircle, Clock, Loader2, Trophy, Keyboard,
} from "lucide-react";
import { apiGet, apiSend } from "@/lib/api-fetch";
import { fmtGHS } from "@/lib/utils";

/**
 * Claim Wins: the writer's side of a payout.
 *
 * The camera reads the QR printed on the ticket and sends it as it is. Nothing
 * is decided on this device - whether the ticket won, whether it has been
 * claimed before, whether it is even ours - because a decision made on a
 * terminal is a decision the terminal's owner can change. The screen only
 * shows what the server said.
 *
 * Typing the ticket number is offered as well, for the phone whose camera will
 * not focus or the browser that cannot scan. A typed claim is accepted, and
 * marked as typed for the cashier to see.
 */

interface ClaimResult {
  outcome: string;
  accepted: boolean;
  message: string;
  ticketNumber?: string;
  amount?: string;
}

interface MyClaim {
  payoutId: string;
  status: string;
  amount: string;
  claimedAt: string | null;
  paidAt: string | null;
  rejectionReason: string | null;
  resolutionNote: string | null;
  ticketNumber: string;
  numbers: string;
  gameName: string;
  eventNumber: string;
  gameCloseAt: string;
  validUntil: string;
  /** Unclaimed and past its validity: it can no longer be claimed. */
  expired: boolean;
}

interface MyClaims {
  wallet: { number: string; provider: string; providerLabel: string | null; accountName: string | null } | null;
  claims: MyClaim[];
}

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Scan to claim", tone: "bg-amber-500/10 text-amber-700 border-amber-200" },
  approved: { label: "Scan to claim", tone: "bg-amber-500/10 text-amber-700 border-amber-200" },
  awaiting_funds: { label: "Claimed · queued", tone: "bg-orange-500/10 text-orange-700 border-orange-200" },
  verified: { label: "With cashier", tone: "bg-blue-500/10 text-blue-700 border-blue-200" },
  processing: { label: "Payment sent", tone: "bg-indigo-500/10 text-indigo-700 border-indigo-200" },
  paid: { label: "Paid", tone: "bg-emerald-500/10 text-emerald-700 border-emerald-200" },
  rejected: { label: "Under review", tone: "bg-red-500/10 text-red-700 border-red-200" },
  withheld: { label: "Withheld", tone: "bg-slate-500/10 text-slate-600 border-slate-300" },
};

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };

/** The browser's own QR reader, where it has one. Android Chrome does. */
function makeDetector(): Detector | null {
  const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

export function WriterClaims() {
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [results, setResults] = useState<ClaimResult[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number } | null>(null);

  const mine = useQuery<MyClaims>({
    queryKey: ["/api/pos-wins/my-claims"],
    queryFn: () => apiGet("/api/pos-wins/my-claims"),
    refetchInterval: 30_000,
  });

  const submit = useMutation({
    mutationFn: (v: { code: string; method: "qr" | "manual" }) =>
      apiSend<{ results: ClaimResult[] }>("POST", "/api/pos-wins/claims", v),
    onSuccess: (r) => {
      setResults(prev => [...r.results, ...prev].slice(0, 12));
      qc.invalidateQueries({ queryKey: ["/api/pos-wins/my-claims"] });
      if (r.results.some(x => x.accepted)) navigator.vibrate?.(120);
    },
    onError: (e: Error) => setResults(prev => [{ outcome: "error", accepted: false, message: e.message }, ...prev]),
    onSettled: () => { busyRef.current = false; },
  });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    setCameraError(null);
    const detector = makeDetector();
    if (!detector) {
      setCameraError("This browser cannot scan QR codes. Type the ticket number below instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      setScanning(true);
      // The <video> only exists once `scanning` has rendered.
      requestAnimationFrame(async () => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});

        const tick = async () => {
          if (!streamRef.current) return;
          if (!busyRef.current && video.readyState >= 2) {
            try {
              const codes = await detector.detect(video);
              const code = codes[0]?.rawValue;
              // The same ticket held under the lens is read many times a
              // second; send it once, and not again for a few seconds.
              const last = lastRef.current;
              if (code && !(last && last.code === code && Date.now() - last.at < 4000)) {
                lastRef.current = { code, at: Date.now() };
                busyRef.current = true;
                submit.mutate({ code, method: "qr" });
              }
            } catch {
              /* a frame that could not be read is not an error worth showing */
            }
          }
          setTimeout(tick, 250);
        };
        tick();
      });
    } catch {
      setCameraError("The camera could not be opened. Allow camera access for this site, or type the ticket number below.");
      stopCamera();
    }
  };

  const wallet = mine.data?.wallet;
  const claims = mine.data?.claims ?? [];
  const unclaimed = claims.filter(c => (c.status === "pending" || c.status === "approved") && !c.expired);
  const unclaimedTotal = unclaimed.reduce((n, c) => n + Number(c.amount), 0);

  return (
    <div className="px-4 pt-5 pb-8 space-y-4 max-w-xl mx-auto">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" /> Claim Wins
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Scan the QR code on a winning ticket. Once the cashier approves, the payout is sent to your MoMo wallet.
        </p>
      </div>

      {/* Where the money will go */}
      <Card className={wallet ? "" : "border-amber-300 bg-amber-50/60"}>
        <CardContent className="p-3.5 flex items-center gap-3">
          <Smartphone className={`w-5 h-5 shrink-0 ${wallet ? "text-emerald-600" : "text-amber-600"}`} />
          {wallet ? (
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Payouts go to</p>
              <p className="text-sm font-bold font-mono">{wallet.number} <span className="font-sans font-medium text-muted-foreground">· {wallet.providerLabel}</span></p>
              {wallet.accountName && <p className="text-[11px] text-muted-foreground truncate">{wallet.accountName}</p>}
            </div>
          ) : (
            <p className="text-xs text-amber-800">
              <strong>No MoMo wallet registered.</strong> You cannot be paid until your agent adds one to your profile.
            </p>
          )}
        </CardContent>
      </Card>

      {unclaimed.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          You have <strong>{unclaimed.length}</strong> winning ticket{unclaimed.length === 1 ? "" : "s"} worth{" "}
          <strong>{fmtGHS(unclaimedTotal)}</strong> not yet claimed.
        </div>
      )}

      {/* Scanner */}
      <Card>
        <CardContent className="p-3.5 space-y-3">
          {scanning ? (
            <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <div className="absolute inset-8 border-2 border-white/80 rounded-2xl pointer-events-none" />
              {submit.isPending && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              )}
            </div>
          ) : null}

          <Button className="w-full h-12 text-base font-semibold" variant={scanning ? "outline" : "default"} onClick={scanning ? stopCamera : startCamera}>
            {scanning ? <><CameraOff className="w-5 h-5 mr-2" /> Stop scanning</> : <><Camera className="w-5 h-5 mr-2" /> Scan ticket QR</>}
          </Button>
          {cameraError && <p className="text-xs text-amber-700">{cameraError}</p>}

          <form
            className="flex gap-2"
            onSubmit={e => {
              e.preventDefault();
              const code = typed.trim();
              if (!code || submit.isPending) return;
              // A hardware scanner types the whole QR payload; a person types a number.
              submit.mutate({ code, method: code.startsWith("{") ? "qr" : "manual" });
              setTyped("");
            }}
          >
            <div className="relative flex-1">
              <Keyboard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={typed}
                onChange={e => setTyped(e.target.value)}
                placeholder="or type the ticket number"
                className="h-11 pl-9 font-mono text-sm"
                autoCapitalize="characters"
                autoComplete="off"
              />
            </div>
            <Button type="submit" variant="outline" className="h-11" disabled={!typed.trim() || submit.isPending}>
              <ScanLine className="w-4 h-4 mr-1.5" /> Claim
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* What the server said, newest first */}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div
              key={i}
              className={`rounded-xl border px-3.5 py-3 flex items-start gap-2.5 ${
                r.accepted ? "border-emerald-200 bg-emerald-50/70" : "border-red-200 bg-red-50/60"
              }`}
            >
              {r.accepted
                ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                : <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />}
              <div className="min-w-0">
                {r.ticketNumber && <p className="text-xs font-mono font-bold">{r.ticketNumber}</p>}
                <p className={`text-sm ${r.accepted ? "text-emerald-900" : "text-red-900"}`}>{r.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Every winning ticket of mine, and where it has got to */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold pt-2">My winning tickets</h2>
        {mine.isLoading ? (
          <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-muted-foreground" /></div>
        ) : claims.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No winning tickets yet.</p>
        ) : claims.map(c => {
          const cfg = c.expired
            ? { label: "Expired", tone: "bg-slate-500/10 text-slate-600 border-slate-300" }
            : STATUS[c.status] ?? { label: c.status, tone: "bg-muted" };
          return (
            <Card key={c.payoutId}>
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-mono font-bold truncate">{c.ticketNumber}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {c.gameName} #{c.eventNumber} · <span className="font-mono">{c.numbers}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black tabular-nums">{fmtGHS(c.amount)}</p>
                    <Badge variant="outline" className={`${cfg.tone} text-[10px] font-bold mt-0.5`}>{cfg.label}</Badge>
                  </div>
                </div>
                {c.status === "paid" && c.paidAt && (
                  <p className="text-[11px] text-emerald-700 mt-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Sent to your wallet {new Date(c.paidAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                )}
                {c.expired && (
                  <p className="text-[11px] text-slate-600 mt-2">
                    Not claimed by {new Date(c.validUntil).toLocaleDateString("en-GB", { dateStyle: "medium" })}; it can no longer be paid.
                  </p>
                )}
                {!c.expired && (c.status === "pending" || c.status === "approved") && (
                  <p className="text-[11px] text-amber-700 mt-2">
                    Scan by {new Date(c.validUntil).toLocaleDateString("en-GB", { dateStyle: "medium" })} to be paid.
                  </p>
                )}
                {c.status === "withheld" && c.resolutionNote && (
                  <p className="text-[11px] text-slate-600 mt-2">Reason: {c.resolutionNote}</p>
                )}
                {(c.status === "verified" || c.status === "awaiting_funds" || c.status === "processing") && c.claimedAt && (
                  <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Claimed {new Date(c.claimedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default WriterClaims;
