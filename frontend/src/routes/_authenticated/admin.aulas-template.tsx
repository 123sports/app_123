import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ContractView } from "@/components/ContractView";
import { PageHeader } from "@/components/PageHeader";
import { renderTemplate, buildSettingsSnapshot, EMPTY_COACH } from "@/lib/contracts";

export const Route = createFileRoute("/_authenticated/admin/aulas-template")({
  component: AdminTemplate,
});

type Template = { id: string; version: number; title: string; body_md: string; active: boolean; created_at: string };

function AdminTemplate() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [current, setCurrent] = useState<Template | null>(null);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("contract_templates").select("*").order("version", { ascending: false });
    setTemplates((data as any) ?? []);
    const active = (data ?? []).find((t: any) => t.active) ?? (data ?? [])[0];
    if (active) { setCurrent(active as any); setBody(active.body_md); setTitle(active.title); }
  };
  useEffect(() => { load(); }, []);

  const preview = useMemo(() => renderTemplate(body, {
    snapshot: {
      aluno: {
        nome: "João da Silva", cpf: "123.456.789-00", email: "joao@example.com",
        telefone: "(11) 98888-7777", endereco: "Rua Exemplo, 100 — São Paulo/SP",
        nascimento: "1995-05-10", emergencia_nome: "Maria Silva", emergencia_telefone: "(11) 91111-2222",
        responsavel_nome: null, responsavel_cpf: null, responsavel_email: null, responsavel_telefone: null,
      },
      coach: { ...EMPTY_COACH, nome: "Coach Exemplo", cpf_cnpj: "000.000.000-00", venue_nome: "Quadra Central", venue_endereco: "Av. das Quadras, 200" },
      settings: buildSettingsSnapshot({}),
      plan_meta: { title: "Pacote Trimestral 2x/sem", modality: "Individual", class_duration_min: 60, frequency_per_week: 2, duration_months: 3 },
    },
    agreedPriceCents: 60000,
    startsOn: new Date().toISOString().slice(0, 10),
    endsOn: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
  }), [body]);

  const saveAsNewVersion = async () => {
    setSaving(true);
    try {
      const nextVersion = (templates[0]?.version ?? 0) + 1;
      // Deactivate previous, create new active
      await supabase.from("contract_templates").update({ active: false }).eq("active", true);
      const { error } = await supabase.from("contract_templates").insert({
        version: nextVersion, title, body_md: body, active: true,
      } as any);
      if (error) throw error;
      toast.success(`Nova versão v${nextVersion} criada.`);
      load();
    } catch (e: any) { toast.error(e?.message ?? "Não foi possível salvar a nova versão. Tente de novo."); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 animate-float-in">
      <PageHeader
        eyebrow="Admin · Contratos"
        title="Termo Padrão"
        subtitle="Edite o modelo de contrato. Cada alteração cria uma nova versão; contratos já assinados ficam congelados na versão original."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Marcadores disponíveis</CardTitle>
          <CardDescription>Use entre chaves duplas. Eles são preenchidos automaticamente.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 text-xs">
            {[
              "{{aluno.nome}}","{{aluno.cpf}}","{{aluno.email}}","{{aluno.telefone}}","{{aluno.endereco}}","{{aluno.nascimento}}",
              "{{aluno.emergencia_nome}}","{{aluno.emergencia_telefone}}",
              "{{responsavel.nome}}","{{responsavel.cpf}}","{{responsavel.email}}","{{responsavel.telefone}}",
              "{{coach.nome}}","{{coach.cpf_cnpj}}","{{coach.email}}","{{coach.telefone}}","{{coach.endereco}}",
              "{{espaco.nome}}","{{espaco.endereco}}",
              "{{plano.titulo}}","{{plano.modalidade}}","{{plano.frequencia}}","{{plano.duracao}}","{{plano.duracao_aula}}","{{plano.quantidade_aulas}}","{{plano.periodo}}",
              "{{vigencia.inicio}}","{{vigencia.fim}}","{{valor.formatado}}",
              "{{config.prazo_cancelamento}}","{{config.prazo_reposicao}}","{{config.multa_pct}}","{{config.juros_pct}}","{{config.dias_suspensao}}",
              "{{config.forma_pagamento}}","{{config.dia_vencimento}}","{{config.foro_cidade}}","{{config.foro_estado}}",
              "{{contrato.versao}}","{{contrato.gerado_em}}",
            ].map((t) => (
              <code key={t} className="rounded bg-muted px-2 py-1">{t}</code>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Edição {current && <span className="text-xs text-muted-foreground">(versão atual v{current.version})</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div><Label>Título</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div>
              <Label>Corpo (Markdown)</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={22} className="font-mono text-xs" />
            </div>
            <div className="flex gap-2">
              <Button onClick={saveAsNewVersion} disabled={saving || !title || !body}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Publicar nova versão
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Pré-visualização</CardTitle></CardHeader>
          <CardContent className="max-h-[600px] overflow-y-auto">
            <ContractView markdown={preview} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Histórico de versões</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 type-micro ${t.active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  v{t.version} {t.active ? "· ativa" : ""}
                </span>
                <span>{t.title}</span>
                <span className="text-xs text-muted-foreground">— {new Date(t.created_at).toLocaleString("pt-BR")}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
