import { useState, useMemo } from "react";
import {
  useListBookletBatches,
  useCreateBookletBatch,
  useListBookletAllocations,
  useCreateBookletAllocation,
  useGetBookletSummary,
  useListBookletAgentBalances,
  useListPadlocks,
  useCreatePadlock,
  useAssignPadlock,
  useListPadlockAssignments,
  useOpenPadlockAssignment,
  useReturnPadlockAssignment,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { fmtGHS } from "@/lib/utils";

export function Inventory() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { agentList } = useWriterLookup();
  const isCashier = user?.role === "cashier" || user?.role === "administrator";

  const [activeTab, setActiveTab] = useState<"overview" | "booklets" | "padlocks">("overview");
  const [bookletSubTab, setBookletSubTab] = useState<"batches" | "allocations" | "balances">("batches");
  const [padlockSubTab, setPadlockSubTab] = useState<"registry" | "assignments">("registry");

  // Query API
  const { data: summary, isLoading: loadingSummary } = useGetBookletSummary();
  const { data: batches, isLoading: loadingBatches } = useListBookletBatches();
  const { data: allocations, isLoading: loadingAllocations } = useListBookletAllocations();
  const { data: agentBalances, isLoading: loadingBalances } = useListBookletAgentBalances();
  const { data: padlocks, isLoading: loadingPadlocks } = useListPadlocks();
  const { data: assignments, isLoading: loadingAssignments } = useListPadlockAssignments();

  // Mutations
  const createBatchMutation = useCreateBookletBatch();
  const createAllocationMutation = useCreateBookletAllocation();
  const createPadlockMutation = useCreatePadlock();
  const assignPadlockMutation = useAssignPadlock();
  const openPadlockMutation = useOpenPadlockAssignment();
  const returnPadlockMutation = useReturnPadlockAssignment();

  // Dialog & Form States
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({ batchDate: new Date().toISOString().split("T")[0], quantity: "", totalCost: "", description: "" });

  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationForm, setAllocationForm] = useState({ agentId: "", allocatedDate: new Date().toISOString().split("T")[0], quantity: "", notes: "" });

  const [padlockOpen, setPadlockOpen] = useState(false);
  const [padlockForm, setPadlockForm] = useState({ serialNumber: "", condition: "good" });

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ agentId: "", destination: "", conditionBefore: "good" });

  const [returnOpen, setReturnOpen] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [returnForm, setReturnForm] = useState({ conditionAfter: "good" });

  // Invalidate cache
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/inventory/booklets/summary"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/booklets/batches"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/booklets/allocations"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/booklets/agent-balances"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/padlocks"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/padlocks/assignments"] });
  };

  // Form Handlers
  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createBatchMutation.mutateAsync({
        data: {
          batchDate: batchForm.batchDate,
          quantity: parseInt(batchForm.quantity),
          totalCost: batchForm.totalCost,
          description: batchForm.description,
        },
      });
      toast.success("Printing batch recorded successfully");
      setBatchOpen(false);
      setBatchForm({ batchDate: new Date().toISOString().split("T")[0], quantity: "", totalCost: "", description: "" });
      invalidateAll();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to create printing batch");
    }
  };

  const handleCreateAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAllocationMutation.mutateAsync({
        data: {
          agentId: allocationForm.agentId,
          allocatedDate: allocationForm.allocatedDate,
          quantity: parseInt(allocationForm.quantity),
          notes: allocationForm.notes,
        },
      });
      toast.success("Booklets allocated to agent successfully");
      setAllocationOpen(false);
      setAllocationForm({ agentId: "", allocatedDate: new Date().toISOString().split("T")[0], quantity: "", notes: "" });
      invalidateAll();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to allocate booklets");
    }
  };

  const handleCreatePadlock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createPadlockMutation.mutateAsync({
        data: {
          serialNumber: padlockForm.serialNumber,
          condition: padlockForm.condition,
        },
      });
      toast.success("Digital padlock registered");
      setPadlockOpen(false);
      setPadlockForm({ serialNumber: "", condition: "good" });
      invalidateAll();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to register padlock");
    }
  };

  const handleAssignPadlock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await assignPadlockMutation.mutateAsync({
        data: {
          agentId: assignForm.agentId,
          destination: assignForm.destination,
          conditionBefore: assignForm.conditionBefore,
        },
      });
      toast.success("Padlock assigned randomly to agent");
      setAssignOpen(false);
      setAssignForm({ agentId: "", destination: "", conditionBefore: "good" });
      invalidateAll();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to assign padlock");
    }
  };

  const handleOpenAssignment = async (id: string) => {
    try {
      await openPadlockMutation.mutateAsync({ id });
      toast.success("Padlock marked as opened at destination");
      invalidateAll();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to record padlock opening");
    }
  };

  const handleReturnAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignmentId) return;
    try {
      await returnPadlockMutation.mutateAsync({
        id: selectedAssignmentId,
        data: {
          conditionAfter: returnForm.conditionAfter,
        },
      });
      toast.success("Padlock marked as returned");
      setReturnOpen(false);
      setSelectedAssignmentId(null);
      setReturnForm({ conditionAfter: "good" });
      invalidateAll();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to record padlock return");
    }
  };

  // Helpers
  const agentMap = useMemo(() => {
    return new Map(agentList.map(a => [a.id, a]));
  }, [agentList]);

  const padlockStats = useMemo(() => {
    if (!padlocks) return { total: 0, available: 0, assigned: 0, broken: 0 };
    let total = padlocks.length;
    let available = padlocks.filter(p => p.status === "available").length;
    let assigned = padlocks.filter(p => p.status === "assigned").length;
    let broken = padlocks.filter(p => p.status === "broken" || p.status === "damaged").length;
    return { total, available, assigned, broken };
  }, [padlocks]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track printing expenses, booklets distribution, and manage digital padlocks allocations.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-muted p-1 rounded-xl self-start sm:self-center">
          {[
            { id: "overview", label: "Overview" },
            { id: "booklets", label: "Booklets" },
            { id: "padlocks", label: "Digital Padlocks" },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── TAB: OVERVIEW ─── */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Booklet Summaries Grid */}
          <div className="space-y-3">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <div className="w-1.5 h-4 bg-emerald-500 rounded-full" />
              Lottery Booklet Inventory
            </h2>
            {loadingSummary ? (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-24 rounded-2xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {[
                  { label: "Booklets Stocked", value: summary?.totalStocked ?? 0, sub: "Total restocked count", color: "text-foreground" },
                  { label: "Booklets Allocated", value: summary?.totalAllocated ?? 0, sub: "Total assigned to agents", color: "text-indigo-600 dark:text-indigo-400" },
                  { label: "Cashier Stock", value: summary?.cashierStockRemaining ?? 0, sub: "Available for allocation", color: "text-emerald-600 dark:text-emerald-400 font-bold" },
                  { label: "Booklets Used", value: summary?.totalUsedByAgents ?? 0, sub: "Logged in Gross Sales", color: "text-amber-600 dark:text-amber-400" },
                  { label: "Agent Hand Stock", value: summary?.agentStockRemaining ?? 0, sub: "Remaining with agents", color: "text-blue-600 dark:text-blue-400 font-bold" },
                ].map((c, idx) => (
                  <div key={idx} className="bg-card border rounded-2xl p-4 shadow-sm flex flex-col justify-between h-24">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{c.label}</div>
                    <div className={`font-mono text-xl font-black mt-1 ${c.color}`}>{c.value}</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">{c.sub}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Padlocks Summaries Grid */}
          <div className="space-y-3 pt-2">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
              Digital Padlock Inventory
            </h2>
            {loadingPadlocks ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <Skeleton key={i} className="h-24 rounded-2xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Registered Padlocks", value: padlockStats.total, sub: "Total padlocks in system", color: "text-foreground" },
                  { label: "Available Registry", value: padlockStats.available, sub: "Ready for random allocation", color: "text-emerald-600 dark:text-emerald-400 font-bold" },
                  { label: "Currently Assigned", value: padlockStats.assigned, sub: "In-use at destinations", color: "text-blue-600 dark:text-blue-400" },
                  { label: "Damaged / Broken", value: padlockStats.broken, sub: "Excluded from assignments", color: "text-rose-600 dark:text-rose-400" },
                ].map((c, idx) => (
                  <div key={idx} className="bg-card border rounded-2xl p-4 shadow-sm flex flex-col justify-between h-24">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{c.label}</div>
                    <div className={`font-mono text-xl font-black mt-1 ${c.color}`}>{c.value}</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">{c.sub}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: BOOKLETS ─── */}
      {activeTab === "booklets" && (
        <div className="space-y-5">
          {/* Sub tab navigation */}
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex gap-4">
              {[
                { id: "batches", label: "Printing Expenses (Restocks)" },
                { id: "allocations", label: "Weekly Allocations" },
                { id: "balances", label: "Agent Booklet Balances" },
              ].map(sub => (
                <button
                  key={sub.id}
                  onClick={() => setBookletSubTab(sub.id as any)}
                  className={`text-xs font-bold uppercase tracking-wider pb-2 border-b-2 transition-all ${
                    bookletSubTab === sub.id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {isCashier && bookletSubTab !== "balances" && (
              <Button
                size="sm"
                onClick={() => {
                  if (bookletSubTab === "batches") setBatchOpen(true);
                  else if (bookletSubTab === "allocations") setAllocationOpen(true);
                }}
              >
                {bookletSubTab === "batches" ? "Record Printing Expense" : "Allocate Booklets"}
              </Button>
            )}
          </div>

          {/* Sub Tab: Printing Batches */}
          {bookletSubTab === "batches" && (
            <div className="border rounded-xl overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Printing Date</TableHead>
                    <TableHead className="text-right">Quantity Printed</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead className="text-right">Cost Per Booklet</TableHead>
                    <TableHead className="pl-6">Notes / Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingBatches ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : !batches || batches.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No printing restocks recorded.</TableCell></TableRow>
                  ) : (
                    batches.map(batch => (
                      <TableRow key={batch.id}>
                        <TableCell className="text-sm font-medium">{batch.batchDate}</TableCell>
                        <TableCell className="text-sm text-right font-mono">{batch.quantity}</TableCell>
                        <TableCell className="text-sm text-right font-mono">{fmtGHS(Number(batch.totalCost))}</TableCell>
                        <TableCell className="text-sm text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{fmtGHS(Number(batch.costPerBooklet))}</TableCell>
                        <TableCell className="text-sm text-muted-foreground pl-6 truncate max-w-xs">{batch.description ?? "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Sub Tab: Allocations */}
          {bookletSubTab === "allocations" && (
            <div className="border rounded-xl overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Allocated Date</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Quantity Allocated</TableHead>
                    <TableHead className="pl-8">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingAllocations ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : !allocations || allocations.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No booklet allocations logged.</TableCell></TableRow>
                  ) : (
                    allocations.map(alloc => {
                      const agent = agentMap.get(alloc.agentId);
                      return (
                        <TableRow key={alloc.id}>
                          <TableCell className="text-sm font-medium">{alloc.allocatedDate}</TableCell>
                          <TableCell className="text-sm">
                            <span className="font-mono font-semibold">{agent?.fullCode ?? alloc.agentId.slice(0, 8)}</span>
                            {agent && <span className="text-xs text-muted-foreground ml-2">({agent.agencyName || agent.user?.fullName})</span>}
                          </TableCell>
                          <TableCell className="text-sm text-right font-mono font-bold">{alloc.quantity}</TableCell>
                          <TableCell className="text-sm text-muted-foreground pl-8 truncate max-w-xs">{alloc.notes ?? "—"}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Sub Tab: Balances */}
          {bookletSubTab === "balances" && (
            <div className="border rounded-xl overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent Code</TableHead>
                    <TableHead>Agency Name</TableHead>
                    <TableHead className="text-right">Total Allocated</TableHead>
                    <TableHead className="text-right">Total Used</TableHead>
                    <TableHead className="text-right">Booklet Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingBalances ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : !agentBalances || agentBalances.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No agents registered.</TableCell></TableRow>
                  ) : (
                    agentBalances.map(bal => (
                      <TableRow key={bal.agentId}>
                        <TableCell className="text-sm font-mono font-bold">{bal.agentCode}</TableCell>
                        <TableCell className="text-sm font-medium">{bal.agencyName ?? "—"}</TableCell>
                        <TableCell className="text-sm text-right font-mono">{bal.totalAllocated}</TableCell>
                        <TableCell className="text-sm text-right font-mono text-amber-600 dark:text-amber-400">{bal.totalUsed}</TableCell>
                        <TableCell className={`text-sm text-right font-mono font-bold ${bal.balance === 0 ? "text-rose-500" : "text-green-600 dark:text-green-400"}`}>{bal.balance}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: PADLOCKS ─── */}
      {activeTab === "padlocks" && (
        <div className="space-y-5">
          {/* Sub tab navigation */}
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex gap-4">
              {[
                { id: "registry", label: "Registry" },
                { id: "assignments", label: "Assignment History" },
              ].map(sub => (
                <button
                  key={sub.id}
                  onClick={() => setPadlockSubTab(sub.id as any)}
                  className={`text-xs font-bold uppercase tracking-wider pb-2 border-b-2 transition-all ${
                    padlockSubTab === sub.id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {isCashier && (
              <Button
                size="sm"
                onClick={() => {
                  if (padlockSubTab === "registry") setPadlockOpen(true);
                  else if (padlockSubTab === "assignments") setAssignOpen(true);
                }}
              >
                {padlockSubTab === "registry" ? "Register Padlock" : "Assign Padlock Randomly"}
              </Button>
            )}
          </div>

          {/* Sub Tab: Registry */}
          {padlockSubTab === "registry" && (
            <div className="border rounded-xl overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Serial Number</TableHead>
                    <TableHead>Registry Status</TableHead>
                    <TableHead>Physical Condition</TableHead>
                    <TableHead>Registered Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPadlocks ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : !padlocks || padlocks.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No padlocks registered in inventory.</TableCell></TableRow>
                  ) : (
                    padlocks.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm font-mono font-bold">{p.serialNumber}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              p.status === "available"
                                ? "default"
                                : p.status === "assigned"
                                ? "secondary"
                                : "destructive"
                            }
                            className="text-xs uppercase"
                          >
                            {p.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-xs uppercase font-semibold ${
                              p.condition === "good"
                                ? "text-green-600 border-green-200 bg-green-50/50"
                                : "text-amber-600 border-amber-200 bg-amber-50/50"
                            }`}
                          >
                            {p.condition}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-GB") : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Sub Tab: Assignments */}
          {padlockSubTab === "assignments" && (
            <div className="border rounded-xl overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Serial Number</TableHead>
                    <TableHead>Assigned Agent</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Cond. Before</TableHead>
                    <TableHead>Cond. After</TableHead>
                    <TableHead>Timestamps (Assigned · Opened · Returned)</TableHead>
                    {isCashier && <TableHead className="w-36 text-center">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingAssignments ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : !assignments || assignments.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">No padlock assignments found.</TableCell></TableRow>
                  ) : (
                    assignments.map(a => {
                      const assignedDate = new Date(a.assignedAt);
                      const openedDate = a.openedAt ? new Date(a.openedAt) : null;
                      const returnedDate = a.returnedAt ? new Date(a.returnedAt) : null;

                      return (
                        <TableRow key={a.id}>
                          <TableCell className="text-sm font-mono font-semibold">{a.padlockSerialNumber}</TableCell>
                          <TableCell className="text-sm font-semibold">
                            <span className="font-mono">{a.agentCode}</span>
                            {a.agencyName && <span className="text-xs text-muted-foreground ml-1.5">({a.agencyName})</span>}
                          </TableCell>
                          <TableCell className="text-sm truncate max-w-[120px]">{a.destination}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] uppercase">{a.conditionBefore}</Badge>
                          </TableCell>
                          <TableCell>
                            {a.conditionAfter ? (
                              <Badge variant="outline" className="text-[10px] uppercase">{a.conditionAfter}</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground space-y-0.5">
                            <div>
                              <span className="font-medium text-foreground">Assigned:</span>{" "}
                              {assignedDate.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                            </div>
                            {openedDate && (
                              <div>
                                <span className="font-medium text-foreground">Opened:</span>{" "}
                                {openedDate.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                              </div>
                            )}
                            {returnedDate && (
                              <div>
                                <span className="font-medium text-foreground">Returned:</span>{" "}
                                {returnedDate.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                              </div>
                            )}
                          </TableCell>
                          {isCashier && (
                            <TableCell className="text-center">
                              <div className="flex justify-center gap-1.5">
                                {!a.openedAt && !a.returnedAt && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenAssignment(a.id)}
                                    className="text-[11px] h-7"
                                    disabled={openPadlockMutation.isPending}
                                  >
                                    Mark Opened
                                  </Button>
                                )}
                                {!a.returnedAt && (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setSelectedAssignmentId(a.id);
                                      setReturnOpen(true);
                                    }}
                                    className="text-[11px] h-7 bg-amber-600 hover:bg-amber-700"
                                  >
                                    Return
                                  </Button>
                                )}
                                {a.returnedAt && (
                                  <Badge variant="secondary" className="text-[10px] uppercase px-2 py-0.5">Returned</Badge>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* ─── FORM MODALS ─── */}

      {/* Booklet Batch Modal */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Record printing booklets expense</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateBatch} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Printing Date</Label>
              <Input
                type="date"
                value={batchForm.batchDate}
                onChange={e => setBatchForm(prev => ({ ...prev, batchDate: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Quantity Printed</Label>
              <Input
                type="number"
                min="1"
                placeholder="e.g. 500"
                value={batchForm.quantity}
                onChange={e => setBatchForm(prev => ({ ...prev, quantity: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Total Cost (GH₵)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="e.g. 1250.00"
                value={batchForm.totalCost}
                onChange={e => setBatchForm(prev => ({ ...prev, totalCost: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes / Description</Label>
              <Input
                placeholder="e.g. Vision 2000 books batch A"
                value={batchForm.description}
                onChange={e => setBatchForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBatchOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createBatchMutation.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Booklet Allocation Modal */}
      <Dialog open={allocationOpen} onOpenChange={setAllocationOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Allocate booklets to agent</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateAllocation} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Select Agent</Label>
              <Select
                value={allocationForm.agentId}
                onValueChange={agentId => setAllocationForm(prev => ({ ...prev, agentId }))}
              >
                <SelectTrigger><SelectValue placeholder="Choose agent..." /></SelectTrigger>
                <SelectContent>
                  {agentList.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.user?.fullName ?? a.fullCode} ({a.fullCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Allocation Date</Label>
              <Input
                type="date"
                value={allocationForm.allocatedDate}
                onChange={e => setAllocationForm(prev => ({ ...prev, allocatedDate: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Quantity Allocated</Label>
              <Input
                type="number"
                min="1"
                placeholder="e.g. 50"
                value={allocationForm.quantity}
                onChange={e => setAllocationForm(prev => ({ ...prev, quantity: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Input
                placeholder="e.g. Weekly allotment for Monday Special"
                value={allocationForm.notes}
                onChange={e => setAllocationForm(prev => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAllocationOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createAllocationMutation.isPending || !allocationForm.agentId}>Allocate</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Padlock Registry Modal */}
      <Dialog open={padlockOpen} onOpenChange={setPadlockOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Register Digital Padlock</DialogTitle></DialogHeader>
          <form onSubmit={handleCreatePadlock} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Serial Number / Unique ID</Label>
              <Input
                placeholder="e.g. PDL-9981-A"
                value={padlockForm.serialNumber}
                onChange={e => setPadlockForm(prev => ({ ...prev, serialNumber: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Condition Registry</Label>
              <Select
                value={padlockForm.condition}
                onValueChange={condition => setPadlockForm(prev => ({ ...prev, condition }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good / Functional</SelectItem>
                  <SelectItem value="damaged">Damaged / Needs repair</SelectItem>
                  <SelectItem value="broken">Broken / Out of order</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPadlockOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createPadlockMutation.isPending}>Register</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Padlock Assign Modal */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Assign padlock randomly</DialogTitle></DialogHeader>
          <form onSubmit={handleAssignPadlock} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Assign To Agent</Label>
              <Select
                value={assignForm.agentId}
                onValueChange={agentId => setAssignForm(prev => ({ ...prev, agentId }))}
              >
                <SelectTrigger><SelectValue placeholder="Select agent..." /></SelectTrigger>
                <SelectContent>
                  {agentList.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.user?.fullName ?? a.fullCode} ({a.fullCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Assigned Destination</Label>
              <Input
                placeholder="e.g. Kumasi Branch Office"
                value={assignForm.destination}
                onChange={e => setAssignForm(prev => ({ ...prev, destination: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Condition Before Assignment</Label>
              <Select
                value={assignForm.conditionBefore}
                onValueChange={conditionBefore => setAssignForm(prev => ({ ...prev, conditionBefore }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="damaged">Damaged</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={assignPadlockMutation.isPending || !assignForm.agentId}>
                {assignPadlockMutation.isPending ? "Assigning Randomly..." : "Assign Random Padlock"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Padlock Return Modal */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle>Record padlock return</DialogTitle></DialogHeader>
          <form onSubmit={handleReturnAssignment} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Condition After Use</Label>
              <Select
                value={returnForm.conditionAfter}
                onValueChange={conditionAfter => setReturnForm(prev => ({ ...prev, conditionAfter }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good / Perfect</SelectItem>
                  <SelectItem value="damaged">Damaged / Dented</SelectItem>
                  <SelectItem value="broken">Broken / Unusable</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setReturnOpen(false); setSelectedAssignmentId(null); }}>Cancel</Button>
              <Button type="submit" disabled={returnPadlockMutation.isPending} className="bg-amber-600 hover:bg-amber-700">Record Return</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
