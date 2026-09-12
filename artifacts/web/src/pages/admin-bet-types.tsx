import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Edit, Trash } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function AdminBetTypes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({ name: "", code: "", numbersRequired: 2, payoutMultiplier: 240, isPermutation: false });
  const [isAdding, setIsAdding] = useState(false);

  const { data: betTypes, isLoading } = useQuery({
    queryKey: ["/api/bet-types"],
    queryFn: async () => {
      const res = await fetch("/api/bet-types", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    }
  });

  const addMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/bet-types", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bet type added" });
      setFormData({ name: "", code: "", numbersRequired: 2, payoutMultiplier: 240, isPermutation: false });
      setIsAdding(false);
      queryClient.invalidateQueries({ queryKey: ["/api/bet-types"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" })
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Manage Bet Types</h1>
        <Button onClick={() => setIsAdding(!isAdding)}>
          <Plus className="mr-2 h-4 w-4" /> Add Bet Type
        </Button>
      </div>

      {isAdding && (
        <Card>
          <CardHeader>
            <CardTitle>Add New Bet Type</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); addMutation.mutate(formData); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input value={formData.name} onChange={e => setFormData(p => ({...p, name: e.target.value}))} placeholder="Direct 2" required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Code</label>
                  <Input value={formData.code} onChange={e => setFormData(p => ({...p, code: e.target.value}))} placeholder="D2" required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Numbers Required</label>
                  <Input type="number" min="1" max="5" value={formData.numbersRequired} onChange={e => setFormData(p => ({...p, numbersRequired: parseInt(e.target.value)}))} required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Payout Multiplier</label>
                  <Input type="number" step="0.01" value={formData.payoutMultiplier} onChange={e => setFormData(p => ({...p, payoutMultiplier: parseFloat(e.target.value)}))} required />
                </div>
              </div>
              <div className="flex items-center space-x-2 mt-4">
                <Checkbox id="perm" checked={formData.isPermutation} onCheckedChange={(c) => setFormData(p => ({...p, isPermutation: !!c}))} />
                <label htmlFor="perm" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Is Permutation (allows any order combination matching)
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsAdding(false)}>Cancel</Button>
                <Button type="submit" disabled={addMutation.isPending}>
                  {addMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Numbers Required</TableHead>
                <TableHead>Payout Multiplier</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center">Loading...</TableCell></TableRow>
              ) : betTypes?.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium font-mono">{b.code}</TableCell>
                  <TableCell>{b.name}</TableCell>
                  <TableCell>{b.numbersRequired}</TableCell>
                  <TableCell>x{b.payoutMultiplier}</TableCell>
                  <TableCell>
                    {b.isPermutation ? <Badge variant="secondary">Permutation</Badge> : <Badge variant="outline">Direct</Badge>}
                  </TableCell>
                  <TableCell>
                    {b.isActive ? <Badge className="bg-green-500">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
