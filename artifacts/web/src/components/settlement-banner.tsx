import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { fmtGHS } from "@/lib/utils";
import { LIVE_REFETCH_MS } from "@/components/live-sales";

/**
 * End-of-day settlement notice for postpaid writers.
 *
 * Shown only once a draw has closed and only when something is actually
 * payable, so it stays a signal rather than permanent furniture.
 */

interface Settlement {
  ledgerId: string;
  ledgerDate: string;
  totalStakes: string;
  totalWinnings: string;
  netBalance: string;
  gameName: string;
  eventNumber: string;
}

interface SettlementResponse {
  applicable: boolean;
  totalPayable: string;
  settlements: Settlement[];
}

export function SettlementBanner() {
  const { data } = useQuery<SettlementResponse>({
    queryKey: ["/api/postpaid/my-settlement"],
    queryFn: async () => {
      const res = await fetch("/api/postpaid/my-settlement", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error("Failed to load settlement");
      return res.json();
    },
    refetchInterval: LIVE_REFETCH_MS,
  });

  if (!data?.applicable) return null;
  const payable = Number(data.totalPayable);
  if (!data.settlements?.length || payable <= 0) return null;

  return (
    <div className="rounded-xl border-2 border-amber-400/70 bg-amber-50 dark:bg-amber-950/20 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-amber-400/20 flex items-center justify-center shrink-0">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-amber-900 dark:text-amber-200 leading-tight">
            Settlement due
          </h3>
          <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
            {data.settlements.length === 1
              ? "This draw has closed. Please hand in:"
              : `${data.settlements.length} closed draws are awaiting settlement. Total due:`}
          </p>
          <div className="text-3xl font-extrabold tabular-nums text-amber-900 dark:text-amber-100 mt-1.5">
            {fmtGHS(payable)}
          </div>

          <div className="mt-3 space-y-1.5 border-t border-amber-400/30 pt-2.5">
            {data.settlements.map((s) => (
              <div key={s.ledgerId} className="text-[11px] flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-amber-900 dark:text-amber-200">
                  {s.gameName} · {s.eventNumber}
                </span>
                <span className="text-amber-800/70 dark:text-amber-300/70 tabular-nums">
                  stakes {fmtGHS(s.totalStakes)} − wins paid {fmtGHS(s.totalWinnings)} =
                </span>
                <span className="font-bold tabular-nums text-amber-900 dark:text-amber-100">
                  {fmtGHS(s.netBalance)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
