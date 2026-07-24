import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Save, Trophy, Users, Gift } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/indicacoes")({
  component: AdminReferrals,
});

type Reward = {
  id: string;
  min_referrals: number;
  discount_percent: number;
  label: string;
  active: boolean;
};
type Ranking = {
  id: string;
  full_name: string | null;
  referral_code: string | null;
  total: number;
};

function AdminReferrals() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [ranking, setRanking] = useState<Ranking[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ min_referrals: "", discount_percent: "", label: "" });
  const [saving, setSaving] = useState(false);
  const [welcomeTitle, setWelcomeTitle] = useState("");
  const [welcomeBonus, setWelcomeBonus] = useState("");
  const [savingWelcome, setSavingWelcome] = useState(false);

  const load = async () => {
    const [{ data: r }, { data: people }, { data: settings }] = await Promise.all([
      (supabase as any).from("referral_rewards").select("*").order("min_referrals"),
      supabase.from("profiles").select("id, full_name, referral_code, referred_by"),
      supabase.from("site_settings").select("key, value").in("key", ["referral_welcome_title", "referral_welcome_bonus"]),
    ]);
    setRewards((r as Reward[]) ?? []);
    const sMap = Object.fromEntries(((settings as any[]) ?? []).map((s) => [s.key, s.value]));
    setWelcomeTitle(sMap["referral_welcome_title"] ?? "");
    setWelcomeBonus(sMap["referral_welcome_bonus"] ?? "");
    const profiles = (people as any[]) ?? [];
    const counts = new Map<string, number>();
    profiles.forEach((p) => {
      if (p.referred_by) counts.set(p.referred_by, (counts.get(p.referred_by) ?? 0) + 1);
    });
    const ranked: Ranking[] = profiles
      .map((p) => ({
        id: p.id,
        full_name: p.full_name,
        referral_code: p.referral_code,
        total: counts.get(p.id) ?? 0,
      }))
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total);
    setRanking(ranked);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveWelcome = async () => {
    playPop();
    setSavingWelcome(true);
    const rows = [
      { key: "referral_welcome_title", value: welcomeTitle.trim() },
      { key: "referral_welcome_bonus", value: welcomeBonus.trim() },
    ];
    const { error } = await (supabase as any).from("site_settings").upsert(rows, { onConflict: "key" });
    setSavingWelcome(false);
    if (error) return toast.error(error?.message ?? "Não foi possível salvar a mensagem. Tente de novo.");
    toast.success("Mensagem de boas-vindas salva");
  };

  const addRule = async () => {
    playPop();
    const min = parseInt(draft.min_referrals);
    const disc = parseInt(draft.discount_percent);
    if (!min || !disc || !draft.label.trim()) return toast.error("Preencha todos os campos");
    if (min < 1 || disc < 1 || disc > 100) return toast.error("Valores inválidos");
    setSaving(true);
    const { error } = await (supabase as any).from("referral_rewards").insert({
      min_referrals: min,
      discount_percent: disc,
      label: draft.label.trim(),
    });
    setSaving(false);
    if (error) return toast.error(error?.message ?? "Não foi possível adicionar o nível. Tente de novo.");
    setDraft({ min_referrals: "", discount_percent: "", label: "" });
    toast.success("Nível adicionado");
    load();
  };

  const updateRule = async (id: string, patch: Partial<Reward>) => {
    const { error } = await (supabase as any).from("referral_rewards").update(patch).eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível atualizar o nível. Tente de novo.");
    load();
  };

  const removeRule = async (id: string) => {
    playPop();
    if (!confirm("Remover este nível?")) return;
    const { error } = await (supabase as any).from("referral_rewards").delete().eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível remover o nível. Tente de novo.");
    toast.success("Removido");
    load();
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin · Indicações"
        title="Indicações"
        subtitle="Configure os níveis de desconto e acompanhe quem mais indica."
      />

      <section className="plane">
        <h2 className="type-h3 mb-1 flex items-center gap-2">
          <Gift className="h-4 w-4 text-primary" /> Boas-vindas ao indicado
        </h2>
        <p className="type-small mb-4 text-muted-foreground">
          Esta mensagem aparece na página de convite (<code>/convite/CÓDIGO</code>) que o aluno compartilha.
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Título (opcional)</span>
            <input
              value={welcomeTitle}
              onChange={(e) => setWelcomeTitle(e.target.value)}
              placeholder="Você foi convidado! 🎾"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Bônus / premiação ao novo aluno</span>
            <textarea
              value={welcomeBonus}
              onChange={(e) => setWelcomeBonus(e.target.value)}
              placeholder="Ex.: Primeira aula com 50% de desconto ao se cadastrar pelo convite."
              rows={3}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={saveWelcome}
            disabled={savingWelcome}
            className="btn-bounce inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {savingWelcome ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar mensagem
          </button>
        </div>
      </section>



      <section className="plane">
        <h2 className="type-h3 mb-1 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" /> Níveis de recompensa
        </h2>
        <p className="type-small mb-4 text-muted-foreground">
          Defina escadas de desconto pra quem indica amigos. Exemplo: <b>Bronze · 3 amigos · 5% off</b>.
        </p>

        {rewards.length > 0 && (
          <div className="mb-2 hidden grid-cols-[1fr_1fr_2fr_auto_auto] gap-3 px-3 type-eyebrow text-muted-foreground sm:grid">
            <span>Amigos indicados</span>
            <span>Desconto (%)</span>
            <span>Nome do nível</span>
            <span></span><span></span>
          </div>
        )}

        <div className="space-y-3">
          {rewards.map((r) => (
            <RuleRow key={r.id} reward={r} onUpdate={updateRule} onRemove={removeRule} />
          ))}
        </div>

        <p className="mt-6 mb-2 type-eyebrow text-muted-foreground">
          Adicionar novo nível
        </p>
        <div className="grid gap-4 rounded-2xl border border-dashed border-border p-4 sm:grid-cols-[1fr_1fr_2fr_auto]">
          <label className="block">
            <span className="mb-1 block type-micro text-muted-foreground">Amigos indicados (mín.)</span>
            <input
              type="number" min={1} placeholder="Ex.: 3"
              value={draft.min_referrals}
              onChange={(e) => setDraft({ ...draft, min_referrals: e.target.value })}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block type-micro text-muted-foreground">Desconto (%)</span>
            <input
              type="number" min={1} max={100} placeholder="Ex.: 10"
              value={draft.discount_percent}
              onChange={(e) => setDraft({ ...draft, discount_percent: e.target.value })}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block type-micro text-muted-foreground">Nome do nível</span>
            <input
              placeholder="Ex.: Bronze, Prata, Ouro"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={addRule}
            disabled={saving}
            className="btn-bounce inline-flex items-center justify-center gap-2 self-end rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Adicionar
          </button>
        </div>
      </section>


      <section className="plane">
        <h2 className="type-h3 mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" /> Ranking de indicadores
        </h2>
        {ranking.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center type-small text-muted-foreground">
            Ninguém indicou ninguém ainda.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {ranking.map((p, i) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 type-data text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-medium text-foreground">{p.full_name ?? "Aluno"}</div>
                    <div className="type-micro text-muted-foreground">Código: {p.referral_code}</div>
                  </div>
                </div>
                <span className="rounded-full bg-primary/15 px-3 py-1 type-data text-xs font-semibold text-primary">
                  {p.total} {p.total === 1 ? "indicação" : "indicações"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RuleRow({
  reward, onUpdate, onRemove,
}: {
  reward: Reward;
  onUpdate: (id: string, patch: Partial<Reward>) => void;
  onRemove: (id: string) => void;
}) {
  const [min, setMin] = useState(reward.min_referrals);
  const [disc, setDisc] = useState(reward.discount_percent);
  const [label, setLabel] = useState(reward.label);
  const dirty = min !== reward.min_referrals || disc !== reward.discount_percent || label !== reward.label;
  return (
    <div className="grid items-center gap-3 rounded-xl border border-border bg-background p-3 sm:grid-cols-[1fr_1fr_2fr_auto_auto]">
      <input
        type="number" min={1} value={min}
        aria-label="Amigos indicados (mín.)"
        title="Amigos indicados (mín.)"
        onChange={(e) => setMin(parseInt(e.target.value) || 0)}
        className="rounded-lg border border-input bg-card px-3 py-2 text-sm"
      />
      <input
        type="number" min={1} max={100} value={disc}
        aria-label="Desconto (%)"
        title="Desconto (%)"
        onChange={(e) => setDisc(parseInt(e.target.value) || 0)}
        className="rounded-lg border border-input bg-card px-3 py-2 text-sm"
      />
      <input
        value={label}
        aria-label="Nome do nível"
        title="Nome do nível (ex.: Bronze)"
        onChange={(e) => setLabel(e.target.value)}
        className="rounded-lg border border-input bg-card px-3 py-2 text-sm"
      />
      <button
        disabled={!dirty}
        onClick={() => { playPop(); onUpdate(reward.id, { min_referrals: min, discount_percent: disc, label }); }}
        className="btn-bounce inline-flex items-center gap-1 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
      >
        <Save className="h-3 w-3" /> Salvar
      </button>
      <button
        onClick={() => onRemove(reward.id)}
        className="btn-bounce inline-flex items-center justify-center rounded-full border border-destructive/40 p-2 text-destructive hover:bg-destructive/10"
        aria-label="Remover"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
