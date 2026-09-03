import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EyeOff, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/PageHeader";
import { brl, cents as toCents } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/admin/aulas-planos")({
  component: AdminAulasPlanos,
});

type Plan = {
  id: string;
  frequency_per_week: number;
  duration_months: number;
  price_cents: number;
  title: string;
  description: string | null;
  active: boolean;
  modality: string;
  class_duration_min: number;
  credit_modality: "individual" | "dupla" | "grupo";
  credit_quantity: number;
};

const MODALITIES = [
  { value: "individual", label: "Individual", databaseValue: "Individual" },
  { value: "dupla", label: "Dupla", databaseValue: "Dupla" },
  { value: "grupo", label: "Grupo (3 ou 4 alunos)", databaseValue: "Grupo" },
] as const;

const PACKAGE_LABELS: Record<number, string> = {
  1: "Mensal",
  3: "Trimestral",
  6: "Semestral",
  12: "Anual",
};

function AdminAulasPlanos() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [edit, setEdit] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("class_plans")
      .select("*")
      .order("duration_months")
      .order("frequency_per_week");
    setPlans((data as any) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const deactivate = async (id: string) => {
    if (!confirm("Desativar este plano? As compras anteriores serão preservadas.")) return;
    const { error } = await supabase.from("class_plans").update({ active: false }).eq("id", id);
    if (error) toast.error(error?.message ?? "Não foi possível desativar o plano.");
    else {
      toast.success("Plano desativado");
      load();
    }
  };

  return (
    <div className="space-y-4 animate-float-in">
      <PageHeader
        eyebrow="Admin · Planos"
        title="Planos de Aulas"
        subtitle="Catálogo padrão exibido para todos os alunos."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Novo plano
          </Button>
        }
      />

      <div className="grid gap-4 auto-rows-fr md:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className={p.active ? "h-full" : "h-full opacity-60"}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="type-h3">{p.title}</CardTitle>
                <span className="type-micro text-muted-foreground">
                  {p.active ? "Ativo" : "Inativo"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <strong>{p.credit_quantity} créditos</strong> ·{" "}
                {PACKAGE_LABELS[p.duration_months] ?? "Pacote personalizado"}
              </div>
              <div className="text-lg font-bold type-data">{brl(p.price_cents)}</div>
              <div className="type-micro text-muted-foreground">
                {MODALITIES.find((item) => item.value === p.credit_modality)?.label ?? p.modality}
                {" · "}
                {p.class_duration_min} min/aula
              </div>
              {p.description && <p className="type-small text-muted-foreground">{p.description}</p>}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEdit(p)}>
                  <Pencil className="h-4 w-4" /> Editar
                </Button>
                {p.active && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deactivate(p.id)}
                    title="Desativar plano"
                  >
                    <EyeOff className="h-4 w-4" /> Desativar
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {(edit || creating) && (
        <PlanDialog
          plan={edit}
          onClose={(saved) => {
            setEdit(null);
            setCreating(false);
            if (saved) load();
          }}
        />
      )}
    </div>
  );
}

function PlanDialog({ plan, onClose }: { plan: Plan | null; onClose: (saved: boolean) => void }) {
  const [title, setTitle] = useState(plan?.title ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [duration, setDuration] = useState<number>(plan?.duration_months ?? 1);
  const [price, setPrice] = useState(((plan?.price_cents ?? 0) / 100).toFixed(2).replace(".", ","));
  const [active, setActive] = useState(plan?.active ?? true);
  const [creditModality, setCreditModality] = useState<Plan["credit_modality"]>(
    plan?.credit_modality ?? "individual",
  );
  const [creditQuantity, setCreditQuantity] = useState<number>(plan?.credit_quantity ?? 4);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const priceCents = toCents(price);
    if (
      !title.trim() ||
      priceCents <= 0 ||
      !Number.isInteger(creditQuantity) ||
      creditQuantity < 1 ||
      creditQuantity > 100
    ) {
      toast.error("Preencha título, valor e quantidade de créditos válidos.");
      return;
    }
    setSaving(true);
    try {
      const modalityLabel = MODALITIES.find((item) => item.value === creditModality)?.databaseValue;
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        frequency_per_week: 1,
        duration_months: duration,
        price_cents: priceCents,
        active,
        modality: modalityLabel ?? "Individual",
        class_duration_min: 60,
        credit_modality: creditModality,
        credit_quantity: creditQuantity,
      };
      const { error } = plan
        ? await supabase.from("class_plans").update(payload).eq("id", plan.id)
        : await supabase.from("class_plans").insert(payload as any);
      if (error) throw error;
      toast.success(plan ? "Plano atualizado" : "Plano criado");
      onClose(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar o plano. Tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plan ? "Editar plano" : "Novo plano"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Categoria comercial</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              <option value={1}>Mensal</option>
              <option value={3}>Trimestral</option>
              <option value={6}>Semestral</option>
              <option value={12}>Anual</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Esta categoria identifica o pacote; os créditos não expiram.
            </p>
          </div>
          <div>
            <Label>Modalidade do crédito</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={creditModality}
              onChange={(e) => setCreditModality(e.target.value as Plan["credit_modality"])}
            >
              {MODALITIES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Quantidade de aulas/créditos</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={creditQuantity}
              onChange={(e) => setCreditQuantity(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Cada reserva compatível consome 1 crédito. Os créditos não expiram.
            </p>
          </div>
          <div>
            <Label>Valor (R$)</Label>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="ac" checked={active} onCheckedChange={(v) => setActive(!!v)} />
            <Label htmlFor="ac">Ativo (visível para alunos)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !title}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
