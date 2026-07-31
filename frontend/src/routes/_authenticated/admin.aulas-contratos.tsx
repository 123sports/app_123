import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, FileSignature, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { brl, cents as toCents } from "@/lib/money";
import { computeDocumentHash, renderTemplate, statusLabel, readContractSnapshot, type ContractSnapshot } from "@/lib/contracts";
import { ContractView } from "@/components/ContractView";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/aulas-contratos")({
  component: AdminAulasContratos,
});

type Contract = {
  id: string; status: string; list_price_cents: number; agreed_price_cents: number;
  starts_on: string; ends_on: string; snapshot: any; document_hash: string;
  plan_id: string; template_id: string; student_id: string; notes: string | null; created_at: string;
};
type Plan = { id: string; title: string; frequency_per_week: number; duration_months: number; price_cents: number };
type Template = { id: string; version: number; body_md: string };
type Profile = { id: string; full_name: string | null };

const FILTERS = [
  { v: "todos", label: "Todos" },
  { v: "proposta_aluno", label: "Propostas pendentes" },
  { v: "aguardando_admin", label: "Aguardando minha assinatura" },
  { v: "aguardando_aluno", label: "Aguardando aluno" },
  { v: "vigente", label: "Vigentes" },
  { v: "encerrado", label: "Encerrados" },
];

function AdminAulasContratos() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [filter, setFilter] = useState<string>("todos");
  const [view, setView] = useState<Contract | null>(null);

  const load = async () => {
    const [{ data: cs }, { data: ps }, { data: ts }] = await Promise.all([
      supabase.from("class_contracts").select("*").order("created_at", { ascending: false }),
      supabase.from("class_plans").select("*"),
      supabase.from("contract_templates").select("*"),
    ]);
    setContracts((cs as any) ?? []);
    setPlans((ps as any) ?? []);
    setTemplates((ts as any) ?? []);
    const ids = Array.from(new Set((cs ?? []).map((c: any) => c.student_id)));
    if (ids.length > 0) {
      const { data: pr } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const map: Record<string, Profile> = {};
      (pr ?? []).forEach((p: any) => { map[p.id] = p; });
      setProfiles(map);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const ch = supabase
      .channel("admin-contracts")
      .on("postgres_changes", { event: "*", schema: "public", table: "class_contracts" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "contract_signatures" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "contract_negotiations" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "todos") return contracts;
    return contracts.filter((c) => c.status === filter);
  }, [contracts, filter]);

  return (
    <div className="space-y-4 animate-float-in">
      <PageHeader
        eyebrow="Admin · Contratos"
        title="Contratos de Aulas"
        subtitle="Gerencie propostas, assinaturas e contratos vigentes."
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`rounded-full px-3 py-1 text-sm border ${filter === f.v ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card hover:bg-secondary"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 auto-rows-fr md:grid-cols-2">
        {filtered.length === 0 && <p className="text-muted-foreground">Nenhum contrato neste filtro.</p>}
        {filtered.map((c) => {
          const plan = plans.find((p) => p.id === c.plan_id);
          const s = statusLabel(c.status);
          return (
            <Card key={c.id} className="h-full">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{profiles[c.student_id]?.full_name ?? c.snapshot?.aluno?.nome ?? c.snapshot?.nome ?? "Aluno"}</CardTitle>
                    <CardDescription>
                      {plan?.title ?? "Plano"} · {c.starts_on.split("-").reverse().join("/")} → {c.ends_on.split("-").reverse().join("/")}
                    </CardDescription>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.color}`}>{s.label}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  Valor: <strong className="type-data">{brl(c.agreed_price_cents)}</strong>
                  {c.agreed_price_cents !== c.list_price_cents && (
                    <span className="ml-2 text-muted-foreground">(tabela {brl(c.list_price_cents)})</span>
                  )}
                </div>
                {c.notes && <p className="text-muted-foreground italic">"{c.notes}"</p>}
                <Button size="sm" onClick={() => setView(c)}>Abrir contrato</Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {view && (
        <ContractAdminDialog
          contract={view}
          template={templates.find((t) => t.id === view.template_id) ?? null}
          plan={plans.find((p) => p.id === view.plan_id) ?? null}
          student={profiles[view.student_id]}
          onClose={(updated) => { setView(null); if (updated) load(); }}
        />
      )}
    </div>
  );
}

function ContractAdminDialog({ contract, template, plan, student, onClose }: {
  contract: Contract; template: Template | null; plan: Plan | null; student: Profile | undefined;
  onClose: (u: boolean) => void;
}) {
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [counter, setCounter] = useState((contract.agreed_price_cents / 100).toFixed(2).replace(".", ","));
  const [counterNote, setCounterNote] = useState("");

  const canSign = ["rascunho", "aguardando_admin", "proposta_aluno"].includes(contract.status);
  const canRefuse = contract.status !== "vigente" && contract.status !== "encerrado" && contract.status !== "recusado";

  const snapshot: ContractSnapshot = useMemo(() => readContractSnapshot(contract.snapshot, plan), [contract, plan]);
  const body = useMemo(() => {
    if (!template) return "";
    return renderTemplate(template.body_md, {
      snapshot,
      agreedPriceCents: contract.agreed_price_cents,
      startsOn: contract.starts_on, endsOn: contract.ends_on,
      contractVersion: template.version,
      generatedAt: new Date(contract.created_at),
    });
  }, [contract, template, snapshot]);

  const sign = async () => {
    setSubmitting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sessão expirada");
      const { error } = await supabase.from("contract_signatures").insert({
        contract_id: contract.id, signer_type: "admin", signer_id: u.user.id,
        document_hash: contract.document_hash, ip: null, user_agent: navigator.userAgent.slice(0, 500),
      } as any);
      if (error) throw error;
      toast.success("Contrato assinado pelo admin.");
      onClose(true);
    } catch (e: any) { toast.error(e?.message ?? "Não foi possível assinar o contrato. Tente de novo."); } finally { setSubmitting(false); }
  };

  const refuse = async () => {
    if (!confirm("Recusar este contrato?")) return;
    const { error } = await supabase.from("class_contracts").update({ status: "recusado" as any }).eq("id", contract.id);
    if (error) toast.error(error?.message ?? "Não foi possível recusar o contrato. Tente de novo."); else { toast.success("Contrato recusado"); onClose(true); }
  };

  const close = async () => {
    if (!confirm("Encerrar este contrato vigente?")) return;
    const { error } = await supabase.from("class_contracts").update({ status: "encerrado" as any }).eq("id", contract.id);
    if (error) toast.error(error?.message ?? "Não foi possível encerrar o contrato. Tente de novo."); else { toast.success("Contrato encerrado"); onClose(true); }
  };

  const sendCounter = async () => {
    if (!plan || !template) return;
    setSubmitting(true);
    try {
      const newCents = toCents(counter);
      const newHash = await computeDocumentHash({
        templateId: template.id, templateVersion: template.version,
        planId: plan.id, agreedPriceCents: newCents,
        startsOn: contract.starts_on, endsOn: contract.ends_on, snapshot,
      });
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("class_contracts").update({
        agreed_price_cents: newCents,
        document_hash: newHash,
        status: "proposta_admin" as any,
      }).eq("id", contract.id);
      if (error) throw error;
      await supabase.from("contract_negotiations").insert({
        contract_id: contract.id, proposed_by: "admin", proposer_id: u.user!.id,
        price_cents: newCents, note: counterNote || null,
      } as any);
      toast.success("Contraproposta enviada ao aluno.");
      onClose(true);
    } catch (e: any) { toast.error(e?.message ?? "Não foi possível enviar a contraproposta. Tente de novo."); } finally { setSubmitting(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{student?.full_name ?? "Aluno"} · {plan?.title}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          <div className="plane max-h-[60vh] overflow-y-auto">
            {body ? <ContractView markdown={body} /> : <p className="text-muted-foreground">Modelo de contrato não encontrado.</p>}
          </div>

          <div className="space-y-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Negociar valor</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Label>Novo valor (R$)</Label>
                <Input value={counter} onChange={(e) => setCounter(e.target.value)} />
                <Textarea placeholder="Mensagem (opcional)" rows={2} value={counterNote} onChange={(e) => setCounterNote(e.target.value.slice(0, 500))} />
                <Button size="sm" variant="outline" className="w-full" onClick={sendCounter} disabled={submitting}>
                  Enviar contraproposta
                </Button>
              </CardContent>
            </Card>

            {canSign && (
              <div className="space-y-2 border border-border p-3">
                <div className="flex items-start gap-2">
                  <Checkbox id="a2" checked={agree} onCheckedChange={(v) => setAgree(!!v)} />
                  <Label htmlFor="a2" className="text-sm font-normal leading-snug cursor-pointer">
                    Confirmo, em nome da empresa, o aceite eletrônico deste contrato com o aluno.
                  </Label>
                </div>
                <Button onClick={sign} disabled={!agree || submitting} className="w-full">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  <FileSignature className="h-4 w-4" /> Assinar como admin
                </Button>
              </div>
            )}

            {canRefuse && (
              <Button variant="destructive" size="sm" className="w-full" onClick={refuse}>
                <X className="h-4 w-4" /> Recusar
              </Button>
            )}
            {contract.status === "vigente" && (
              <Button variant="outline" size="sm" className="w-full" onClick={close}>Encerrar contrato</Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={submitting}>Fechar</Button>
          <Button variant="outline" onClick={() => window.print()}>Imprimir / PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
