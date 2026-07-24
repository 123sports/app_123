import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trophy, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/gamificacao")({
  component: AdminGamificacao,
});

function AdminGamificacao() {
  const [rules, setRules] = useState<any[]>([]);
  const [ranking, setRanking] = useState<any[]>([]);

  const load = async () => {
    const [{ data: rs }, { data: ev }] = await Promise.all([
      supabase.from("gamification_rules").select("*").order("event_type"),
      supabase.from("gamification_events").select("user_id, points"),
    ]);
    setRules(rs ?? []);
    const byUser: Record<string, number> = {};
    (ev ?? []).forEach((e: any) => { byUser[e.user_id] = (byUser[e.user_id] ?? 0) + e.points; });
    const ids = Object.keys(byUser);
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const merged = (ps ?? []).map((p: any) => ({ ...p, points: byUser[p.id] ?? 0 }));
      merged.sort((a, b) => b.points - a.points);
      setRanking(merged);
    } else setRanking([]);
  };
  useEffect(() => { load(); }, []);

  const saveRule = async (id: string, points: number, active: boolean) => {
    const { error } = await supabase.from("gamification_rules").update({ points, active }).eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível salvar a regra. Tente de novo.");
    toast.success("Regra atualizada");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin · Gamificação"
        title="Gamificação"
        subtitle="Configure pontos por evento e veja o ranking dos alunos."
      />

      <section className="plane">
        <h2 className="mb-4 type-h3">Regras de pontuação</h2>
        <ul className="divide-y divide-border">
          {rules.map((r) => (
            <li key={r.id} className="grid items-center gap-3 py-3 sm:grid-cols-[1fr_120px_120px_auto]">
              <div>
                <div className="font-medium">{r.label}</div>
                <div className="type-micro text-muted-foreground">{r.event_type}</div>
              </div>
              <input
                type="number" defaultValue={r.points}
                onChange={(e) => (r._p = Number(e.currentTarget.value))}
                className="rounded-md border border-input bg-background px-3 py-2 text-right text-sm type-data"
              />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" defaultChecked={r.active}
                  onChange={(e) => (r._a = e.currentTarget.checked)} />
                Ativa
              </label>
              <button
                onClick={() => saveRule(r.id, r._p ?? r.points, r._a ?? r.active)}
                className="btn-bounce inline-flex items-center gap-1 rounded-full bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              >
                <Save className="h-4 w-4" /> Salvar
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 type-small text-muted-foreground">
          Dica: marque eventos manualmente nas reservas (presença/falta) ou ajuste pontos por aluno conforme necessário.
        </p>
      </section>

      <section className="plane">
        <h2 className="mb-4 flex items-center gap-2 type-h3">
          <Trophy className="h-4 w-4 text-primary" /> Ranking
        </h2>
        {ranking.length === 0 ? (
          <p className="py-6 text-center type-small text-muted-foreground">Sem pontuações ainda.</p>
        ) : (
          <ol className="space-y-2">
            {ranking.map((r, i) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full type-micro font-bold type-data ${
                  i === 0 ? "bg-primary text-primary-foreground" :
                  i === 1 ? "bg-secondary" : "bg-muted"
                }`}>{i + 1}</span>
                <Link to="/admin/aluno/$id" params={{ id: r.id }} className="flex-1 font-medium hover:underline">
                  {r.full_name ?? "Aluno"}
                </Link>
                <span className="font-bold text-foreground type-data">{r.points} pts</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
