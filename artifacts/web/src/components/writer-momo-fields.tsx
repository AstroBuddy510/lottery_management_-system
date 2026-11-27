import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Smartphone, CheckCircle2, AlertTriangle } from "lucide-react";
import { apiGet, apiSend } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

/**
 * The payout wallet, inside Edit Writer.
 *
 * A writer's winning POS ticket is paid to this wallet and nowhere else; with
 * none registered, scanning a winning ticket stops at "no MoMo wallet
 * registered". So the wallet is part of editing a writer, not a separate
 * page someone has to remember, and the form will not save without one.
 *
 * Saved through PUT /writers/:id/momo, which checks the number, asks the
 * network whose wallet it is, and records who changed it.
 */

interface MomoInfo {
  momoNumber: string | null;
  momoProvider: string | null;
  momoAccountName: string | null;
  providers: Array<{ value: string; label: string }>;
  canEdit: boolean;
}

/** Ghana mobile prefixes; numbers are portable, so the network is only a suggestion. */
const MOBILE_PREFIXES = new Set(["020", "023", "024", "025", "026", "027", "028", "050", "053", "054", "055", "056", "057", "059"]);
const LIKELY_NETWORK: Record<string, string> = {
  "024": "mtn", "025": "mtn", "053": "mtn", "054": "mtn", "055": "mtn", "059": "mtn",
  "020": "vod", "050": "vod",
  "026": "atl", "027": "atl", "056": "atl", "057": "atl",
};

export function normaliseMomo(raw: string): string | null {
  let d = raw.replace(/[\s\-()+]/g, "");
  if (/^233\d{9}$/.test(d)) d = `0${d.slice(3)}`;
  return /^0\d{9}$/.test(d) && MOBILE_PREFIXES.has(d.slice(0, 3)) ? d : null;
}

export interface WriterMomoForm {
  ready: boolean;
  canEdit: boolean;
  number: string;
  setNumber: (v: string) => void;
  provider: string;
  setProvider: (v: string) => void;
  providers: Array<{ value: string; label: string }>;
  registered: { number: string; provider: string; name: string | null } | null;
  /** The entry is a usable wallet (or the registered one is left as it is). */
  valid: boolean;
  dirty: boolean;
  problem: string | null;
  /** Saves when changed. Resolves to the name the network gave, if any. */
  save: () => Promise<string | null | undefined>;
}

export function useWriterMomoForm(writerId: string | null | undefined): WriterMomoForm {
  const qc = useQueryClient();
  const { data } = useQuery<MomoInfo>({
    queryKey: ["/api/writers/momo", writerId],
    queryFn: () => apiGet(`/api/writers/${writerId}/momo`),
    enabled: !!writerId,
  });
  const [number, setNumberRaw] = useState("");
  const [provider, setProvider] = useState("");

  // Start from what is registered each time a different writer is opened.
  useEffect(() => {
    setNumberRaw(data?.momoNumber ?? "");
    setProvider(data?.momoProvider ?? "");
  }, [writerId, data?.momoNumber, data?.momoProvider]);

  const setNumber = (v: string) => {
    setNumberRaw(v);
    // Suggest the network from the prefix, but only when none is chosen yet.
    const n = normaliseMomo(v);
    if (n && !provider && LIKELY_NETWORK[n.slice(0, 3)]) setProvider(LIKELY_NETWORK[n.slice(0, 3)]!);
  };

  const normalised = normaliseMomo(number);
  const dirty = !!data && ((normalised ?? number.trim()) !== (data.momoNumber ?? "") || provider !== (data.momoProvider ?? ""));
  const problem = useMemo(() => {
    if (!number.trim()) return "A MoMo wallet is required for payouts";
    if (!normalised) return "Enter a 10-digit Ghana mobile number, e.g. 0241234567";
    if (!provider) return "Choose the wallet's network";
    return null;
  }, [number, normalised, provider]);

  return {
    ready: !!data,
    canEdit: !!data?.canEdit,
    number,
    setNumber,
    provider,
    setProvider,
    providers: data?.providers ?? [],
    registered: data?.momoNumber
      ? { number: data.momoNumber, provider: data.momoProvider ?? "", name: data.momoAccountName }
      : null,
    valid: problem === null,
    dirty,
    problem,
    save: async () => {
      if (!writerId || !dirty || problem) return undefined;
      const r = await apiSend<{ momoAccountName: string | null }>("PUT", `/api/writers/${writerId}/momo`, {
        number: normalised,
        provider,
      });
      qc.invalidateQueries({ queryKey: ["/api/writers/momo", writerId] });
      return r.momoAccountName;
    },
  };
}

export function WriterMomoFields({ form, idPrefix = "momo", touched }: { form: WriterMomoForm; idPrefix?: string; touched?: boolean }) {
  if (!form.ready) {
    return <div className="h-[7.5rem] rounded-xl border border-dashed bg-muted/30 animate-pulse" />;
  }
  const label = form.providers.find(p => p.value === form.registered?.provider)?.label;
  const showProblem = form.problem && (touched || form.number.trim().length > 0);
  return (
    <fieldset className={cn("space-y-2.5 rounded-xl border p-3", form.registered ? "bg-muted/20" : "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20")}>
      <legend className="flex items-center gap-1.5 px-1 text-xs font-semibold">
        <Smartphone className="h-3.5 w-3.5" /> Mobile Money wallet <span className="font-normal text-muted-foreground">(payouts)</span>
      </legend>

      {form.registered ? (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>
            Registered: <span className="font-mono font-semibold text-foreground">{form.registered.number}</span>
            {label ? ` · ${label}` : ""}
            {form.registered.name ? ` · ${form.registered.name}` : " · name not confirmed by the network"}
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          No wallet registered. This writer's winning tickets cannot be paid until one is added.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)] gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-number`} className="text-[11px] text-muted-foreground">MoMo number</Label>
          <Input
            id={`${idPrefix}-number`}
            value={form.number}
            onChange={e => form.setNumber(e.target.value)}
            inputMode="tel"
            autoComplete="off"
            placeholder="0241234567"
            disabled={!form.canEdit}
            aria-invalid={!!showProblem}
            className="h-11 rounded-xl font-mono text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Network</Label>
          <Select value={form.provider} onValueChange={form.setProvider} disabled={!form.canEdit}>
            <SelectTrigger className="h-11 rounded-xl text-sm"><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>
              {form.providers.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {showProblem ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">{form.problem}</p>
      ) : form.dirty ? (
        <p className="text-[11px] text-muted-foreground">
          Saved with the writer. Claims already with the cashier keep the wallet they were made with.
        </p>
      ) : null}
    </fieldset>
  );
}
