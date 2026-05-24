import { useState } from "react";
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
    pending_admin:    { label: "Pending Admin",    class: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    pending_director: { label: "Pending Director", class: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
    approved:         { label: "Approved",         class: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
    rejected:         { label: "Rejected",         class: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  };
  const s = map[status] ?? { label: status, class: "bg-muted text-muted-foreground" };
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.class}`}>{s.label}</span>;
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
  const [reviewDialog, setReviewDialog] = useState<ReviewDialogState>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeFilter = filterStatus !== "all" ? filterStatus : undefined;
  const { data, isLoading } = useListEntryChangeRequests(
    activeFilter ? { status: activeFilter } : {},
    { query: { queryKey: getListEntryChangeRequestsQueryKey(activeFilter ? { status: activeFilter } : {}) } },
  );
  const requests = Array.isArray(data) ? data : [];

  const adminReview = useAdminReviewEntryChangeRequest();
  const directorReview = useDirectorReviewEntryChangeRequest();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListEntryChangeRequestsQueryKey({}) });
    if (activeFilter) {
      qc.invalidateQueries({ queryKey: getListEntryChangeRequestsQueryKey({ status: activeFilter }) });
    }
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
  const pendingAdminCount = requests.filter(r => r.status === "pending_admin").length;
  const pendingDirectorCount = requests.filter(r => r.status === "pending_director").length;

  return (
    <>
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {role === "agent"
              ? "Track your requests to amend locked entries"
              : "Review and action entry change requests from agents"}
          </p>
        </div>

        {/* Summary badges for admin/director */}
        {isAdmin && (pendingAdminCount > 0 || pendingDirectorCount > 0) && (
          <div className="flex flex-wrap gap-2 mb-4">
            {pendingAdminCount > 0 && (
              <button
                onClick={() => setFilterStatus("pending_admin")}
                className="flex items-center gap-1.5 text-sm font-medium text-amber-800 bg-amber-100 dark:bg-amber-950 dark:text-amber-300 px-3 py-1.5 rounded-full hover:opacity-80 transition-opacity"
              >
                <span className="w-5 h-5 bg-amber-600 text-white rounded-full flex items-center justify-center text-[11px] font-bold">{pendingAdminCount}</span>
                Awaiting admin review
              </button>
            )}
            {pendingDirectorCount > 0 && role === "director" && (
              <button
                onClick={() => setFilterStatus("pending_director")}
                className="flex items-center gap-1.5 text-sm font-medium text-blue-800 bg-blue-100 dark:bg-blue-950 dark:text-blue-300 px-3 py-1.5 rounded-full hover:opacity-80 transition-opacity"
              >
                <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-[11px] font-bold">{pendingDirectorCount}</span>
                Awaiting director approval
              </button>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-48 h-9 text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending_admin">Pending Admin</SelectItem>
              <SelectItem value="pending_director">Pending Director</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          {filterStatus !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => setFilterStatus("all")}>Clear</Button>
          )}
        </div>

        {/* List */}
        <div className="space-y-3">
          {isLoading ? (
            [1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)
          ) : requests.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <div className="text-4xl mb-3">📋</div>
              <div className="font-medium text-sm">No change requests found</div>
              <div className="text-xs mt-1 text-muted-foreground/60">
                {role === "agent"
                  ? "Tap Request Change on a locked entry to submit one"
                  : "No requests match your filter"}
              </div>
            </div>
          ) : requests.map(req => (
            <RequestCard
              key={req.id}
              req={req}
              role={role}
              onAdminReview={() => openReviewDialog(req, "admin")}
              onDirectorReview={() => openReviewDialog(req, "director")}
            />
          ))}
        </div>
      </div>

      {/* Review Dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={o => { if (!o) setReviewDialog(null); }}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {reviewDialog?.role === "admin" ? "Admin Review" : "Director Review"}
            </DialogTitle>
          </DialogHeader>
          {reviewDialog && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-muted/50 rounded-xl p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Writer</span>
                  <span className="font-mono font-semibold">{reviewDialog.request.writerFullCode ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span>{relDate(reviewDialog.request.entryDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="capitalize">{reviewDialog.request.entryType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current</span>
                  <span className="tabular-nums">{fmtGHS(Number(reviewDialog.request.currentAmount))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Requested</span>
                  <span className="tabular-nums font-semibold text-primary">{fmtGHS(Number(reviewDialog.request.requestedAmount))}</span>
                </div>
                <div className="pt-1.5 border-t border-border">
                  <span className="text-muted-foreground text-xs">Reason: </span>
                  <span className="text-xs">{reviewDialog.request.reason}</span>
                </div>
                {reviewDialog.request.adminNote && reviewDialog.role === "director" && (
                  <div className="pt-1 border-t border-border">
                    <span className="text-muted-foreground text-xs">Admin note: </span>
                    <span className="text-xs">{reviewDialog.request.adminNote}</span>
                  </div>
                )}
              </div>

              {/* Action */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Decision</Label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setReviewAction("approve")}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                      reviewAction === "approve"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    {reviewDialog.role === "admin" ? "Approve & Forward" : "Approve & Apply"}
                  </button>
                  <button
                    onClick={() => setReviewAction("reject")}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                      reviewAction === "reject"
                        ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    Reject
                  </button>
                </div>
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Note <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea
                  value={reviewNote}
                  onChange={e => setReviewNote(e.target.value)}
                  placeholder={reviewAction === "reject" ? "Reason for rejection…" : "Any notes for the next reviewer…"}
                  className="resize-none text-sm h-20 rounded-xl"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setReviewDialog(null)} disabled={submitting}>Cancel</Button>
            <Button
              onClick={handleReview}
              disabled={submitting}
              className={reviewAction === "reject" ? "bg-red-600 hover:bg-red-700" : ""}
            >
              {submitting ? "Submitting…" : reviewAction === "approve" ? (reviewDialog?.role === "admin" ? "Forward to Director" : "Apply Change") : "Reject Request"}
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

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-sm">{req.writerFullCode ?? "Writer"}</span>
            {req.writerFullName && <span className="text-xs text-muted-foreground">{req.writerFullName}</span>}
            {req.agentFullCode && (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">{req.agentFullCode}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {relDate(req.entryDate)} · <span className="capitalize">{req.entryType} entry</span>
          </div>
        </div>
        <StatusBadge status={req.status} />
      </div>

      {/* Amount change */}
      <div className="flex items-center gap-3 bg-muted/40 rounded-xl px-3 py-2.5">
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Current</div>
          <div className="text-sm tabular-nums font-semibold">{fmtGHS(Number(req.currentAmount))}</div>
        </div>
        <svg className="text-muted-foreground flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
        </svg>
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Requested</div>
          <div className="text-sm tabular-nums font-bold text-primary">{fmtGHS(Number(req.requestedAmount))}</div>
        </div>
        <div className="flex-1 text-right">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Diff</div>
          <div className={`text-sm tabular-nums font-semibold ${Number(req.requestedAmount) >= Number(req.currentAmount) ? "text-emerald-600" : "text-red-600"}`}>
            {Number(req.requestedAmount) >= Number(req.currentAmount) ? "+" : ""}
            {fmtGHS(Number(req.requestedAmount) - Number(req.currentAmount))}
          </div>
        </div>
      </div>

      {/* Reason */}
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Reason: </span>{req.reason}
      </div>

      {/* Review trail */}
      {(req.adminNote || req.reviewedByAdminName || req.directorNote || req.reviewedByDirectorName) && (
        <div className="border-t border-border pt-2 space-y-1.5">
          {(req.reviewedByAdminName || req.adminNote) && (
            <div className="text-xs">
              <span className="text-muted-foreground">Admin ({req.reviewedByAdminName ?? "—"}): </span>
              <span>{req.adminNote ?? (req.status === "pending_director" ? "Forwarded to director" : "Reviewed")}</span>
            </div>
          )}
          {(req.reviewedByDirectorName || req.directorNote) && (
            <div className="text-xs">
              <span className="text-muted-foreground">Director ({req.reviewedByDirectorName ?? "—"}): </span>
              <span>{req.directorNote ?? (req.status === "approved" ? "Approved & applied" : "Reviewed")}</span>
            </div>
          )}
        </div>
      )}

      {/* Submitted by (for admin/director view) */}
      {(role === "administrator" || role === "director") && req.requestedByName && (
        <div className="text-xs text-muted-foreground border-t border-border pt-2">
          Submitted by <span className="font-medium text-foreground">{req.requestedByName}</span>
          {req.agentName && req.agentName !== req.requestedByName && (
            <> · Agent: <span className="font-medium text-foreground">{req.agentName}</span></>
          )}
        </div>
      )}

      {/* Action buttons */}
      {(canAdminReview || canDirectorReview) && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={canDirectorReview ? onDirectorReview : onAdminReview}
            className="flex-1 h-9 text-sm"
          >
            {canDirectorReview ? "Final Review" : "Review"}
          </Button>
        </div>
      )}
    </div>
  );
}
