import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { brl, cents as toCents } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/admin/aulas-planos")({
  component: AdminAulasPlanos,
});

type Plan = {
  id: string; frequency_per_week: number; duration_months: number;
  price_cents: number; title: string; description: string | null; active: boolean;
  modality: string; class_duration_min: number;
};

const MODALITIES = ["Individual", "Dupla", "Trio", "Grupo"];

function AdminAulasPlanos() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [edit, setEdit] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("class_plans").select("*").order("duration_months").order("frequency_per_week");
    setPlans((data as any) ?? []);
  };
  useEffect(() => { load(); }, []);

  const remove = async (id: string) => {
    if (!confirm("Remover este plano?")) return;
    const { error } = await supabase.from("class_plans").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Plano removido"); load(); }
  };

  return (
    <div className="space-y-6 animate-float-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Planos de Aulas</h1>
          <p className="text-muted-foreground">Catálogo padrão exibido para todos os alunos.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Novo plano</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className={p.active ? "" : "opacity-60"}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{p.title}</CardTitle>
                <span className="text-xs text-muted-foreground">{p.active ? "Ativo" : "Inativo"}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><strong>{p.frequency_per_week}x/semana</strong> · {p.duration_months} mês(es)</div>
              <div className="text-lg font-bold">{brl(p.price_cents)}</div>
              <div className="text-xs text-muted-foreground">{p.modality} · {p.class_duration_min} min/aula</div>
              <div className="text-lg font-bold">{brl(p.price_cents)}</div>
              {p.description && <p className="text-muted-foreground">{p.description}</p>}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEdit(p)}><Pencil className="h-4 w-4" /> Editar</Button>
                <Button size="sm" variant="destructive" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {(edit || creating) && (
        <PlanDialog
          plan={edit}
          onClose={(saved) => { setEdit(null); setCreating(false); if (saved) load(); }}
        />
      )}
    </div>
  );
}

function PlanDialog({ plan, onClose }: { plan: Plan | null; onClose: (saved: boolean) => void }) {
  const [title, setTitle] = useState(plan?.title ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [freq, setFreq] = useState<number>(plan?.frequency_per_week ?? 1);
  const [duration, setDuration] = useState<number>(plan?.duration_months ?? 1);
  const [price, setPrice] = useState(((plan?.price_cents ?? 0) / 100).toFixed(2).replace(".", ","));
  const [active, setActive] = useState(plan?.active ?? true);
  const [modality, setModality] = useState<string>(plan?.modality ?? "Individual");
  const [classDuration, setClassDuration] = useState<number>(plan?.class_duration_min ?? 60);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        title, description: description || null,
        frequency_per_week: freq, duration_months: duration,
        price_cents: toCents(price), active,
        modality, class_duration_min: classDuration,
      };
      const { error } = plan
        ? await supabase.from("class_plans").update(payload).eq("id", plan.id)
        : await supabase.from("class_plans").insert(payload as any);
      if (error) throw error;
      toast.success(plan ? "Plano atualizado" : "Plano criado");
      onClose(true);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader><DialogTitle>{plan ? "Editar plano" : "Novo plano"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Título</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Frequência/semana</Label>
              <Input type="number" min={1} max={7} value={freq} onChange={(e) => setFreq(Number(e.target.value))} />
            </div>
            <div>
              <Label>Duração (meses)</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Modalidade</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={modality} onChange={(e) => setModality(e.target.value)}>
                {MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label>Duração da aula (min)</Label>
              <Input type="number" min={30} max={180} step={15} value={classDuration} onChange={(e) => setClassDuration(Number(e.target.value))} />
            </div>
          </div>
          <div><Label>Valor (R$)</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div><Label>Descrição</Label><Textarea value={description ?? ""} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
          <div className="flex items-center gap-2">
            <Checkbox id="ac" checked={active} onCheckedChange={(v) => setActive(!!v)} />
            <Label htmlFor="ac">Ativo (visível para alunos)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !title}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
