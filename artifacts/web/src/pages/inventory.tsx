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
  useUpdatePadlockAssignment,
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
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { fmtGHS } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package,
  Lock,
  Key,
  Edit,
  RefreshCw,
  BarChart2,
  Plus,
  Calendar,
  MapPin,
  CheckCircle,
  ShieldAlert,
  AlertTriangle,
  Layers,
  UserCheck,
  ShieldCheck,
  TrendingUp,
  Settings2,
  FileSpreadsheet,
  AlertCircle,
  FolderLock
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

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
  const updateAssignmentMutation = useUpdatePadlockAssignment();

  // Dialog & Form States
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({
    batchDate: new Date().toISOString().split("T")[0],
    quantity: "",
    totalCost: "",
    description: ""
  });

  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationForm, setAllocationForm] = useState({
    agentId: "",
    allocatedDate: new Date().toISOString().split("T")[0],
    quantity: "",
    notes: ""
  });

  const [padlockOpen, setPadlockOpen] = useState(false);
  const [padlockForm, setPadlockForm] = useState({
    serialNumber: "",
    brandName: "",
    lockType: "new",
    condition: "good"
  });

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({
    agentId: "",
    destination: "",
    conditionBefore: "good"
  });

  const [returnOpen, setReturnOpen] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [returnForm, setReturnForm] = useState({ conditionAfter: "Intact" });

  // Assignment Editing Dialog State
  const [editOpen, setEditOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    padlockId: "",
    agentId: "",
    destination: "",
    conditionBefore: "good",
    conditionAfter: "Intact",
    assignedAt: "",
    openedAt: "",
    returnedAt: ""
  });

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
          brandName: padlockForm.brandName,
          lockType: padlockForm.lockType,
          condition: padlockForm.condition,
        },
      });
      toast.success("Digital padlock registered");
      setPadlockOpen(false);
      setPadlockForm({ serialNumber: "", brandName: "", lockType: "new", condition: "good" });
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
      setReturnForm({ conditionAfter: "Intact" });
      invalidateAll();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to record padlock return");
    }
  };

  const handleOpenEditModal = (a: any) => {
    setSelectedAssignment(a);
    setEditForm({
      padlockId: a.padlockId || "",
      agentId: a.agentId || "",
      destination: a.destination || "",
      conditionBefore: a.conditionBefore || "good",
      conditionAfter: a.conditionAfter || "Intact",
      assignedAt: a.assignedAt ? new Date(a.assignedAt).toISOString().slice(0, 16) : "",
      openedAt: a.openedAt ? new Date(a.openedAt).toISOString().slice(0, 16) : "",
      returnedAt: a.returnedAt ? new Date(a.returnedAt).toISOString().slice(0, 16) : "",
    });
    setEditOpen(true);
  };

  const handleUpdateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignment) return;
    try {
      await updateAssignmentMutation.mutateAsync({
        id: selectedAssignment.id,
        data: {
          padlockId: editForm.padlockId,
          agentId: editForm.agentId,
          destination: editForm.destination,
          conditionBefore: editForm.conditionBefore,
          conditionAfter: editForm.conditionAfter || undefined,
          assignedAt: editForm.assignedAt ? new Date(editForm.assignedAt).toISOString() : new Date().toISOString(),
          openedAt: editForm.openedAt ? new Date(editForm.openedAt).toISOString() : null,
          returnedAt: editForm.returnedAt ? new Date(editForm.returnedAt).toISOString() : null,
        },
      });
      toast.success("Padlock assignment updated successfully");
      setEditOpen(false);
      setSelectedAssignment(null);
      invalidateAll();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to update padlock assignment");
    }
  };

  // Helpers & Calculations
  const agentMap = useMemo(() => {
    return new Map(agentList.map(a => [a.id, a]));
  }, [agentList]);

  const padlockStats = useMemo(() => {
    if (!padlocks) return { total: 0, available: 0, assigned: 0, broken: 0 };
    const total = padlocks.length;
    const available = padlocks.filter(p => p.status === "available").length;
    const assigned = padlocks.filter(p => p.status === "assigned").length;
    const broken = padlocks.filter(p => p.status === "broken" || p.status === "damaged").length;
    return { total, available, assigned, broken };
  }, [padlocks]);

  // Visual Buffers Rates
  const totalStocked = summary?.totalStocked ?? 0;
  const totalAllocated = summary?.totalAllocated ?? 0;
  const totalUsed = summary?.totalUsedByAgents ?? 0;
  const cashierStock = summary?.cashierStockRemaining ?? 0;
  const agentStock = summary?.agentStockRemaining ?? 0;

  const allocationRate = totalStocked > 0 ? Math.round((totalAllocated / totalStocked) * 100) : 0;
  const usageRate = totalAllocated > 0 ? Math.round((totalUsed / totalAllocated) * 100) : 0;
  const cashierReserveRate = totalStocked > 0 ? Math.round((cashierStock / totalStocked) * 100) : 0;

  const pTotal = padlockStats.total;
  const pAvailable = padlockStats.available;
  const pAssigned = padlockStats.assigned;
  const pBroken = padlockStats.broken;

  const availabilityRate = pTotal > 0 ? Math.round((pAvailable / pTotal) * 100) : 0;
  const utilizationRate = pTotal > 0 ? Math.round((pAssigned / pTotal) * 100) : 0;
  const damagedRate = pTotal > 0 ? Math.round((pBroken / pTotal) * 100) : 0;

  const bookletChartData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Cashier Reserve", value: summary.cashierStockRemaining ?? 0, color: "#10b981" },
      { name: "Agent Stock", value: summary.agentStockRemaining ?? 0, color: "#3b82f6" },
      { name: "Booklets Used", value: summary.totalUsedByAgents ?? 0, color: "#f59e0b" },
    ];
  }, [summary]);

  const padlockChartData = useMemo(() => {
    return [
      { name: "Available Registry", value: padlockStats.available, color: "#10b981" },
      { name: "Currently Assigned", value: padlockStats.assigned, color: "#6366f1" },
      { name: "Damaged / Broken", value: padlockStats.broken, color: "#f43f5e" },
    ];
  }, [padlockStats]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background/95 border border-border shadow-lg p-3 rounded-xl text-xs backdrop-blur-sm">
          <p className="font-semibold text-foreground">{payload[0].name}</p>
          <p className="text-muted-foreground font-mono mt-1">
            Count: <span className="font-black text-primary">{payload[0].value}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border border-border/80 bg-card/60 backdrop-blur-md p-6 rounded-3xl shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl shadow-inner border border-primary/10">
            <Package className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-foreground bg-gradient-to-r from-foreground via-foreground/90 to-foreground/75 bg-clip-text">
              Inventory Management
            </h1>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              Track booklets printing expenses, allocate restocks weekly, and audit smart padlock flows.
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-muted/80 border p-1 rounded-2xl self-start lg:self-center gap-1">
          {[
            { id: "overview", label: "Overview", icon: <BarChart2 className="w-3.5 h-3.5" /> },
            { id: "booklets", label: "Booklets", icon: <FileSpreadsheet className="w-3.5 h-3.5" /> },
            { id: "padlocks", label: "Digital Padlocks", icon: <Lock className="w-3.5 h-3.5" /> },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm scale-102 border border-border/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/20"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── TAB: OVERVIEW ─── */}
      <AnimatePresence mode="wait">
        {activeTab === "overview" && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            {/* BOOKLET INVENTORY PANEL */}
            <div className="border border-border/80 bg-card rounded-3xl p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-6 bg-emerald-500 rounded-full shadow-glow" />
                  <div>
                    <h2 className="text-lg font-bold text-foreground">Lottery Booklet Logs</h2>
                    <p className="text-[11px] text-muted-foreground">Detailed status of physical lottery booklet volumes</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs bg-emerald-50/50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-200">
                  <TrendingUp className="w-3 h-3 mr-1" /> Active Circulation
                </Badge>
              </div>

              {/* Cards Grid */}
              {loadingSummary ? (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <Skeleton key={i} className="h-24 rounded-2xl" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                  {[
                    { label: "Total Booklets Stocked", value: summary?.totalStocked ?? 0, sub: "Total cashier restock", color: "text-foreground border-l-slate-300 dark:border-l-slate-800" },
                    { label: "Booklets Allocated", value: summary?.totalAllocated ?? 0, sub: "Allotted to agents pool", color: "text-indigo-600 dark:text-indigo-400 border-l-indigo-500" },
                    { label: "Cashier Stock Remaining", value: summary?.cashierStockRemaining ?? 0, sub: "Reserve ready to assign", color: "text-emerald-600 dark:text-emerald-400 border-l-emerald-500 font-bold" },
                    { label: "Booklets Sold / Used", value: summary?.totalUsedByAgents ?? 0, sub: "Reported in writer gross", color: "text-amber-600 dark:text-amber-400 border-l-amber-500" },
                    { label: "Agent Hand Stock", value: summary?.agentStockRemaining ?? 0, sub: "Current stock with agents", color: "text-blue-600 dark:text-blue-400 border-l-blue-500 font-bold" },
                  ].map((c, idx) => (
                    <div key={idx} className={`bg-card/45 border-l-4 ${c.color} border border-y-border border-r-border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between h-28`}>
                      <div className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">{c.label}</div>
                      <div className="font-mono text-2xl font-black tracking-tight mt-1">{c.value}</div>
                      <div className="text-[10px] text-muted-foreground font-medium mt-1">{c.sub}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Chart & Buffer Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                <div className="lg:col-span-5 border rounded-2xl p-5 bg-card/30 flex flex-col items-center justify-center min-h-[300px]">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Stock Breakdown</h3>
                  {loadingSummary ? (
                    <Skeleton className="w-48 h-48 rounded-full" />
                  ) : bookletChartData.length === 0 || totalStocked === 0 ? (
                    <div className="text-xs text-muted-foreground italic">No booklets logged to display chart</div>
                  ) : (
                    <div className="w-full h-56 relative flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={bookletChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={65}
                            outerRadius={85}
                            paddingAngle={4}
                            dataKey="value"
                          >
                            {bookletChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute text-center">
                        <span className="text-2xl font-black tracking-tight">{totalStocked}</span>
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest mt-0.5">Total</p>
                      </div>
                    </div>
                  )}

                  {/* Chart Legend */}
                  <div className="flex flex-wrap justify-center gap-4 mt-2">
                    {bookletChartData.map((d, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs font-bold">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="text-muted-foreground">{d.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-7 border rounded-2xl p-6 bg-card/30 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-6">Circulation Buffers</h3>
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-muted-foreground flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-indigo-500" /> Booklet Allocation Rate</span>
                          <span className="text-indigo-600 dark:text-indigo-400">{allocationRate}%</span>
                        </div>
                        <Progress value={allocationRate} className="h-2 bg-muted [&>div]:bg-indigo-600 dark:[&>div]:bg-indigo-400" />
                        <p className="text-[10px] text-muted-foreground font-medium">Allocated to agents vs. overall system reserve</p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-muted-foreground flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-amber-500" /> Sales Usage Rate</span>
                          <span className="text-amber-600 dark:text-amber-400">{usageRate}%</span>
                        </div>
                        <Progress value={usageRate} className="h-2 bg-muted [&>div]:bg-amber-500" />
                        <p className="text-[10px] text-muted-foreground font-medium">Allotted booklets reported sold in sales sheets</p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-muted-foreground flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Cashier Reserve Level</span>
                          <span className="text-emerald-600 dark:text-emerald-400">{cashierReserveRate}%</span>
                        </div>
                        <Progress value={cashierReserveRate} className="h-2 bg-muted [&>div]:bg-emerald-500" />
                        <p className="text-[10px] text-muted-foreground font-medium">Unallocated restock volume in central vault</p>
                      </div>
                    </div>
                  </div>
                  <div className="border-t pt-4 mt-6 flex justify-between items-center text-[11px] text-muted-foreground font-medium">
                    <span className="flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 text-primary" /> Keep reserve rates above 20% to prevent distribution delays.</span>
                  </div>
                </div>
              </div>
            </div>

            {/* PADLOCK INVENTORY PANEL */}
            <div className="border border-border/80 bg-card rounded-3xl p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-6 bg-blue-500 rounded-full shadow-glow" />
                  <div>
                    <h2 className="text-lg font-bold text-foreground">Digital Padlock Auditor</h2>
                    <p className="text-[11px] text-muted-foreground">Operational status and location pin stats</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs bg-blue-50/50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400 border-blue-200">
                  <Lock className="w-3 h-3 mr-1" /> Smart Hardware Security
                </Badge>
              </div>

              {/* Cards Grid */}
              {loadingPadlocks ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[1, 2, 3, 4].map(i => (
                    <Skeleton key={i} className="h-24 rounded-2xl" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Registered Padlocks", value: padlockStats.total, sub: "Active smart lock tags", color: "text-foreground border-l-slate-300 dark:border-l-slate-800" },
                    { label: "Available Registry", value: padlockStats.available, sub: "Available in warehouse pool", color: "text-emerald-600 dark:text-emerald-400 border-l-emerald-500 font-bold" },
                    { label: "Currently Assigned", value: padlockStats.assigned, sub: "Actively tagged to trips", color: "text-indigo-600 dark:text-indigo-400 border-l-indigo-500 font-bold" },
                    { label: "Damaged / Broken", value: padlockStats.broken, sub: "Flagged for repairs", color: "text-rose-600 dark:text-rose-400 border-l-rose-500" },
                  ].map((c, idx) => (
                    <div key={idx} className={`bg-card/45 border-l-4 ${c.color} border border-y-border border-r-border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between h-28`}>
                      <div className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">{c.label}</div>
                      <div className="font-mono text-2xl font-black tracking-tight mt-1">{c.value}</div>
                      <div className="text-[10px] text-muted-foreground font-medium mt-1">{c.sub}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Chart & Buffer Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                <div className="lg:col-span-5 border rounded-2xl p-5 bg-card/30 flex flex-col items-center justify-center min-h-[300px]">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Hardware Distribution</h3>
                  {loadingPadlocks ? (
                    <Skeleton className="w-48 h-48 rounded-full" />
                  ) : padlockStats.total === 0 ? (
                    <div className="text-xs text-muted-foreground italic">No registered padlocks in system</div>
                  ) : (
                    <div className="w-full h-56 relative flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={padlockChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={65}
                            outerRadius={85}
                            paddingAngle={4}
                            dataKey="value"
                          >
                            {padlockChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute text-center">
                        <span className="text-2xl font-black tracking-tight">{padlockStats.total}</span>
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest mt-0.5">Total</p>
                      </div>
                    </div>
                  )}

                  {/* Chart Legend */}
                  <div className="flex flex-wrap justify-center gap-4 mt-2">
                    {padlockChartData.map((d, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs font-bold">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="text-muted-foreground">{d.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-7 border rounded-2xl p-6 bg-card/30 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-6">Lock Status Buffers</h3>
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-muted-foreground flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Operational Availability</span>
                          <span className="text-emerald-600 dark:text-emerald-400">{availabilityRate}%</span>
                        </div>
                        <Progress value={availabilityRate} className="h-2 bg-muted [&>div]:bg-emerald-500" />
                        <p className="text-[10px] text-muted-foreground font-medium">Ready padlocks currently free in central lockers</p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-muted-foreground flex items-center gap-1.5"><Key className="w-3.5 h-3.5 text-indigo-500" /> Active Assignment Rate</span>
                          <span className="text-indigo-600 dark:text-indigo-400">{utilizationRate}%</span>
                        </div>
                        <Progress value={utilizationRate} className="h-2 bg-muted [&>div]:bg-indigo-600 dark:[&>div]:bg-indigo-400" />
                        <p className="text-[10px] text-muted-foreground font-medium">Assigned to agents currently en route to destination</p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-muted-foreground flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-rose-500" /> Out-of-Service Rate</span>
                          <span className="text-rose-600 dark:text-rose-400">{damagedRate}%</span>
                        </div>
                        <Progress value={damagedRate} className="h-2 bg-muted [&>div]:bg-rose-500" />
                        <p className="text-[10px] text-muted-foreground font-medium">Flagged damaged or broken, excluded from selection</p>
                      </div>
                    </div>
                  </div>
                  <div className="border-t pt-4 mt-6 flex justify-between items-center text-[11px] text-muted-foreground font-medium">
                    <span className="flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5 text-primary" /> Damaged locks require technical audit and reset.</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ─── TAB: BOOKLETS ─── */}
        {activeTab === "booklets" && (
          <motion.div
            key="booklets"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            {/* Sub tab navigation */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-3">
              <div className="flex bg-muted/50 p-1 border rounded-xl gap-1">
                {[
                  { id: "batches", label: "Printing Expenses (Restocks)" },
                  { id: "allocations", label: "Weekly Allocations" },
                  { id: "balances", label: "Agent Booklet Balances" },
                ].map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setBookletSubTab(sub.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                      bookletSubTab === sub.id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
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
                  className="rounded-xl font-bold text-xs uppercase"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  {bookletSubTab === "batches" ? "Record Printing Expense" : "Allocate Booklets"}
                </Button>
              )}
            </div>

            {/* Sub Tab: Printing Batches */}
            {bookletSubTab === "batches" && (
              <div className="border border-border/80 rounded-2xl overflow-hidden bg-card/65 shadow-sm">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="font-bold">Printing Date</TableHead>
                      <TableHead className="text-right font-bold">Quantity Printed</TableHead>
                      <TableHead className="text-right font-bold">Total Cost</TableHead>
                      <TableHead className="text-right font-bold">Cost Per Booklet</TableHead>
                      <TableHead className="pl-8 font-bold">Notes / Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingBatches ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-12">
                        <Skeleton className="h-6 w-1/2 mx-auto" />
                      </TableCell></TableRow>
                    ) : !batches || batches.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground text-xs italic">No printing restocks recorded.</TableCell></TableRow>
                    ) : (
                      batches.map(batch => (
                        <TableRow key={batch.id} className="hover:bg-muted/20 transition-colors">
                          <TableCell className="text-xs font-semibold">{batch.batchDate}</TableCell>
                          <TableCell className="text-xs text-right font-mono font-bold">{batch.quantity}</TableCell>
                          <TableCell className="text-xs text-right font-mono font-semibold">{fmtGHS(Number(batch.totalCost))}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-emerald-600 dark:text-emerald-400 font-extrabold">{fmtGHS(Number(batch.costPerBooklet))}</TableCell>
                          <TableCell className="text-xs text-muted-foreground pl-8 truncate max-w-xs">{batch.description ?? "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Sub Tab: Allocations */}
            {bookletSubTab === "allocations" && (
              <div className="border border-border/80 rounded-2xl overflow-hidden bg-card/65 shadow-sm">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="font-bold">Allocated Date</TableHead>
                      <TableHead className="font-bold">Agent</TableHead>
                      <TableHead className="text-right font-bold">Quantity Allocated</TableHead>
                      <TableHead className="pl-8 font-bold">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingAllocations ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-12">
                        <Skeleton className="h-6 w-1/2 mx-auto" />
                      </TableCell></TableRow>
                    ) : !allocations || allocations.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground text-xs italic">No booklet allocations logged.</TableCell></TableRow>
                    ) : (
                      allocations.map(alloc => {
                        const agent = agentMap.get(alloc.agentId);
                        return (
                          <TableRow key={alloc.id} className="hover:bg-muted/20 transition-colors">
                            <TableCell className="text-xs font-semibold">{alloc.allocatedDate}</TableCell>
                            <TableCell className="text-xs">
                              <span className="font-mono font-bold text-foreground bg-muted/60 px-2 py-0.5 rounded-md border">{agent?.fullCode ?? alloc.agentId.slice(0, 8)}</span>
                              {agent && <span className="text-[11px] text-muted-foreground ml-2">({agent.agencyName || agent.user?.fullName})</span>}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono font-extrabold">{alloc.quantity}</TableCell>
                            <TableCell className="text-xs text-muted-foreground pl-8 truncate max-w-xs">{alloc.notes ?? "—"}</TableCell>
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
              <div className="border border-border/80 rounded-2xl overflow-hidden bg-card/65 shadow-sm">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="font-bold">Agent Code</TableHead>
                      <TableHead className="font-bold">Agency Name</TableHead>
                      <TableHead className="text-right font-bold">Total Allocated</TableHead>
                      <TableHead className="text-right font-bold">Total Used</TableHead>
                      <TableHead className="text-right font-bold">Booklet Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingBalances ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-12">
                        <Skeleton className="h-6 w-1/2 mx-auto" />
                      </TableCell></TableRow>
                    ) : !agentBalances || agentBalances.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground text-xs italic">No agent balances found.</TableCell></TableRow>
                    ) : (
                      agentBalances.map(bal => (
                        <TableRow key={bal.agentId} className="hover:bg-muted/20 transition-colors">
                          <TableCell className="text-xs font-mono font-black">{bal.agentCode}</TableCell>
                          <TableCell className="text-xs font-semibold">{bal.agencyName ?? "—"}</TableCell>
                          <TableCell className="text-xs text-right font-mono font-medium">{bal.totalAllocated}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-amber-500 font-bold">{bal.totalUsed}</TableCell>
                          <TableCell className={`text-xs text-right font-mono font-black ${bal.balance === 0 ? "text-rose-500" : "text-green-600 dark:text-green-400"}`}>
                            {bal.balance}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </motion.div>
        )}

        {/* ─── TAB: PADLOCKS ─── */}
        {activeTab === "padlocks" && (
          <motion.div
            key="padlocks"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            {/* Sub tab navigation */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-3">
              <div className="flex bg-muted/50 p-1 border rounded-xl gap-1">
                {[
                  { id: "registry", label: "Lock Registry" },
                  { id: "assignments", label: "Assignment History Logs" },
                ].map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setPadlockSubTab(sub.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                      padlockSubTab === sub.id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
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
                  className="rounded-xl font-bold text-xs uppercase"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  {padlockSubTab === "registry" ? "Register Padlock" : "Assign Padlock Randomly"}
                </Button>
              )}
            </div>

            {/* Sub Tab: Registry */}
            {padlockSubTab === "registry" && (
              <div className="border border-border/80 rounded-2xl overflow-hidden bg-card/65 shadow-sm">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="font-bold">Serial Number</TableHead>
                      <TableHead className="font-bold">Brand Name</TableHead>
                      <TableHead className="font-bold">Lock Type</TableHead>
                      <TableHead className="font-bold">Registry Status</TableHead>
                      <TableHead className="font-bold">Physical Condition</TableHead>
                      <TableHead className="font-bold">Registered Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingPadlocks ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-12">
                        <Skeleton className="h-6 w-1/2 mx-auto" />
                      </TableCell></TableRow>
                    ) : !padlocks || padlocks.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-xs italic">No padlocks registered in inventory.</TableCell></TableRow>
                    ) : (
                      padlocks.map(p => (
                        <TableRow key={p.id} className="hover:bg-muted/20 transition-colors">
                          <TableCell className="text-xs font-mono font-black text-foreground">
                            {p.serialNumber}
                          </TableCell>
                          <TableCell className="text-xs font-semibold">{p.brandName || "—"}</TableCell>
                          <TableCell>
                            {p.lockType === "new" ? (
                              <Badge className="bg-violet-50 text-violet-700 border-violet-100 hover:bg-violet-50 dark:bg-violet-950/20 dark:text-violet-400 dark:border-violet-900 text-[10px] uppercase font-bold px-2 py-0.5">
                                Brand New
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 text-[10px] uppercase font-bold px-2 py-0.5">
                                Old Lock
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                p.status === "available"
                                  ? "default"
                                  : p.status === "assigned"
                                  ? "secondary"
                                  : "destructive"
                              }
                              className="text-[10px] uppercase font-bold"
                            >
                              {p.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[10px] uppercase font-bold ${
                                p.condition === "good"
                                  ? "text-emerald-600 border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/15"
                                  : "text-amber-600 border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/15"
                              }`}
                            >
                              {p.condition}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
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
              <div className="border border-border/80 rounded-2xl overflow-hidden bg-card/65 shadow-sm">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="font-bold">Serial Number</TableHead>
                      <TableHead className="font-bold">Assigned Agent</TableHead>
                      <TableHead className="font-bold">Destination</TableHead>
                      <TableHead className="font-bold">Cond. Before</TableHead>
                      <TableHead className="font-bold">Cond. After</TableHead>
                      <TableHead className="font-bold">Timestamps (Assigned · Opened · Returned)</TableHead>
                      <TableHead className="w-48 text-center font-bold">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingAssignments ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-12">
                        <Skeleton className="h-6 w-1/2 mx-auto" />
                      </TableCell></TableRow>
                    ) : !assignments || assignments.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-xs italic">No padlock assignments found.</TableCell></TableRow>
                    ) : (
                      assignments.map(a => {
                        const assignedDate = new Date(a.assignedAt);
                        const openedDate = a.openedAt ? new Date(a.openedAt) : null;
                        const returnedDate = a.returnedAt ? new Date(a.returnedAt) : null;

                        return (
                          <TableRow key={a.id} className="hover:bg-muted/20 transition-colors">
                            <TableCell className="text-xs font-mono font-bold text-foreground">
                              {a.padlockSerialNumber}
                            </TableCell>
                            <TableCell className="text-xs">
                              <span className="font-mono font-bold bg-muted px-2 py-0.5 border rounded-md">{a.agentCode}</span>
                              {a.agencyName && <span className="text-[11px] text-muted-foreground ml-1.5 font-medium">({a.agencyName})</span>}
                            </TableCell>
                            <TableCell className="text-xs font-medium truncate max-w-[120px]">{a.destination}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] uppercase font-bold">{a.conditionBefore}</Badge>
                            </TableCell>
                            <TableCell>
                              {a.conditionAfter ? (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] uppercase font-bold ${
                                    a.conditionAfter === "Intact" || a.conditionAfter === "good"
                                      ? "text-emerald-600 border-emerald-200 bg-emerald-50/50"
                                      : "text-rose-600 border-rose-200 bg-rose-50/50"
                                  }`}
                                >
                                  {a.conditionAfter}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-[11px] text-muted-foreground space-y-1 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-foreground min-w-[55px]">Assigned:</span>
                                <span>{assignedDate.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
                              </div>
                              {openedDate && (
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground min-w-[55px]">Opened:</span>
                                  <span className="text-blue-600 dark:text-blue-400">{openedDate.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
                                </div>
                              )}
                              {returnedDate && (
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground min-w-[55px]">Returned:</span>
                                  <span className="text-emerald-600 dark:text-emerald-400">{returnedDate.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex justify-center items-center gap-1.5">
                                {!a.openedAt && !a.returnedAt && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenAssignment(a.id)}
                                    className="text-[10px] h-7 px-2 font-bold uppercase rounded-lg border-blue-200 hover:bg-blue-50/50 text-blue-600 dark:border-blue-900 dark:hover:bg-blue-950/20"
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
                                    className="text-[10px] h-7 px-2 font-bold uppercase rounded-lg bg-amber-600 hover:bg-amber-700"
                                  >
                                    Return
                                  </Button>
                                )}
                                {a.returnedAt && (
                                  <Badge variant="secondary" className="text-[10px] uppercase px-2 py-1 font-bold">Returned</Badge>
                                )}
                                
                                {isCashier && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleOpenEditModal(a)}
                                    className="h-7 w-7 p-0 rounded-lg hover:bg-muted"
                                    title="Edit Assignment Details"
                                  >
                                    <Settings2 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── FORM MODALS ─── */}

      {/* Booklet Batch Modal */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-md rounded-3xl border border-border/80 shadow-lg p-6 bg-background/98 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              <span>Record Booklet Printing Expense</span>
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateBatch} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Printing Date</Label>
              <Input
                type="date"
                value={batchForm.batchDate}
                onChange={e => setBatchForm(prev => ({ ...prev, batchDate: e.target.value }))}
                className="rounded-xl border-border bg-muted/20"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Quantity Printed</Label>
              <Input
                type="number"
                min="1"
                placeholder="e.g. 500"
                value={batchForm.quantity}
                onChange={e => setBatchForm(prev => ({ ...prev, quantity: e.target.value }))}
                className="rounded-xl border-border bg-muted/20 font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Total Cost (GH₵)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="e.g. 1250.00"
                value={batchForm.totalCost}
                onChange={e => setBatchForm(prev => ({ ...prev, totalCost: e.target.value }))}
                className="rounded-xl border-border bg-muted/20 font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Notes / Description</Label>
              <Input
                placeholder="e.g. Vision 2000 booklets batch A"
                value={batchForm.description}
                onChange={e => setBatchForm(prev => ({ ...prev, description: e.target.value }))}
                className="rounded-xl border-border bg-muted/20"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setBatchOpen(false)} className="rounded-xl font-bold">Cancel</Button>
              <Button type="submit" disabled={createBatchMutation.isPending} className="rounded-xl font-bold">Save Record</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Booklet Allocation Modal */}
      <Dialog open={allocationOpen} onOpenChange={setAllocationOpen}>
        <DialogContent className="max-w-md rounded-3xl border border-border/80 shadow-lg p-6 bg-background/98 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-primary" />
              <span>Allocate Booklets to Agent</span>
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateAllocation} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Select Agent</Label>
              <Select
                value={allocationForm.agentId}
                onValueChange={agentId => setAllocationForm(prev => ({ ...prev, agentId }))}
              >
                <SelectTrigger className="rounded-xl border-border bg-muted/20"><SelectValue placeholder="Choose agent..." /></SelectTrigger>
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
              <Label className="text-xs font-bold uppercase text-muted-foreground">Allocation Date</Label>
              <Input
                type="date"
                value={allocationForm.allocatedDate}
                onChange={e => setAllocationForm(prev => ({ ...prev, allocatedDate: e.target.value }))}
                className="rounded-xl border-border bg-muted/20"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Quantity Allocated</Label>
              <Input
                type="number"
                min="1"
                placeholder="e.g. 50"
                value={allocationForm.quantity}
                onChange={e => setAllocationForm(prev => ({ ...prev, quantity: e.target.value }))}
                className="rounded-xl border-border bg-muted/20 font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Notes</Label>
              <Input
                placeholder="e.g. Weekly allotment for Monday Special"
                value={allocationForm.notes}
                onChange={e => setAllocationForm(prev => ({ ...prev, notes: e.target.value }))}
                className="rounded-xl border-border bg-muted/20"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAllocationOpen(false)} className="rounded-xl font-bold">Cancel</Button>
              <Button type="submit" disabled={createAllocationMutation.isPending || !allocationForm.agentId} className="rounded-xl font-bold">Allocate</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Padlock Registry Modal */}
      <Dialog open={padlockOpen} onOpenChange={setPadlockOpen}>
        <DialogContent className="max-w-md rounded-3xl border border-border/80 shadow-lg p-6 bg-background/98 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderLock className="w-5 h-5 text-primary" />
              <span>Register Digital Padlock</span>
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreatePadlock} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Serial Number / Unique ID</Label>
              <Input
                placeholder="e.g. PDL-9981-A"
                value={padlockForm.serialNumber}
                onChange={e => setPadlockForm(prev => ({ ...prev, serialNumber: e.target.value }))}
                className="rounded-xl border-border bg-muted/20 font-mono font-bold"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Brand's Name</Label>
              <Input
                placeholder="e.g. Master Lock, Abloy"
                value={padlockForm.brandName}
                onChange={e => setPadlockForm(prev => ({ ...prev, brandName: e.target.value }))}
                className="rounded-xl border-border bg-muted/20"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Lock Type</Label>
              <Select
                value={padlockForm.lockType}
                onValueChange={lockType => setPadlockForm(prev => ({ ...prev, lockType }))}
              >
                <SelectTrigger className="rounded-xl border-border bg-muted/20"><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Brand New</SelectItem>
                  <SelectItem value="old">Old Lock</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Condition Registry</Label>
              <Select
                value={padlockForm.condition}
                onValueChange={condition => setPadlockForm(prev => ({ ...prev, condition }))}
              >
                <SelectTrigger className="rounded-xl border-border bg-muted/20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good / Functional</SelectItem>
                  <SelectItem value="damaged">Damaged / Needs repair</SelectItem>
                  <SelectItem value="broken">Broken / Out of order</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setPadlockOpen(false)} className="rounded-xl font-bold">Cancel</Button>
              <Button type="submit" disabled={createPadlockMutation.isPending} className="rounded-xl font-bold">Register Lock</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Padlock Assign Modal */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md rounded-3xl border border-border/80 shadow-lg p-6 bg-background/98 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              <span>Assign Padlock Randomly</span>
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAssignPadlock} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Assign To Agent</Label>
              <Select
                value={assignForm.agentId}
                onValueChange={agentId => setAssignForm(prev => ({ ...prev, agentId }))}
              >
                <SelectTrigger className="rounded-xl border-border bg-muted/20"><SelectValue placeholder="Select agent..." /></SelectTrigger>
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
              <Label className="text-xs font-bold uppercase text-muted-foreground">Assigned Destination</Label>
              <Input
                placeholder="e.g. Kumasi Branch Office"
                value={assignForm.destination}
                onChange={e => setAssignForm(prev => ({ ...prev, destination: e.target.value }))}
                className="rounded-xl border-border bg-muted/20 font-medium"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Condition Before Assignment</Label>
              <Select
                value={assignForm.conditionBefore}
                onValueChange={conditionBefore => setAssignForm(prev => ({ ...prev, conditionBefore }))}
              >
                <SelectTrigger className="rounded-xl border-border bg-muted/20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="damaged">Damaged</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAssignOpen(false)} className="rounded-xl font-bold">Cancel</Button>
              <Button type="submit" disabled={assignPadlockMutation.isPending || !assignForm.agentId} className="rounded-xl font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                {assignPadlockMutation.isPending ? "Assigning Randomly..." : "Assign Random Padlock"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Padlock Return Modal */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="max-w-sm rounded-3xl border border-border/80 shadow-lg p-6 bg-background/98 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <RefreshCw className="w-5 h-5 text-amber-600 animate-spin-slow" />
              <span>Record Padlock Return</span>
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleReturnAssignment} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Condition After Use</Label>
              <Select
                value={returnForm.conditionAfter}
                onValueChange={conditionAfter => setReturnForm(prev => ({ ...prev, conditionAfter }))}
              >
                <SelectTrigger className="rounded-xl border-border bg-muted/20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Intact">Intact / Good</SelectItem>
                  <SelectItem value="Tempered with">Tempered with</SelectItem>
                  <SelectItem value="damage">damage / Damaged</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => { setReturnOpen(false); setSelectedAssignmentId(null); }} className="rounded-xl font-bold">Cancel</Button>
              <Button type="submit" disabled={returnPadlockMutation.isPending} className="rounded-xl font-bold bg-amber-600 hover:bg-amber-700 text-white">Record Return</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* NEW: Padlock Assignment Editing Details Modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md rounded-3xl border border-border/80 shadow-lg p-6 bg-background/98 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary animate-pulse" />
              <span>Edit Padlock Assignment Details</span>
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateAssignment} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Select Padlock (Lock Details)</Label>
              <Select
                value={editForm.padlockId}
                onValueChange={padlockId => setEditForm(prev => ({ ...prev, padlockId }))}
              >
                <SelectTrigger className="rounded-xl border-border bg-muted/20 font-mono">
                  <SelectValue placeholder="Choose padlock..." />
                </SelectTrigger>
                <SelectContent>
                  {padlocks?.map(p => (
                    <SelectItem key={p.id} value={p.id} className="font-mono">
                      {p.serialNumber} ({p.brandName}) - {p.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Select Agent</Label>
              <Select
                value={editForm.agentId}
                onValueChange={agentId => setEditForm(prev => ({ ...prev, agentId }))}
              >
                <SelectTrigger className="rounded-xl border-border bg-muted/20">
                  <SelectValue placeholder="Choose agent..." />
                </SelectTrigger>
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
              <Label className="text-xs font-bold uppercase text-muted-foreground">Assigned Destination</Label>
              <Input
                placeholder="e.g. Kumasi Branch Office"
                value={editForm.destination}
                onChange={e => setEditForm(prev => ({ ...prev, destination: e.target.value }))}
                className="rounded-xl border-border bg-muted/20"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase text-muted-foreground">Condition Before</Label>
                <Select
                  value={editForm.conditionBefore}
                  onValueChange={conditionBefore => setEditForm(prev => ({ ...prev, conditionBefore }))}
                >
                  <SelectTrigger className="rounded-xl border-border bg-muted/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="damaged">Damaged</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase text-muted-foreground">Returned Condition</Label>
                <Select
                  value={editForm.conditionAfter}
                  onValueChange={conditionAfter => setEditForm(prev => ({ ...prev, conditionAfter }))}
                >
                  <SelectTrigger className="rounded-xl border-border bg-muted/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Intact">Intact</SelectItem>
                    <SelectItem value="Tempered with">Tempered with</SelectItem>
                    <SelectItem value="damage">damage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Assigned Date & Time (Close Time)</Label>
              <Input
                type="datetime-local"
                value={editForm.assignedAt}
                onChange={e => setEditForm(prev => ({ ...prev, assignedAt: e.target.value }))}
                className="rounded-xl border-border bg-muted/20 font-mono"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase text-muted-foreground">Opened Time (Open Time)</Label>
                <Input
                  type="datetime-local"
                  value={editForm.openedAt}
                  onChange={e => setEditForm(prev => ({ ...prev, openedAt: e.target.value }))}
                  className="rounded-xl border-border bg-muted/20 font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase text-muted-foreground">Returned Time</Label>
                <Input
                  type="datetime-local"
                  value={editForm.returnedAt}
                  onChange={e => setEditForm(prev => ({ ...prev, returnedAt: e.target.value }))}
                  className="rounded-xl border-border bg-muted/20 font-mono"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => { setEditOpen(false); setSelectedAssignment(null); }} className="rounded-xl font-bold">Cancel</Button>
              <Button type="submit" disabled={updateAssignmentMutation.isPending} className="rounded-xl font-bold">Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
