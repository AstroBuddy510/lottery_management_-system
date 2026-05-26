import { useState } from "react";
import {
  useGetSettings, useCreateSettings,
  useListTimeWindows, useCreateTimeWindow, useUpdateTimeWindow, useDeleteTimeWindow,
  useListRecurringExpenses, useCreateRecurringExpense, useUpdateRecurringExpense, useDeleteRecurringExpense,
  useListGameTemplates, useCreateGameTemplate, useUpdateGameTemplate, useDeleteGameTemplate,
  getGetSettingsQueryKey, getListTimeWindowsQueryKey, getListRecurringExpensesQueryKey, getListGameTemplatesQueryKey,
  TimeWindow, GameTemplate,
} from "@workspace/api-client-react";

function resizeImageToDataUrl(file: File, maxPx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { LayoutGrid, List } from "lucide-react";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getTemplateGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `linear-gradient(135deg, hsl(${hue}, 70%, 55%), hsl(${(hue + 40) % 360}, 75%, 45%))`;
}

function pctDisplay(raw: string | undefined) {
  if (!raw) return "—";
  return `${(Number(raw) * 100).toFixed(2)}%`;
}
function pctToDecimal(input: string) {
  return String(Number(input) / 100);
}
function decimalToPct(raw: string | undefined) {
  if (!raw) return "";
  return String((Number(raw) * 100).toFixed(4));
}

type RateKey = "agentCommissionPct" | "writerCommissionPct" | "reservePct";
const RATES: { key: RateKey; label: string; description: string; color: string }[] = [
  { key: "agentCommissionPct", label: "Agent Commission", description: "Percentage of gross sales paid to the agent.", color: "text-blue-600" },
  { key: "writerCommissionPct", label: "Writer Commission", description: "Percentage of gross sales paid to the writer.", color: "text-emerald-600" },
  { key: "reservePct", label: "Reserve", description: "Percentage of net gross set aside into the reserve fund.", color: "text-violet-600" },
];

const VIEW_TYPES = [
  { value: "extra_large", label: "Extra large icons" },
  { value: "large", label: "Large icons" },
  { value: "medium", label: "Medium-sized icons" },
  { value: "small", label: "Small icons" },
  { value: "list", label: "List" },
  { value: "details", label: "Details" },
  { value: "tiles", label: "Tiles" },
  { value: "content", label: "Content" },
];

const EMPTY_EXPENSE = { name: "", description: "", defaultAmount: "", isActive: true };

type RecurringExpenseRow = {
  id: string;
  name: string;
  description?: string | null;
  defaultAmount?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
};

export function Settings() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // ── Settings data ──
  const { data: settings, isLoading: loadingSettings } = useGetSettings();
  const { data: windows, isLoading: loadingWindows } = useListTimeWindows();
  const { data: recurringExpenses, isLoading: loadingExpenses } = useListRecurringExpenses();

  // ── Mutations ──
  const createSettingsMutation = useCreateSettings();
  const createWindowMutation = useCreateTimeWindow();
  const updateWindowMutation = useUpdateTimeWindow();
  const deleteWindowMutation = useDeleteTimeWindow();
  const createExpenseMutation = useCreateRecurringExpense();
  const updateExpenseMutation = useUpdateRecurringExpense();
  const deleteExpenseMutation = useDeleteRecurringExpense();

  // ── Rates state ──
  const [ratesOpen, setRatesOpen] = useState(false);
  const [ratesForm, setRatesForm] = useState({
    commissionPct: "", agentCommissionPct: "", writerCommissionPct: "", reservePct: "", effectiveDate: "", folderColor: "#10b981",
  });

  // ── Folder settings state ──
  const [folderSettingsOpen, setFolderSettingsOpen] = useState(false);
  const [folderSettingsForm, setFolderSettingsForm] = useState({
    folderColor: "#10b981",
    folderViewType: "large",
  });

  // ── Time window state ──
  const [windowOpen, setWindowOpen] = useState(false);
  const [editWindow, setEditWindow] = useState<TimeWindow | null>(null);
  const [windowForm, setWindowForm] = useState({ dayOfWeek: "", windowOpen: "", windowClose: "", isActive: true });

  // ── Recurring expense state ──
  const [expenseCreateOpen, setExpenseCreateOpen] = useState(false);
  const [editExpense, setEditExpense] = useState<RecurringExpenseRow | null>(null);
  const [expenseForm, setExpenseForm] = useState(EMPTY_EXPENSE);

  const expenseList = Array.isArray(recurringExpenses) ? recurringExpenses : [];

  // ── Game template state & queries ──
  const { data: templates, isLoading: loadingTemplates } = useListGameTemplates();
  const createTemplateMutation = useCreateGameTemplate();
  const updateTemplateMutation = useUpdateGameTemplate();
  const deleteTemplateMutation = useDeleteGameTemplate();

  const [templateOpen, setTemplateOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<GameTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({
    name: "", dayOfWeek: "1", logoUrl: "", description: "", isActive: true
  });
  const [templateViewMode, setTemplateViewMode] = useState<"list" | "grid">("grid");
  const templateList = Array.isArray(templates) ? templates : [];

  const handleLogoUpload = async (file: File) => {
    try {
      const dataUrl = await resizeImageToDataUrl(file, 200);
      setTemplateForm(f => ({ ...f, logoUrl: dataUrl }));
    } catch {
      toast({ title: "Failed to process image file", variant: "destructive" });
    }
  };

  // ─────────── Handlers ───────────

  const openRatesDialog = () => {
    setRatesForm({
      commissionPct: decimalToPct(settings?.commissionPct),
      agentCommissionPct: decimalToPct(settings?.agentCommissionPct),
      writerCommissionPct: decimalToPct(settings?.writerCommissionPct),
      reservePct: decimalToPct(settings?.reservePct),
      effectiveDate: settings?.effectiveDate?.split("T")[0] ?? "",
      folderColor: settings?.folderColor ?? "#10b981",
    });
    setRatesOpen(true);
  };

  const handleSaveRates = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createSettingsMutation.mutateAsync({
        data: {
          commissionPct: pctToDecimal(ratesForm.commissionPct),
          agentCommissionPct: pctToDecimal(ratesForm.agentCommissionPct),
          writerCommissionPct: pctToDecimal(ratesForm.writerCommissionPct),
          reservePct: pctToDecimal(ratesForm.reservePct),
          effectiveDate: ratesForm.effectiveDate,
          folderColor: settings?.folderColor ?? ratesForm.folderColor,
          folderViewType: settings?.folderViewType ?? "large",
        },
      });
      toast({ title: "Commission rates updated" });
      setRatesOpen(false);
      qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    } catch {
      toast({ title: "Failed to update rates", variant: "destructive" });
    }
  };

  const openFolderSettingsDialog = () => {
    setFolderSettingsForm({
      folderColor: settings?.folderColor ?? "#10b981",
      folderViewType: settings?.folderViewType ?? "large",
    });
    setFolderSettingsOpen(true);
  };

  const handleSaveFolderSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createSettingsMutation.mutateAsync({
        data: {
          commissionPct: settings?.commissionPct ?? "0",
          agentCommissionPct: settings?.agentCommissionPct ?? "0",
          writerCommissionPct: settings?.writerCommissionPct ?? "0",
          reservePct: settings?.reservePct ?? "0",
          effectiveDate: settings?.effectiveDate?.split("T")[0] ?? new Date().toISOString().split("T")[0],
          folderColor: folderSettingsForm.folderColor,
          folderViewType: folderSettingsForm.folderViewType,
        },
      });
      toast({ title: "Folder settings updated" });
      setFolderSettingsOpen(false);
      qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    } catch {
      toast({ title: "Failed to update folder settings", variant: "destructive" });
    }
  };

  const handleCreateWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createWindowMutation.mutateAsync({
        data: {
          dayOfWeek: windowForm.dayOfWeek !== "" ? Number(windowForm.dayOfWeek) : null,
          windowOpen: windowForm.windowOpen,
          windowClose: windowForm.windowClose,
          isActive: windowForm.isActive,
        },
      });
      toast({ title: "Time window created" });
      setWindowOpen(false);
      setWindowForm({ dayOfWeek: "", windowOpen: "", windowClose: "", isActive: true });
      qc.invalidateQueries({ queryKey: getListTimeWindowsQueryKey() });
    } catch {
      toast({ title: "Failed to create time window", variant: "destructive" });
    }
  };

  const handleEditWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editWindow) return;
    try {
      await updateWindowMutation.mutateAsync({
        id: editWindow.id,
        data: {
          dayOfWeek: windowForm.dayOfWeek !== "" ? Number(windowForm.dayOfWeek) : null,
          windowOpen: windowForm.windowOpen,
          windowClose: windowForm.windowClose,
          isActive: windowForm.isActive,
        },
      });
      toast({ title: "Time window updated" });
      setEditWindow(null);
      qc.invalidateQueries({ queryKey: getListTimeWindowsQueryKey() });
    } catch {
      toast({ title: "Failed to update time window", variant: "destructive" });
    }
  };

  const handleDeleteWindow = async (w: TimeWindow) => {
    if (!confirm("Delete this time window?")) return;
    try {
      await deleteWindowMutation.mutateAsync({ id: w.id });
      toast({ title: "Time window deleted" });
      qc.invalidateQueries({ queryKey: getListTimeWindowsQueryKey() });
    } catch {
      toast({ title: "Failed to delete time window", variant: "destructive" });
    }
  };

  const openEditWindow = (w: TimeWindow) => {
    setEditWindow(w);
    setWindowForm({ dayOfWeek: w.dayOfWeek != null ? String(w.dayOfWeek) : "", windowOpen: w.windowOpen, windowClose: w.windowClose, isActive: w.isActive });
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createExpenseMutation.mutateAsync({
        data: {
          name: expenseForm.name,
          description: expenseForm.description || undefined,
          defaultAmount: expenseForm.defaultAmount || undefined,
          isActive: expenseForm.isActive,
        },
      });
      toast({ title: "Recurring expense created" });
      setExpenseCreateOpen(false);
      setExpenseForm(EMPTY_EXPENSE);
      qc.invalidateQueries({ queryKey: getListRecurringExpensesQueryKey() });
    } catch {
      toast({ title: "Failed to create recurring expense", variant: "destructive" });
    }
  };

  const handleEditExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editExpense) return;
    try {
      await updateExpenseMutation.mutateAsync({
        id: editExpense.id,
        data: {
          name: expenseForm.name,
          description: expenseForm.description || null,
          defaultAmount: expenseForm.defaultAmount || null,
          isActive: expenseForm.isActive,
        },
      });
      toast({ title: "Recurring expense updated" });
      setEditExpense(null);
      qc.invalidateQueries({ queryKey: getListRecurringExpensesQueryKey() });
    } catch {
      toast({ title: "Failed to update recurring expense", variant: "destructive" });
    }
  };

  const handleDeleteExpense = async (exp: RecurringExpenseRow) => {
    if (!confirm(`Delete "${exp.name}"? This cannot be undone.`)) return;
    try {
      await deleteExpenseMutation.mutateAsync({ id: exp.id });
      toast({ title: "Recurring expense deleted" });
      qc.invalidateQueries({ queryKey: getListRecurringExpensesQueryKey() });
    } catch {
      toast({ title: "Failed to delete recurring expense", variant: "destructive" });
    }
  };

  const openEditExpense = (exp: RecurringExpenseRow) => {
    setEditExpense(exp);
    setExpenseForm({
      name: exp.name,
      description: exp.description ?? "",
      defaultAmount: exp.defaultAmount ?? "",
      isActive: exp.isActive,
    });
  };

  // ── Game template handlers ──
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createTemplateMutation.mutateAsync({
        data: {
          name: templateForm.name,
          dayOfWeek: Number(templateForm.dayOfWeek),
          logoUrl: templateForm.logoUrl || undefined,
          description: templateForm.description || undefined,
          isActive: templateForm.isActive,
        },
      });
      toast({ title: "Game template created" });
      setTemplateOpen(false);
      setTemplateForm({ name: "", dayOfWeek: "1", logoUrl: "", description: "", isActive: true });
      qc.invalidateQueries({ queryKey: getListGameTemplatesQueryKey() });
    } catch (err: any) {
      toast({ title: err?.data?.error ?? "Failed to create template", variant: "destructive" });
    }
  };

  const handleEditTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTemplate) return;
    try {
      await updateTemplateMutation.mutateAsync({
        id: editTemplate.id,
        data: {
          name: templateForm.name,
          dayOfWeek: Number(templateForm.dayOfWeek),
          logoUrl: templateForm.logoUrl || null,
          description: templateForm.description || null,
          isActive: templateForm.isActive,
        },
      });
      toast({ title: "Game template updated" });
      setEditTemplate(null);
      qc.invalidateQueries({ queryKey: getListGameTemplatesQueryKey() });
    } catch (err: any) {
      toast({ title: err?.data?.error ?? "Failed to update template", variant: "destructive" });
    }
  };

  const handleDeleteTemplate = async (tmpl: GameTemplate) => {
    if (!confirm(`Delete "${tmpl.name}"? This cannot be undone.`)) return;
    try {
      await deleteTemplateMutation.mutateAsync({ id: tmpl.id });
      toast({ title: "Game template deleted" });
      qc.invalidateQueries({ queryKey: getListGameTemplatesQueryKey() });
    } catch {
      toast({ title: "Failed to delete template", variant: "destructive" });
    }
  };

  const openEditTemplate = (tmpl: GameTemplate) => {
    setEditTemplate(tmpl);
    setTemplateForm({
      name: tmpl.name,
      dayOfWeek: String(tmpl.dayOfWeek),
      logoUrl: tmpl.logoUrl ?? "",
      description: tmpl.description ?? "",
      isActive: tmpl.isActive,
    });
  };

  // ─────────── Sub-forms ───────────

  // ─────────── Render ───────────

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage commission rates, reserve percentages, cashier hours, expense categories, and games.
        </p>
      </div>

      <Tabs defaultValue="rates">
        <TabsList className="mb-4">
          <TabsTrigger value="rates">Commission Rates</TabsTrigger>
          <TabsTrigger value="folders">Folder Settings</TabsTrigger>
          <TabsTrigger value="hours">Cashier Hours</TabsTrigger>
          <TabsTrigger value="expenses">Expense Categories</TabsTrigger>
          <TabsTrigger value="templates">Game Templates</TabsTrigger>
        </TabsList>

        {/* ── Commission Rates ── */}
        <TabsContent value="rates" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Commission & Reserve Rates</CardTitle>
                  <CardDescription className="text-xs mt-1">
                    These percentages are applied when running daily calculations.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={openRatesDialog} disabled={loadingSettings}>
                  {loadingSettings ? "Loading…" : "Update Rates"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!settings ? (
                <p className="text-sm text-muted-foreground">No rates configured yet.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {RATES.map(({ key, label, description, color }) => (
                      <div key={key} className="rounded-lg border bg-muted/30 p-4 space-y-1">
                        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</div>
                        <div className={`text-3xl font-bold ${color}`}>{pctDisplay(settings[key])}</div>
                        <div className="text-xs text-muted-foreground leading-snug">{description}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-muted-foreground border-t">
                    <span>Effective from: <span className="font-medium text-foreground">{settings.effectiveDate?.split("T")[0]}</span></span>
                    <span>Overall commission: <span className="font-medium text-foreground">{pctDisplay(settings.commissionPct)}</span></span>
                    <span className="ml-auto">Last updated: <span className="font-medium text-foreground">{settings.updatedAt ? new Date(settings.updatedAt).toLocaleDateString() : "—"}</span></span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground px-1">
            Each update creates a new record with the new effective date. The most recent record is always used for calculations.
          </p>
        </TabsContent>

        {/* ── Folder Settings ── */}
        <TabsContent value="folders" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Folder Settings</CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Configure the visual appearance and layout of archived games folders.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={openFolderSettingsDialog} disabled={loadingSettings}>
                  {loadingSettings ? "Loading…" : "Update Folder Settings"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!settings ? (
                <p className="text-sm text-muted-foreground">No settings configured yet.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
                      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Folder Color</div>
                      <div className="flex items-center gap-2 pt-1">
                        <span className="inline-block w-6 h-6 rounded border border-border" style={{ backgroundColor: settings.folderColor ?? "#10b981" }} />
                        <span className="font-mono text-sm text-foreground font-semibold">{settings.folderColor ?? "#10b981"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground leading-snug pt-1">The primary color used to draw past game archive folder icons.</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
                      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Default View Type</div>
                      <div className="text-lg font-bold text-primary capitalize pt-1">
                        {VIEW_TYPES.find(v => v.value === settings.folderViewType)?.label ?? settings.folderViewType ?? "Large icons"}
                      </div>
                      <div className="text-xs text-muted-foreground leading-snug pt-1">The folder view style applied by default when inspecting folder content.</div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Cashier Hours ── */}
        <TabsContent value="hours">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Cashier Time Windows</CardTitle>
                  <CardDescription className="text-xs mt-1">Hours during which cashiers are permitted to collect payments.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setWindowOpen(true)}>Add Window</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Opens</TableHead>
                      <TableHead>Closes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-24">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingWindows ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
                    ) : !Array.isArray(windows) || windows.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No time windows configured.</TableCell></TableRow>
                    ) : windows.map(w => (
                      <TableRow key={w.id}>
                        <TableCell className="text-sm font-medium">{w.dayOfWeek != null ? DAY_SHORT[w.dayOfWeek] : "All Days"}</TableCell>
                        <TableCell className="text-sm font-mono">{w.windowOpen}</TableCell>
                        <TableCell className="text-sm font-mono">{w.windowClose}</TableCell>
                        <TableCell><Badge variant={w.isActive ? "default" : "secondary"} className="text-xs">{w.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEditWindow(w)}>Edit</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleDeleteWindow(w)}>Delete</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Recurring Expenses ── */}
        <TabsContent value="expenses">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Recurring Expenses</CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Define recurring operation costs that cashiers can select when recording company expenses.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => { setExpenseForm(EMPTY_EXPENSE); setExpenseCreateOpen(true); }}>+ Add Expense</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Default Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-28">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingExpenses ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
                    ) : expenseList.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No recurring expenses yet. Add your first expense.</TableCell></TableRow>
                    ) : expenseList.map(exp => (
                      <TableRow key={exp.id}>
                        <TableCell className="font-medium text-sm">{exp.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{exp.description ?? <span className="italic">—</span>}</TableCell>
                        <TableCell className="text-sm text-right font-mono">
                          {exp.defaultAmount ? `GH₵ ${Number(exp.defaultAmount).toFixed(2)}` : <span className="text-muted-foreground italic">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={exp.isActive ? "default" : "secondary"} className="text-xs">
                            {exp.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEditExpense(exp as RecurringExpenseRow)}>Edit</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleDeleteExpense(exp as RecurringExpenseRow)}>Delete</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Game Templates ── */}
        <TabsContent value="templates">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Game Templates</CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Configure recurring games played on specific days of the week.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center border rounded-md p-0.5 bg-muted/40">
                    <Button
                      type="button"
                      size="sm"
                      variant={templateViewMode === "grid" ? "secondary" : "ghost"}
                      className="h-7 w-7 p-0"
                      onClick={() => setTemplateViewMode("grid")}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={templateViewMode === "list" ? "secondary" : "ghost"}
                      className="h-7 w-7 p-0"
                      onClick={() => setTemplateViewMode("list")}
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button size="sm" onClick={() => { setTemplateForm({ name: "", dayOfWeek: "1", logoUrl: "", description: "", isActive: true }); setTemplateOpen(true); }}>
                    + Add Template
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingTemplates ? (
                <div className="text-center py-12 text-muted-foreground text-sm border rounded-lg bg-muted/10">Loading…</div>
              ) : templateList.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm border rounded-lg bg-muted/10">No game templates yet. Add your first template.</div>
              ) : templateViewMode === "list" ? (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Logo</TableHead>
                        <TableHead>Game Name</TableHead>
                        <TableHead>Day of Week</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-28">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templateList.map(tmpl => (
                        <TableRow key={tmpl.id}>
                          <TableCell className="w-16">
                            {tmpl.logoUrl ? (
                              <img src={tmpl.logoUrl} alt={tmpl.name} className="w-10 h-10 object-contain rounded bg-muted p-1" />
                            ) : (
                              <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">No Logo</div>
                            )}
                          </TableCell>
                          <TableCell className="font-medium text-sm">{tmpl.name}</TableCell>
                          <TableCell className="text-sm">
                             {tmpl.dayOfWeek === 7 ? (
                               <span className="font-semibold text-indigo-600 dark:text-indigo-400">Generic (Everyday)</span>
                             ) : (
                               DAY_NAMES[tmpl.dayOfWeek]
                             )}
                           </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{tmpl.description ?? <span className="italic">—</span>}</TableCell>
                          <TableCell>
                            <Badge variant={tmpl.isActive ? "default" : "secondary"} className="text-xs">
                              {tmpl.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEditTemplate(tmpl)}>Edit</Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleDeleteTemplate(tmpl)}>Delete</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {templateList.map(tmpl => (
                    <Card key={tmpl.id} className="overflow-hidden hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 border-border/80 bg-background/50 flex flex-col justify-between">
                      <div>
                        {/* Upper Header Card Area */}
                        <div className="h-24 w-full relative flex items-center justify-center border-b border-border/40" style={{ background: tmpl.logoUrl ? 'var(--muted)' : getTemplateGradient(tmpl.name) }}>
                          {tmpl.logoUrl ? (
                            <img src={tmpl.logoUrl} alt={tmpl.name} className="w-16 h-16 object-contain rounded bg-background p-1.5 shadow-sm" />
                          ) : (
                            <span className="text-white font-bold text-2xl drop-shadow-md tracking-wider">
                              {tmpl.name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <div className="absolute top-2 right-2">
                            <Badge variant={tmpl.isActive ? "default" : "secondary"} className="text-[10px] h-5 px-1.5 font-medium shadow-sm">
                              {tmpl.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                        </div>
                        {/* Content Area */}
                        <div className="p-4 space-y-2 flex-grow">
                          <h4 className="font-semibold text-sm leading-tight text-foreground">{tmpl.name}</h4>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground">Schedule:</span>
                            {tmpl.dayOfWeek === 7 ? (
                              <Badge className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 text-[10px] py-0 px-1.5 h-4.5 border-indigo-200/50 hover:bg-indigo-50/80">
                                Everyday
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4.5 font-medium text-blue-600 border-blue-200/40 bg-blue-50/20">
                                {DAY_NAMES[tmpl.dayOfWeek]}
                              </Badge>
                            )}
                          </div>
                          {tmpl.description ? (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">{tmpl.description}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground/40 italic mt-1">No description provided</p>
                          )}
                        </div>
                      </div>
                      {/* Action Area */}
                      <div className="p-3 bg-muted/20 border-t border-border/30 flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 font-medium" onClick={() => openEditTemplate(tmpl)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs px-2.5 font-medium text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDeleteTemplate(tmpl)}>Delete</Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

      {/* ── Dialogs ── */}

      <Dialog open={ratesOpen} onOpenChange={setRatesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update Commission Rates</DialogTitle></DialogHeader>
          <form onSubmit={handleSaveRates} className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commission & Reserve Rates</p>
              {RATES.map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{label} % <span className="text-muted-foreground">(e.g. 5 for 5%)</span></Label>
                  <div className="relative">
                    <Input type="number" step="0.01" min="0" max="100" value={ratesForm[key]} onChange={e => setRatesForm(f => ({ ...f, [key]: e.target.value }))} required className="h-9 text-sm pr-8" placeholder="0.00" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Calculation Engine</p>
              <div className="space-y-1">
                <Label className="text-xs">Overall Commission % <span className="text-muted-foreground">(used in daily calculations)</span></Label>
                <div className="relative">
                  <Input type="number" step="0.01" min="0" max="100" value={ratesForm.commissionPct} onChange={e => setRatesForm(f => ({ ...f, commissionPct: e.target.value }))} required className="h-9 text-sm pr-8" placeholder="0.00" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Effective Date</Label>
              <Input type="date" value={ratesForm.effectiveDate} onChange={e => setRatesForm(f => ({ ...f, effectiveDate: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setRatesOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createSettingsMutation.isPending}>{createSettingsMutation.isPending ? "Saving…" : "Save Rates"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={folderSettingsOpen} onOpenChange={setFolderSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update Folder Settings</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveFolderSettings} className="space-y-5">
            <div className="space-y-2.5">
              <Label className="text-xs font-semibold">Folder Color</Label>
              <div className="flex flex-wrap gap-2 items-center">
                {["#10b981", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316", "#f59e0b", "#64748b"].map(color => (
                  <button
                    key={color}
                    type="button"
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      folderSettingsForm.folderColor === color
                        ? "border-primary scale-110 shadow-sm"
                        : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setFolderSettingsForm(f => ({ ...f, folderColor: color }))}
                  />
                ))}
                <div className="flex items-center gap-2 ml-1">
                  <Input
                    type="color"
                    value={folderSettingsForm.folderColor}
                    onChange={e => setFolderSettingsForm(f => ({ ...f, folderColor: e.target.value }))}
                    className="w-8 h-8 rounded-md p-0 border border-input cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={folderSettingsForm.folderColor}
                    onChange={e => setFolderSettingsForm(f => ({ ...f, folderColor: e.target.value }))}
                    className="h-8 w-24 text-xs font-mono"
                    placeholder="#000000"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Default Folder View Type</Label>
              <select
                value={folderSettingsForm.folderViewType}
                onChange={e => setFolderSettingsForm(f => ({ ...f, folderViewType: e.target.value }))}
                className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {VIEW_TYPES.map(v => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setFolderSettingsOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={createSettingsMutation.isPending}>
                {createSettingsMutation.isPending ? "Saving…" : "Save Settings"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={windowOpen} onOpenChange={setWindowOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Time Window</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateWindow} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Day of Week (leave blank for all days)</Label>
              <select value={windowForm.dayOfWeek} onChange={e => setWindowForm(f => ({ ...f, dayOfWeek: e.target.value }))} className="w-full h-9 rounded border border-input bg-background px-3 text-sm">
                <option value="">All Days</option>
                {DAY_SHORT.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Opens</Label>
                <Input type="time" value={windowForm.windowOpen} onChange={e => setWindowForm(f => ({ ...f, windowOpen: e.target.value }))} required className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Closes</Label>
                <Input type="time" value={windowForm.windowClose} onChange={e => setWindowForm(f => ({ ...f, windowClose: e.target.value }))} required className="h-9 text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={windowForm.isActive} onCheckedChange={v => setWindowForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-xs">Active</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setWindowOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createWindowMutation.isPending}>{createWindowMutation.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editWindow} onOpenChange={open => !open && setEditWindow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Time Window</DialogTitle></DialogHeader>
          <form onSubmit={handleEditWindow} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Day of Week (leave blank for all days)</Label>
              <select value={windowForm.dayOfWeek} onChange={e => setWindowForm(f => ({ ...f, dayOfWeek: e.target.value }))} className="w-full h-9 rounded border border-input bg-background px-3 text-sm">
                <option value="">All Days</option>
                {DAY_SHORT.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Opens</Label>
                <Input type="time" value={windowForm.windowOpen} onChange={e => setWindowForm(f => ({ ...f, windowOpen: e.target.value }))} required className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Closes</Label>
                <Input type="time" value={windowForm.windowClose} onChange={e => setWindowForm(f => ({ ...f, windowClose: e.target.value }))} required className="h-9 text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={windowForm.isActive} onCheckedChange={v => setWindowForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-xs">Active</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditWindow(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateWindowMutation.isPending}>{updateWindowMutation.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={expenseCreateOpen} onOpenChange={setExpenseCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Recurring Expense</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateExpense} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Expense Name</Label>
              <Input value={expenseForm.name} onChange={e => setExpenseForm(f => ({ ...f, name: e.target.value }))} required className="h-9 text-sm" placeholder="e.g. Recurring Staff Travel, Office Stipend" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description (optional)</Label>
              <Input value={expenseForm.description} onChange={e => setExpenseForm(f => ({ ...f, description: e.target.value }))} className="h-9 text-sm" placeholder="Brief description of this expense" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Default Amount (GH₵, optional)</Label>
              <Input type="number" step="0.01" min="0" value={expenseForm.defaultAmount} onChange={e => setExpenseForm(f => ({ ...f, defaultAmount: e.target.value }))} className="h-9 text-sm" placeholder="0.00" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={expenseForm.isActive} onCheckedChange={v => setExpenseForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-xs">Active (visible to cashiers)</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setExpenseCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createExpenseMutation.isPending}>{createExpenseMutation.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editExpense} onOpenChange={open => !open && setEditExpense(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Recurring Expense</DialogTitle></DialogHeader>
          <form onSubmit={handleEditExpense} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Expense Name</Label>
              <Input value={expenseForm.name} onChange={e => setExpenseForm(f => ({ ...f, name: e.target.value }))} required className="h-9 text-sm" placeholder="e.g. Recurring Staff Travel, Office Stipend" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description (optional)</Label>
              <Input value={expenseForm.description} onChange={e => setExpenseForm(f => ({ ...f, description: e.target.value }))} className="h-9 text-sm" placeholder="Brief description of this expense" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Default Amount (GH₵, optional)</Label>
              <Input type="number" step="0.01" min="0" value={expenseForm.defaultAmount} onChange={e => setExpenseForm(f => ({ ...f, defaultAmount: e.target.value }))} className="h-9 text-sm" placeholder="0.00" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={expenseForm.isActive} onCheckedChange={v => setExpenseForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-xs">Active (visible to cashiers)</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditExpense(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateExpenseMutation.isPending}>{updateExpenseMutation.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Game Template Dialog */}
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Game Template</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateTemplate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Game Name</Label>
              <Input value={templateForm.name} onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} required className="h-9 text-sm" placeholder="e.g. Monday Special, Lucky Tuesday" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Day of Week</Label>
              <select value={templateForm.dayOfWeek} onChange={e => setTemplateForm(f => ({ ...f, dayOfWeek: e.target.value }))} className="w-full h-9 rounded border border-input bg-background px-3 text-sm">
                {DAY_NAMES.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
                <option value="7">Generic (Everyday)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description (optional)</Label>
              <Input value={templateForm.description} onChange={e => setTemplateForm(f => ({ ...f, description: e.target.value }))} className="h-9 text-sm" placeholder="Brief description of this game" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Logo Image (optional)</Label>
              <div className="flex items-center gap-4">
                {templateForm.logoUrl && (
                  <img src={templateForm.logoUrl} alt="Preview" className="w-12 h-12 object-contain rounded border bg-muted p-1" />
                )}
                <Input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} className="h-9 text-sm file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={templateForm.isActive} onCheckedChange={v => setTemplateForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-xs">Active (visible when scheduling games)</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setTemplateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createTemplateMutation.isPending}>{createTemplateMutation.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Game Template Dialog */}
      <Dialog open={!!editTemplate} onOpenChange={open => !open && setEditTemplate(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Game Template</DialogTitle></DialogHeader>
          <form onSubmit={handleEditTemplate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Game Name</Label>
              <Input value={templateForm.name} onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} required className="h-9 text-sm" placeholder="e.g. Monday Special, Lucky Tuesday" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Day of Week</Label>
              <select value={templateForm.dayOfWeek} onChange={e => setTemplateForm(f => ({ ...f, dayOfWeek: e.target.value }))} className="w-full h-9 rounded border border-input bg-background px-3 text-sm">
                {DAY_NAMES.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
                <option value="7">Generic (Everyday)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description (optional)</Label>
              <Input value={templateForm.description} onChange={e => setTemplateForm(f => ({ ...f, description: e.target.value }))} className="h-9 text-sm" placeholder="Brief description of this game" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Logo Image (optional)</Label>
              <div className="flex items-center gap-4">
                {templateForm.logoUrl ? (
                  <div className="relative">
                    <img src={templateForm.logoUrl} alt="Preview" className="w-12 h-12 object-contain rounded border bg-muted p-1" />
                    <button type="button" onClick={() => setTemplateForm(f => ({ ...f, logoUrl: "" }))} className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center text-[10px]">×</button>
                  </div>
                ) : null}
                <Input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} className="h-9 text-sm file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={templateForm.isActive} onCheckedChange={v => setTemplateForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-xs">Active (visible when scheduling games)</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditTemplate(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateTemplateMutation.isPending}>{updateTemplateMutation.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
