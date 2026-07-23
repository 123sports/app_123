import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Save, Settings } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/contrato-config")({
  component: AdminContratoConfig,
});

type Cfg = {
  cancel_window: string;
  reposition_window: string;
  late_fee_pct: number;
  late_interest_pct: number;
  suspension_days: number;
  payment_method: string;
  day_due: string;
  foro_city: string;
  foro_state: string;
};

const EMPTY: Cfg = {
  cancel_window: "12 horas",
  reposition_window: "30 dias",
  late_fee_pct: 2,
  late_interest_pct: 1,
  suspension_days: 10,
  payment_method: "Pix / cartão / boleto",
  day_due: "dia 5",
  foro_city: "São Paulo",
  foro_state: "SP",
};

function AdminContratoConfig() {
  const [cfg, setCfg] = useState<Cfg>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("contract_settings").select("*").maybeSingle();
      if (data) setCfg(data as any);
      setLoading(false);
    })();
  }, []);

  const upd = <K extends keyof Cfg>(k: K, v: Cfg[K]) => setCfg((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("contract_settings").upsert({ id: true, ...cfg } as any);
      if (error) throw error;
      toast.success("Configurações salvas. Novos contratos já usarão esses valores.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;

  return (
    <div className="space-y-6 animate-float-in max-w-3xl">
      <header>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="h-7 w-7 text-primary" /> Configurações do Contrato
        </h1>
        <p className="text-muted-foreground">
          Esses valores aparecem automaticamente nas cláusulas do contrato de aulas (cancelamento, pagamento, foro).
        </p>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Cancelamento e reposição</CardTitle>
          <CardDescription>Cláusula 8 do contrato.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Prazo mínimo para cancelar aula sem cobrança</Label>
            <Input value={cfg.cancel_window} onChange={(e) => upd("cancel_window", e.target.value)} placeholder="ex.: 12 horas" />
          </div>
          <div>
            <Label>Prazo para usar reposição</Label>
            <Input value={cfg.reposition_window} onChange={(e) => upd("reposition_window", e.target.value)} placeholder="ex.: 30 dias" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pagamento e inadimplência</CardTitle>
          <CardDescription>Cláusula 9 do contrato.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Multa por atraso (%)</Label>
            <Input type="number" step="0.01" value={cfg.late_fee_pct} onChange={(e) => upd("late_fee_pct", Number(e.target.value))} />
          </div>
          <div>
            <Label>Juros de mora (% ao mês)</Label>
            <Input type="number" step="0.01" value={cfg.late_interest_pct} onChange={(e) => upd("late_interest_pct", Number(e.target.value))} />
          </div>
          <div>
            <Label>Dias de atraso para suspender aulas</Label>
            <Input type="number" value={cfg.suspension_days} onChange={(e) => upd("suspension_days", Number(e.target.value))} />
          </div>
          <div>
            <Label>Forma de pagamento padrão</Label>
            <Input value={cfg.payment_method} onChange={(e) => upd("payment_method", e.target.value)} />
          </div>
          <div>
            <Label>Dia de vencimento</Label>
            <Input value={cfg.day_due} onChange={(e) => upd("day_due", e.target.value)} placeholder="ex.: dia 5" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Foro</CardTitle>
          <CardDescription>Cláusula 22 do contrato.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Cidade</Label>
            <Input value={cfg.foro_city} onChange={(e) => upd("foro_city", e.target.value)} />
          </div>
          <div>
            <Label>Estado (UF)</Label>
            <Input value={cfg.foro_state} maxLength={2} onChange={(e) => upd("foro_state", e.target.value.toUpperCase())} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar configurações
        </Button>
      </div>
    </div>
  );
}
