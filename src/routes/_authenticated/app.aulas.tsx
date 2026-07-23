import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { GraduationCap, FileSignature, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createClassContract } from "@/lib/contracts.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { brl, cents as toCents } from "@/lib/money";
import {
  addMonths,
  buildProfileSnapshot,
  buildCoachSnapshot,
  buildSettingsSnapshot,
  buildPlanMeta,
  readContractSnapshot,
  renderTemplate,
  statusLabel,
  type ContractSnapshot,
} from "@/lib/contracts";
import { ContractView } from "@/components/ContractView";

export const Route = createFileRoute("/_authenticated/app/aulas")({
  component: MinhasAulas,
});

type Plan = {
  id: string;
  frequency_per_week: number;
  duration_months: number;
  price_cents: number;
  title: string;
  description: string | null;
  modality: string;
  class_duration_min: number;
  active: boolean;
};

type Template = { id: string; version: number; title: string; body_md: string };

type Contract = {
  id: string;
  status: string;
  list_price_cents: number;
  agreed_price_cents: number;
  starts_on: string;
  ends_on: string;
  snapshot: any;
  document_hash: string;
  plan_id: string;
  template_id: string;
  notes: string | null;
  created_at: string;
};

function MinhasAulas() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [template, setTemplate] = useState<Template | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [coach, setCoach] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contractDialog, setContractDialog] = useState<{ plan: Plan } | null>(null);
  const [viewContract, setViewContract] = useState<Contract | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setUserId(u.user.id);
    setEmail(u.user.email ?? null);
    const [{ data: ps }, { data: tpl }, { data: cs }, { data: prof }, { data: coachRows }, { data: cfg }] = await Promise.all([
      supabase.from("class_plans").select("*").eq("active", true).order("duration_months").order("frequency_per_week"),
      supabase.from("contract_templates").select("*").eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("class_contracts").select("*").eq("student_id", u.user.id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle(),
      supabase.rpc("get_default_coach_profile" as any),
      supabase.from("contract_settings").select("*").maybeSingle(),
    ]);
    setPlans((ps as any) ?? []);
    setTemplate((tpl as any) ?? null);
    setContracts((cs as any) ?? []);
    setProfile(prof);
    setCoach((coachRows as any[])?.[0] ?? null);
    setSettings(cfg);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel("class-contracts-student")
      .on("postgres_changes", { event: "*", schema: "public", table: "class_contracts", filter: `student_id=eq.${userId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "contract_signatures" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const byDuration = useMemo(() => {
    const groups = new Map<number, Plan[]>();
    plans.forEach((p) => {
      if (!groups.has(p.duration_months)) groups.set(p.duration_months, []);
      groups.get(p.duration_months)!.push(p);
    });
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [plans]);

  const profileMissing = useMemo(() => {
    if (!profile) return [];
    const missing: string[] = [];
    if (!profile.full_name) missing.push("nome completo");
    if (!profile.cpf) missing.push("CPF");
    if (!profile.phone) missing.push("telefone");
    if (!profile.address) missing.push("endereço");
    if (!profile.birth_date) missing.push("data de nascimento");
    return missing;
  }, [profile]);

  return (
    <div className="space-y-8 animate-float-in">
      <header>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <GraduationCap className="h-7 w-7 text-primary" /> Minhas Aulas
        </h1>
        <p className="text-muted-foreground">Contrate seu pacote semanal e acompanhe seus contratos.</p>
      </header>

      {profileMissing.length > 0 && (
        <Card className="border-yellow-500/40 bg-yellow-500/10">
          <CardContent className="py-4 text-sm">
            Para contratar um pacote, complete seu cadastro:{" "}
            <strong>{profileMissing.join(", ")}</strong>.{" "}
            <Link to="/app/perfil" className="text-primary underline">Ir para o perfil</Link>
          </CardContent>
        </Card>
      )}

      {!coach && (
        <Card className="border-yellow-500/40 bg-yellow-500/10">
          <CardContent className="py-4 text-sm">
            O coach ainda não cadastrou os dados profissionais. O contrato ficará incompleto até o admin preencher.
          </CardContent>
        </Card>
      )}

      {/* Existing contracts */}
      {contracts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Seus contratos</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {contracts.map((c) => {
              const plan = plans.find((p) => p.id === c.plan_id);
              const s = statusLabel(c.status);
              const needsSign = c.status === "aguardando_aluno" || c.status === "rascunho" || c.status === "proposta_admin";
              return (
                <Card key={c.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{plan?.title ?? "Plano"}</CardTitle>
                        <CardDescription>
                          {c.starts_on.split("-").reverse().join("/")} → {c.ends_on.split("-").reverse().join("/")}
                        </CardDescription>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.color}`}>{s.label}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm">
                      Valor combinado: <strong>{brl(c.agreed_price_cents)}</strong>
                      {c.agreed_price_cents !== c.list_price_cents && (
                        <span className="ml-2 text-muted-foreground line-through">{brl(c.list_price_cents)}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setViewContract(c)}>Ver contrato</Button>
                      {needsSign && (
                        <Button size="sm" onClick={() => setViewContract(c)}>
                          <FileSignature className="h-4 w-4" /> Assinar
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Catalog */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Catálogo de pacotes</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        ) : byDuration.length === 0 ? (
          <p className="text-muted-foreground">Nenhum pacote disponível no momento.</p>
        ) : (
          byDuration.map(([months, list]) => (
            <div key={months} className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {months === 1 ? "Mensal" : months === 3 ? "Trimestral" : months === 6 ? "Semestral" : `${months} meses`}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {list.map((p) => (
                  <Card key={p.id} className="flex flex-col">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{p.frequency_per_week}x por semana</CardTitle>
                      <CardDescription>{p.description ?? `${p.modality} · ${p.class_duration_min} min`}</CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto space-y-3">
                      <div className="text-2xl font-bold">{brl(p.price_cents)}</div>
                      <Button
                        className="w-full"
                        disabled={!template}
                        onClick={() => {
                          if (profileMissing.length > 0) {
                            toast.error("Complete seu cadastro para contratar", {
                              description: `Faltam: ${profileMissing.join(", ")}. Toque em "Ir para o perfil" para preencher.`,
                              action: {
                                label: "Ir para o perfil",
                                onClick: () => {
                                  window.location.href = "/app/perfil";
                                },
                              },
                            });
                            return;
                          }
                          if (!template) {
                            toast.error("Modelo de contrato indisponível", {
                              description: "Peça ao admin para publicar o template de contrato.",
                            });
                            return;
                          }
                          setContractDialog({ plan: p });
                        }}
                      >
                        Contratar
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {contractDialog && template && profile && userId && (
        <ContractDialog
          plan={contractDialog.plan}
          template={template}
          profile={profile}
          email={email}
          coach={coach}
          settings={settings}
          userId={userId}
          onClose={(saved) => { setContractDialog(null); if (saved) load(); }}
        />
      )}

      {viewContract && template && (
        <ViewSignDialog
          contract={viewContract}
          template={template}
          plan={plans.find((p) => p.id === viewContract.plan_id) ?? null}
          onClose={(updated) => { setViewContract(null); if (updated) load(); }}
        />
      )}
    </div>
  );
}

/* ============== Contract creation dialog ============== */
function ContractDialog({ plan, template, profile, email, coach, settings, userId, onClose }: {
  plan: Plan; template: Template; profile: any; email: string | null;
  coach: any; settings: any; userId: string;
  onClose: (saved: boolean) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [startsOn, setStartsOn] = useState(today);
  const [mode, setMode] = useState<"aceitar" | "negociar">("aceitar");
  const [propostaReais, setPropostaReais] = useState((plan.price_cents / 100).toFixed(2).replace(".", ","));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const endsOn = useMemo(() => addMonths(startsOn, plan.duration_months), [startsOn, plan.duration_months]);
  const fullSnapshot: ContractSnapshot = useMemo(() => ({
    aluno: buildProfileSnapshot(profile, email),
    coach: buildCoachSnapshot(coach),
    settings: buildSettingsSnapshot(settings ?? {}),
    plan_meta: buildPlanMeta(plan),
  }), [profile, email, coach, settings, plan]);

  const agreedCents = mode === "aceitar" ? plan.price_cents : toCents(propostaReais);

  const preview = useMemo(() => renderTemplate(template.body_md, {
    snapshot: fullSnapshot,
    agreedPriceCents: agreedCents,
    startsOn,
    endsOn,
    contractVersion: template.version,
  }), [template, fullSnapshot, agreedCents, startsOn, endsOn]);

  const createContractFn = useServerFn(createClassContract);

  const submit = async () => {
    setSubmitting(true);
    try {
      await createContractFn({
        data: {
          planId: plan.id,
          templateId: template.id,
          startsOn,
          endsOn,
          agreedPriceCents: agreedCents,
          mode,
          note: mode === "negociar" ? note : null,
        },
      });
      if (mode === "negociar") {
        toast.success("Proposta enviada! O coach vai analisar.");
      } else {
        toast.success("Contrato criado. Falta sua assinatura.");
      }
      onClose(true);
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível criar o contrato.");
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contratar — {plan.title}</DialogTitle>
          <DialogDescription>Confira os dados e o termo antes de prosseguir.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <Label>Início do contrato</Label>
              <Input type="date" value={startsOn} min={today} onChange={(e) => setStartsOn(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">Término: <strong>{endsOn.split("-").reverse().join("/")}</strong></p>
            </div>

            <div>
              <Label>Valor</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)}>
                <div className="flex items-center gap-2 rounded-md border border-border p-2">
                  <RadioGroupItem value="aceitar" id="m1" />
                  <Label htmlFor="m1" className="flex-1 cursor-pointer">
                    Aceitar valor de tabela <strong>{brl(plan.price_cents)}</strong>
                  </Label>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border p-2">
                  <RadioGroupItem value="negociar" id="m2" />
                  <Label htmlFor="m2" className="cursor-pointer">Propor outro valor ao coach</Label>
                </div>
              </RadioGroup>
              {mode === "negociar" && (
                <div className="mt-2 space-y-2">
                  <Input
                    placeholder="0,00"
                    value={propostaReais}
                    onChange={(e) => setPropostaReais(e.target.value)}
                  />
                  <Textarea
                    placeholder="Mensagem para o coach (opcional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 500))}
                    rows={3}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 max-h-96 overflow-y-auto">
            <ContractView markdown={preview} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={submitting}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting || (mode === "negociar" && agreedCents <= 0)}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "aceitar" ? "Criar contrato" : "Enviar proposta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============== View + sign dialog ============== */
function ViewSignDialog({ contract, template, plan, onClose }: {
  contract: Contract; template: Template; plan: Plan | null;
  onClose: (updated: boolean) => void;
}) {
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const snapshot = useMemo(() => readContractSnapshot(contract.snapshot, plan), [contract, plan]);
  const body = useMemo(() => renderTemplate(template.body_md, {
    snapshot,
    agreedPriceCents: contract.agreed_price_cents,
    startsOn: contract.starts_on,
    endsOn: contract.ends_on,
    contractVersion: template.version,
    generatedAt: new Date(contract.created_at),
  }), [contract, template, snapshot]);

  const canSign = ["rascunho", "aguardando_aluno", "proposta_admin"].includes(contract.status);

  const sign = async () => {
    setSubmitting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sessão expirada.");
      let ip: string | null = null;
      try {
        const r = await fetch("https://api.ipify.org?format=json");
        if (r.ok) ip = (await r.json()).ip;
      } catch {}
      const { error } = await supabase.from("contract_signatures").insert({
        contract_id: contract.id,
        signer_type: "aluno",
        signer_id: u.user.id,
        document_hash: contract.document_hash,
        ip,
        user_agent: navigator.userAgent.slice(0, 500),
      } as any);
      if (error) throw error;
      toast.success("Aceite registrado!");
      onClose(true);
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível assinar.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contrato</DialogTitle>
          <DialogDescription>Leia com atenção antes de aceitar.</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-card p-4 max-h-[60vh] overflow-y-auto">
          <ContractView markdown={body} />
        </div>

        {canSign && (
          <div className="flex items-start gap-2 rounded-md border border-border p-3">
            <Checkbox id="agree" checked={agree} onCheckedChange={(v) => setAgree(!!v)} />
            <Label htmlFor="agree" className="cursor-pointer text-sm font-normal leading-snug">
              Li e aceito integralmente os termos deste contrato. Reconheço que meu aceite eletrônico
              tem valor jurídico (MP 2.200-2/2001) e que será registrado com data, hora e endereço IP.
            </Label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={submitting}>Fechar</Button>
          {canSign && (
            <Button onClick={sign} disabled={!agree || submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <FileSignature className="h-4 w-4" /> Aceitar e assinar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
