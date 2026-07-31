import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Share2, Gift, Users, Loader2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/app/indicacoes")({
  component: ReferralsPage,
});

type Reward = { id: string; min_referrals: number; discount_percent: number; label: string };
type Status = {
  total_referrals: number;
  current_discount: number;
  next_tier_at: number | null;
  next_tier_discount: number | null;
};
type ReferredPerson = { id: string; full_name: string | null; created_at: string };

function ReferralsPage() {
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState<string>("");
  const [status, setStatus] = useState<Status | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [people, setPeople] = useState<ReferredPerson[]>([]);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: p }, { data: r }, { data: s }, { data: pp }] = await Promise.all([
        supabase.from("profiles").select("referral_code").eq("id", u.user.id).maybeSingle(),
        (supabase as any).from("referral_rewards").select("*").eq("active", true).order("min_referrals"),
        (supabase as any).rpc("get_referral_status", { _user_id: u.user.id }),
        (supabase as any).rpc("get_my_referred_people"),
      ]);
      setCode((p as any)?.referral_code ?? "");
      setRewards((r as Reward[]) ?? []);
      setStatus(((s as any)?.[0] as Status) ?? null);
      setPeople((pp as ReferredPerson[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const shareUrl = code ? `${window.location.origin}/convite/${code}` : "";

  const copyCode = async () => {
    playPop();
    await navigator.clipboard.writeText(code);
    toast.success("Código copiado!");
  };
  const copyLink = async () => {
    playPop();
    await navigator.clipboard.writeText(shareUrl);
    toast.success("Link copiado!");
  };
  const share = async () => {
    playPop();
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Vem jogar comigo no On Tennis!",
          text: `Aceite meu convite e venha jogar:`,
          url: shareUrl,
        });
      } catch {
        // Ignore native share cancellation or unsupported share targets.
      }
    } else {
      copyLink();
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const total = status?.total_referrals ?? 0;
  const nextAt = status?.next_tier_at ?? null;
  const progress = nextAt ? Math.min(100, Math.round((total / nextAt) * 100)) : 100;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Indicações"
        title="Indique e ganhe desconto"
        subtitle="Quanto mais amigos você trouxer, maior o seu desconto nas aulas."
      />

      <section className="plane plane-hero">
        <p className="type-eyebrow">Seu código</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="rounded-2xl bg-primary/10 px-5 py-3 text-2xl font-bold tracking-widest text-primary type-data">
            {code}
          </span>
          <button onClick={copyCode} className="btn-bounce inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm hover:bg-accent">
            <Copy className="h-4 w-4" /> Copiar código
          </button>
          <button onClick={copyLink} className="btn-bounce inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm hover:bg-accent">
            <Copy className="h-4 w-4" /> Copiar link
          </button>
          <button onClick={share} className="btn-bounce inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            <Share2 className="h-4 w-4" /> Compartilhar
          </button>
        </div>
        <p className="mt-3 break-all type-micro text-muted-foreground">{shareUrl}</p>
      </section>

      <section className="grid auto-rows-fr gap-4 md:grid-cols-3">
        <Stat icon={Users} label="Amigos indicados" value={total.toString()} />
        <Stat icon={Trophy} label="Desconto atual" value={`${status?.current_discount ?? 0}%`} highlight />
        <Stat
          icon={Gift}
          label={nextAt ? `Faltam para ${status?.next_tier_discount}%` : "Nível máximo!"}
          value={nextAt ? `${Math.max(0, nextAt - total)}` : "🏆"}
        />
      </section>

      {nextAt && (
        <section className="plane">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Progresso até o próximo nível</span>
            <span className="text-muted-foreground type-data">{total}/{nextAt}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 type-h2">Níveis de recompensa</h2>
        <div className="grid auto-rows-fr gap-4 md:grid-cols-3">
          {rewards.map((r) => {
            const unlocked = total >= r.min_referrals;
            return (
              <div
                key={r.id}
                className={`plane h-full transition ${
                  unlocked ? "border-primary bg-primary/10" : "opacity-80"
                }`}
              >
                <div className="type-eyebrow">
                  {r.label}
                </div>
                <div className="mt-2 text-3xl font-bold type-data">{r.discount_percent}%</div>
                <p className="type-micro text-muted-foreground">de desconto</p>
                <p className="mt-3 type-small">
                  {unlocked ? "✅ Desbloqueado" : `Indique ${r.min_referrals} amigos`}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 type-h2">Quem entrou pelo seu código</h2>
        {people.length === 0 ? (
          <p className="plane border-dashed text-center type-small text-muted-foreground">
            Nenhuma indicação ainda. Compartilhe seu código e comece a economizar!
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden bg-card/30">
            {people.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-medium">{p.full_name ?? "Aluno"}</span>
                <span className="type-micro text-muted-foreground type-data">
                  {new Date(p.created_at).toLocaleDateString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon: Icon, label, value, highlight,
}: { icon: any; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`plane h-full ${highlight ? "border-primary bg-primary text-primary-foreground" : ""}`}>
      <Icon className="h-5 w-5 opacity-80" />
      <div className="mt-2 text-3xl font-bold type-data">{value}</div>
      <p className={`type-small ${highlight ? "opacity-90" : "text-muted-foreground"}`}>{label}</p>
    </div>
  );
}
