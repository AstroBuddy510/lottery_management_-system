import { useState, useMemo } from "react";
import {
  useListEntryChangeRequests,
  useAdminReviewEntryChangeRequest,
  useDirectorReviewEntryChangeRequest,
  getListEntryChangeRequestsQueryKey,
  EntryChangeRequest,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { fmtGHS } from "@/lib/utils";

function relDate(s: string) {
  if (!s) return s;
  const d = s.split("T")[0];
  const today = new Date().toISOString().split("T")[0];
  if (d === today) return "Today";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    pending_admin:    { label: "Awaiting Admin Review",    class: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50" },
    pending_director: { label: "Awaiting Director Review", class: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/50" },
    approved:         { label: "Approved & Applied",         class: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50" },
    rejected:         { label: "Rejected",         class: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/50" },
  };
  const s = map[status] ?? { label: status, class: "bg-slate-50 text-slate-600 border-slate-200" };
  return <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${s.class}`}>{s.label}</span>;
}

type ReviewDialogState = {
  request: EntryChangeRequest;
  role: "admin" | "director";
} | null;

export function EntryChangeRequests() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const role = user?.role ?? "";

  const [filterStatus, setFilterStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [reviewDialog, setReviewDialog] = useState<ReviewDialogState>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Fetch all requests to allow rich real-time client-side counting and search
  const { data, isLoading } = useListEntryChangeRequests(
    {},
    { query: { queryKey: getListEntryChangeRequestsQueryKey({}) } },
  );
  const requests = Array.isArray(data) ? data : [];

  const adminReview = useAdminReviewEntryChangeRequest();
  const directorReview = useDirectorReviewEntryChangeRequest();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListEntryChangeRequestsQueryKey({}) });
  };

  const openReviewDialog = (request: EntryChangeRequest, reviewRole: "admin" | "director") => {
    setReviewDialog({ request, role: reviewRole });
    setReviewAction("approve");
    setReviewNote("");
  };

  const handleReview = async () => {
    if (!reviewDialog) return;
    setSubmitting(true);
    try {
      if (reviewDialog.role === "admin") {
        await adminReview.mutateAsync({
          id: reviewDialog.request.id,
          data: { action: reviewAction, note: reviewNote || undefined },
        });
        toast.success(reviewAction === "approve" ? "Forwarded to Director" : "Request rejected");
      } else {
        await directorReview.mutateAsync({
          id: reviewDialog.request.id,
          data: { action: reviewAction, note: reviewNote || undefined },
        });
        toast.success(reviewAction === "approve" ? "Change applied!" : "Request rejected");
      }
      setReviewDialog(null);
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Review failed");
    } finally {
      setSubmitting(false);
    }
  };

  const isAdmin = role === "administrator" || role === "director";
  const pageTitle = role === "agent" ? "My Change Requests" : "Entry Change Requests";

  // Dashboard calculations from the complete list
  const pendingAdminCount = useMemo(() => requests.filter(r => r.status === "pending_admin").length, [requests]);
  const pendingDirectorCount = useMemo(() => requests.filter(r => r.status === "pending_director").length, [requests]);
  const approvedCount = useMemo(() => requests.filter(r => r.status === "approved").length, [requests]);
  const rejectedCount = useMemo(() => requests.filter(r => r.status === "rejected").length, [requests]);

  // Combined client side filters for instantaneous updates
  const filteredRequests = useMemo(() => {
    let list = requests;
    if (filterStatus !== "all") {
      list = list.filter(r => r.status === filterStatus);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(r =>
        (r.writerFullCode ?? "").toLowerCase().includes(q) ||
        (r.writerFullName ?? "").toLowerCase().includes(q) ||
        (r.agentFullCode ?? "").toLowerCase().includes(q) ||
        (r.agentName ?? "").toLowerCase().includes(q) ||
        (r.requestedByName ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [requests, filterStatus, searchQuery]);

  return (
    <>
      <div className="p-6 space-y-6">
        
        {/* Modern Header Banner */}
        <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-2xl p-6 md:p-8 text-white shadow-lg border border-slate-700/50">
          <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-indigo-300 text-xs font-semibold uppercase tracking-wider mb-1.5">
                <span>Operations</span>
                <span>•</span>
                <span>Audit Trail</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{pageTitle}</h1>
              <p className="text-slate-300 text-sm mt-1 max-w-xl">
                {role === "agent"
                  ? "Track and monitor your requests to amend locked daily sale/win entries."
                  : "Review, audit and authorize daily entry adjustments submitted by agent offices."}
              </p>
            </div>
            
            {/* Header Mini Actions */}
            {role === "agent" && (
              <div className="text-right">
                <span className="text-[11px] text-indigo-200 uppercase tracking-wide block mb-1">Status Summary</span>
                <div className="flex items-center gap-2">
                  <div className="bg-white/10 px-3 py-1.5 rounded-lg text-xs font-mono">
                    <span className="font-semibold text-amber-300">{pendingAdminCount + pendingDirectorCount}</span> Pending
                  </div>
                  <div className="bg-white/10 px-3 py-1.5 rounded-lg text-xs font-mono">
                    <span className="font-semibold text-emerald-400">{approvedCount}</span> Approved
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Admin/Director KPI Summary Grid */}
        {isAdmin && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            
            {/* Pending Admin Card */}
            <button
              onClick={() => setFilterStatus("pending_admin")}
              className={`text-left p-4 rounded-xl border bg-white shadow-sm transition-all duration-300 relative group overflow-hidden ${
                filterStatus === "pending_admin" ? "ring-2 ring-amber-500 border-amber-500" : "hover:border-amber-300 hover:shadow-md"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Awaiting Admin</p>
                <div className="p-2 rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
              </div>
              <p className="text-2xl font-black font-mono mt-2 text-slate-800">{pendingAdminCount}</p>
              <span className="text-[10px] text-slate-400 mt-1 block">Click to view pending queue</span>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            {/* Pending Director Card */}
            <button
              onClick={() => setFilterStatus("pending_director")}
              className={`text-left p-4 rounded-xl border bg-white shadow-sm transition-all duration-300 relative group overflow-hidden ${
                filterStatus === "pending_director" ? "ring-2 ring-indigo-500 border-indigo-500" : "hover:border-indigo-300 hover:shadow-md"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Awaiting Director</p>
                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M8 12h8m-4-4v8"/></svg>
                </div>
              </div>
              <p className="text-2xl font-black font-mono mt-2 text-slate-800">{pendingDirectorCount}</p>
              <span className="text-[10px] text-slate-400 mt-1 block">Click to view approval queue</span>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            {/* Approved Card */}
            <button
              onClick={() => setFilterStatus("approved")}
              className={`text-left p-4 rounded-xl border bg-white shadow-sm transition-all duration-300 relative group overflow-hidden ${
                filterStatus === "approved" ? "ring-2 ring-emerald-500 border-emerald-500" : "hover:border-emerald-300 hover:shadow-md"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Approved</p>
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
              </div>
              <p className="text-2xl font-black font-mono mt-2 text-slate-800">{approvedCount}</p>
              <span className="text-[10px] text-slate-400 mt-1 block">Click to view log history</span>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            {/* Rejected Card */}
            <button
              onClick={() => setFilterStatus("rejected")}
              className={`text-left p-4 rounded-xl border bg-white shadow-sm transition-all duration-300 relative group overflow-hidden ${
                filterStatus === "rejected" ? "ring-2 ring-rose-500 border-rose-500" : "hover:border-rose-300 hover:shadow-md"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Rejected</p>
                <div className="p-2 rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                </div>
              </div>
              <p className="text-2xl font-black font-mono mt-2 text-slate-800">{rejectedCount}</p>
              <span className="text-[10px] text-slate-400 mt-1 block">Click to view audit failures</span>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-rose-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </div>
        )}

        {/* Filter and Search Bar */}
        <div className="bg-white border rounded-xl p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
          
          {/* Status Tab Pills */}
          <div className="flex gap-1 items-center flex-wrap self-start md:self-center">
            {([
              { id: "all", label: "All" },
              { id: "pending_admin", label: "Pending Admin" },
              { id: "pending_director", label: "Pending Director" },
              { id: "approved", label: "Approved" },
              { id: "rejected", label: "Rejected" },
            ] as { id: string; label: string }[]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  filterStatus === tab.id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Inputs */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
              <Input
                type="text"
                placeholder="Search writer or agent code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs rounded-lg border-slate-200 focus:ring-slate-300"
              />
            </div>
            {(filterStatus !== "all" || searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-xs text-slate-500 hover:text-slate-800"
                onClick={() => { setFilterStatus("all"); setSearchQuery(""); }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Change Request List */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white border rounded-2xl p-5 space-y-3">
                  <div className="flex justify-between"><Skeleton className="h-4 w-32" /><Skeleton className="h-5 w-20" /></div>
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-20 bg-white border border-dashed rounded-2xl flex flex-col items-center">
              <div className="p-4 bg-slate-50 text-slate-400 rounded-full mb-3.5">
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <p className="font-semibold text-slate-700 text-sm">No change requests found</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                {role === "agent"
                  ? "Select a locked game entry from your worksheet and click 'Request Change' to submit an audit correction request."
                  : "No pending or completed change logs match the chosen status filter or search parameters."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredRequests.map(req => (
                <RequestCard
                  key={req.id}
                  req={req}
                  role={role}
                  onAdminReview={() => openReviewDialog(req, "admin")}
                  onDirectorReview={() => openReviewDialog(req, "director")}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Review Action Dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={o => { if (!o) setReviewDialog(null); }}>
        <DialogContent className="max-w-md rounded-2xl p-6 gap-6">
          <DialogHeader className="pb-2 border-b">
            <DialogTitle className="text-lg font-bold text-slate-900">
              {reviewDialog?.role === "admin" ? "Admin Audit Authorization" : "Director Final Release Approval"}
            </DialogTitle>
          </DialogHeader>
          
          {reviewDialog && (
            <div className="space-y-4">
              {/* Detailed Split Diff Table */}
              <div className="bg-slate-50 rounded-xl border p-4 space-y-3 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-400">Writer Code</span>
                  <span className="font-mono font-bold text-slate-700">{reviewDialog.request.writerFullCode ?? "—"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-400">Target Date</span>
                  <span className="font-medium text-slate-700">{relDate(reviewDialog.request.entryDate)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-400">Transaction Column</span>
                  <span className="capitalize font-bold text-slate-700">{reviewDialog.request.entryType} Entry</span>
                </div>
                
                {/* Diff box */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="bg-white p-2.5 rounded border text-center">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Original</p>
                    <p className="text-sm font-bold font-mono text-slate-600 mt-1">{fmtGHS(Number(reviewDialog.request.currentAmount))}</p>
                  </div>
                  <div className="bg-indigo-50/50 border border-indigo-100 p-2.5 rounded text-center">
                    <p className="text-[10px] text-indigo-400 uppercase font-semibold">Proposed</p>
                    <p className="text-sm font-bold font-mono text-indigo-700 mt-1">{fmtGHS(Number(reviewDialog.request.requestedAmount))}</p>
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <span className="text-slate-400 block font-semibold mb-1">Reason for request:</span>
                  <span className="text-slate-600 italic block">"{reviewDialog.request.reason}"</span>
                </div>
                {reviewDialog.request.adminNote && reviewDialog.role === "director" && (
                  <div className="pt-2 border-t">
                    <span className="text-slate-400 block font-semibold mb-1">Admin intermediate notes:</span>
                    <span className="text-slate-600 block">"{reviewDialog.request.adminNote}"</span>
                  </div>
                )}
              </div>

              {/* Action Buttons Toggle */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Audit Verdict Decision</Label>
                <div className="flex gap-2.5 mt-1">
                  <button
                    onClick={() => setReviewAction("approve")}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold border-2 transition-all duration-200 ${
                      reviewAction === "approve"
                        ? "border-emerald-600 bg-emerald-50 text-emerald-800 shadow-sm"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {reviewDialog.role === "admin" ? "Verify & Forward" : "Authorize & Lock"}
                  </button>
                  <button
                    onClick={() => setReviewAction("reject")}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold border-2 transition-all duration-200 ${
                      reviewAction === "reject"
                        ? "border-rose-600 bg-rose-50 text-rose-800 shadow-sm"
                        : "border-slate-200 text-slate-500 hover:border-rose-300"
                    }`}
                  >
                    Reject Modification
                  </button>
                </div>
              </div>

              {/* Notes input */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Audit Journal Entry Note <span className="text-slate-400">(optional)</span></Label>
                <Textarea
                  value={reviewNote}
                  onChange={e => setReviewNote(e.target.value)}
                  placeholder={reviewAction === "reject" ? "State exact reason for rejecting this correction request..." : "Add administrative audit notes if necessary..."}
                  className="resize-none text-xs h-20 rounded-xl"
                />
              </div>
            </div>
          )}
          
          <DialogFooter className="gap-2 pt-2 border-t">
            <Button variant="ghost" size="sm" onClick={() => setReviewDialog(null)} disabled={submitting}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleReview}
              disabled={submitting}
              className={reviewAction === "reject" ? "bg-rose-600 hover:bg-rose-700 text-white" : "bg-slate-900 hover:bg-slate-800 text-white"}
            >
              {submitting ? "Updating..." : reviewAction === "approve" ? (reviewDialog?.role === "admin" ? "Forward to Director" : "Authorize Change") : "Reject Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RequestCard({
  req,
  role,
  onAdminReview,
  onDirectorReview,
}: {
  req: EntryChangeRequest;
  role: string;
  onAdminReview: () => void;
  onDirectorReview: () => void;
}) {
  const canAdminReview = (role === "administrator" || role === "director") && req.status === "pending_admin";
  const canDirectorReview = role === "director" && req.status === "pending_director";

  const diffVal = Number(req.requestedAmount) - Number(req.currentAmount);

  return (
    <div className="bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group">
      
      {/* Top Border Accent Indicator */}
      <div className={`absolute top-0 left-0 right-0 h-1 transition-all duration-300 ${
        req.status === "pending_admin" ? "bg-amber-400"
        : req.status === "pending_director" ? "bg-indigo-500"
        : req.status === "approved" ? "bg-emerald-500"
        : "bg-rose-500"
      }`} />

      {/* Top Header Section */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-sm text-slate-800">{req.writerFullCode ?? "Writer"}</span>
            {req.writerFullName && <span className="text-xs text-slate-400">({req.writerFullName})</span>}
            {req.agentFullCode && (
              <span className="text-[10px] text-slate-500 bg-slate-100 border px-1.5 py-0.5 rounded font-mono">{req.agentFullCode}</span>
            )}
          </div>
          <div className="text-[11px] text-slate-400 font-medium mt-1">
            {relDate(req.entryDate)} <span className="text-slate-300">•</span> <span className="capitalize font-semibold text-slate-500">{req.entryType} Entry</span>
          </div>
        </div>
        <StatusBadge status={req.status} />
      </div>

      {/* Structured Split Diff Box */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-center bg-slate-50/70 p-3 rounded-xl border border-slate-100 mb-4">
        
        {/* Original */}
        <div className="p-2 text-center sm:text-left">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Original Value</span>
          <span className="text-sm font-bold font-mono text-slate-600 block mt-1">{fmtGHS(Number(req.currentAmount))}</span>
        </div>

        {/* Arrow */}
        <div className="flex justify-center text-slate-300 shrink-0">
          <svg className="w-5 h-5 rotate-90 sm:rotate-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </div>

        {/* Proposed / Requested */}
        <div className="p-2 flex flex-col items-center sm:items-end text-center sm:text-right">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Requested Value</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-extrabold font-mono text-indigo-950 block">{fmtGHS(Number(req.requestedAmount))}</span>
            <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full ${diffVal >= 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"}`}>
              {diffVal >= 0 ? "+" : ""}{fmtGHS(diffVal)}
            </span>
          </div>
        </div>
      </div>

      {/* Request Reason */}
      <div className="bg-slate-50/40 rounded-xl p-3 border text-xs text-slate-600 mb-4">
        <span className="font-semibold text-slate-500 uppercase tracking-wide text-[9px] block mb-1">Reason for request</span>
        "{req.reason}"
      </div>

      {/* Timeline review trail */}
      {(req.adminNote || req.reviewedByAdminName || req.directorNote || req.reviewedByDirectorName) && (
        <div className="border-t pt-3.5 space-y-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Audit Actions History</p>
          <div className="space-y-3 relative pl-4 border-l border-slate-100 ml-1">
            
            {/* Admin step */}
            {(req.reviewedByAdminName || req.adminNote) && (
              <div className="relative">
                <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white bg-amber-400 ring-4 ring-amber-50" />
                <div className="text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-slate-700">Admin Authorization</span>
                    <span className="text-slate-300">•</span>
                    <span className="text-slate-500">Reviewed by {req.reviewedByAdminName ?? "System"}</span>
                  </div>
                  {req.adminNote && <p className="text-slate-500 mt-1 italic">"{req.adminNote}"</p>}
                </div>
              </div>
            )}

            {/* Director step */}
            {(req.reviewedByDirectorName || req.directorNote) && (
              <div className="relative">
                <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white bg-emerald-500 ring-4 ring-emerald-50" />
                <div className="text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-slate-700">Director Final Audit Release</span>
                    <span className="text-slate-300">•</span>
                    <span className="text-slate-500">Decision by {req.reviewedByDirectorName ?? "System"}</span>
                  </div>
                  {req.directorNote && <p className="text-slate-500 mt-1 italic">"{req.directorNote}"</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Submitted by details & Action buttons footer */}
      <div className="border-t pt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-400">
        <div>
          {req.requestedByName && (
            <span>
              Submitted by <span className="font-semibold text-slate-600">{req.requestedByName}</span>
              {req.agentName && req.agentName !== req.requestedByName && (
                <> (Agent: <span className="font-semibold text-slate-600">{req.agentName}</span>)</>
              )}
            </span>
          )}
        </div>

        {/* Action Button Trigger */}
        {(canAdminReview || canDirectorReview) && (
          <Button
            size="sm"
            onClick={canDirectorReview ? onDirectorReview : onAdminReview}
            className="h-8 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 self-end sm:self-auto rounded-lg px-4"
          >
            {canDirectorReview ? "Perform Release Review" : "Authorize Request"}
          </Button>
        )}
      </div>
    </div>
  );
}
