import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Award, Loader2, Star, TrendingUp, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/app/evolucao")({
  component: StudentEvolution,
});

const SKILL_LABELS: Record<string, string> = {
  score_forehand: "Forehand",
  score_backhand: "Backhand",
  score_serve: "Saque",
  score_volley: "Volley",
  score_mental: "Mental",
  score_fitness: "Físico",
};

type Eval = {
  id: string;
  evaluation_date: string;
  overall_score: number;
  score_forehand: number;
  score_backhand: number;
  score_serve: number;
  score_volley: number;
  score_mental: number;
  score_fitness: number;
  highlights: string | null;
  improvements: string | null;
};
type Level = { id: string; name: string; slug: string; color: string; min_score: number; rank_order: number };
type Cert = {
  id: string;
  level_id: string;
  awarded_at: string;
  average_score: number;
  code: string;
};

function StudentEvolution() {
  const [loading, setLoading] = useState(true);
  const [evals, setEvals] = useState<Eval[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [currentLevel, setCurrentLevel] = useState<{
    name: string;
    color: string;
    avg: number;
    count: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: e }, { data: lv }, { data: ct }, { data: lvlData }] = await Promise.all([
        (supabase as any)
          .from("student_evaluations")
          .select("*")
          .eq("student_id", u.user.id)
          .order("evaluation_date", { ascending: false })
          .limit(20),
        (supabase as any).from("student_levels").select("*").order("rank_order"),
        (supabase as any)
          .from("certificates")
          .select("*")
          .eq("student_id", u.user.id)
          .order("awarded_at", { ascending: false }),
        (supabase as any).rpc("get_student_level", { _student_id: u.user.id }),
      ]);
      setEvals((e as Eval[]) ?? []);
      setLevels((lv as Level[]) ?? []);
      setCerts((ct as Cert[]) ?? []);
      const lvl = (lvlData as any[])?.[0];
      if (lvl) {
        setCurrentLevel({
          name: lvl.name ?? "Iniciante",
          color: lvl.color ?? "#b6f24a",
          avg: Number(lvl.avg_score ?? 0),
          count: lvl.evals ?? 0,
        });
      }
      setLoading(false);
    })();
  }, []);

  const certLevels = useMemo(() => new Map(levels.map((l) => [l.id, l])), [levels]);

  // progress to next level
  const nextLevel = useMemo(() => {
    if (!currentLevel) return null;
    const cur = levels.find((l) => l.name === currentLevel.name);
    if (!cur) return levels[0] ?? null;
    return levels.find((l) => l.rank_order === cur.rank_order + 1) ?? null;
  }, [currentLevel, levels]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Sua evolução</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe suas avaliações, nível atual e certificados conquistados.
        </p>
      </header>

      {/* Current level card */}
      <section
        className="relative overflow-hidden rounded-3xl border border-border p-6 shadow-soft"
        style={{
          background: `linear-gradient(135deg, ${currentLevel?.color ?? "#b6f24a"}33, transparent)`,
        }}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Nível atual
            </div>
            <div className="mt-1 text-4xl font-bold" style={{ color: currentLevel?.color }}>
              {currentLevel?.name ?? "Iniciante"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Média {currentLevel?.avg.toFixed(2)} em {currentLevel?.count} avaliações (últimos 90 dias)
            </div>
          </div>
          <Trophy className="h-16 w-16 opacity-80" style={{ color: currentLevel?.color }} />
        </div>

        {nextLevel && (
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Próximo: <strong className="text-foreground">{nextLevel.name}</strong></span>
              <span>{currentLevel?.avg.toFixed(1)} / {Number(nextLevel.min_score).toFixed(1)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    ((currentLevel?.avg ?? 0) / Number(nextLevel.min_score)) * 100,
                  )}%`,
                  background: nextLevel.color,
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Certificates */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-xl font-bold">
          <Award className="h-5 w-5 text-primary" /> Certificados
        </h2>
        {certs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Você ainda não tem certificados. Continue treinando e o primeiro vem logo!
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {certs.map((c) => {
              const lvl = certLevels.get(c.level_id);
              return (
                <div
                  key={c.id}
                  className="relative overflow-hidden rounded-2xl border-2 p-5 shadow-soft"
                  style={{ borderColor: lvl?.color ?? "#b6f24a" }}
                >
                  <div className="absolute right-3 top-3 opacity-30">
                    <Award className="h-12 w-12" style={{ color: lvl?.color }} />
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Certificado
                  </div>
                  <div className="mt-1 text-2xl font-bold" style={{ color: lvl?.color }}>
                    {lvl?.name ?? "Nível"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Conquistado em {new Date(c.awarded_at).toLocaleDateString("pt-BR")}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Média</span>
                    <span className="font-bold">{Number(c.average_score).toFixed(2)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Código</span>
                    <span className="font-mono">{c.code}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-xl font-bold">
          <TrendingUp className="h-5 w-5 text-primary" /> Histórico de avaliações
        </h2>
        {evals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Nenhuma avaliação ainda. Após sua próxima aula o professor pode te avaliar aqui.
          </div>
        ) : (
          <ul className="space-y-3">
            {evals.map((e) => (
              <li key={e.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(e.evaluation_date).toLocaleDateString("pt-BR", {
                        day: "2-digit", month: "long", year: "numeric",
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-primary/15 px-4 py-1.5 text-base font-bold text-primary">
                    <Star className="h-4 w-4 fill-primary" />
                    {Number(e.overall_score).toFixed(2)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(SKILL_LABELS).map(([k, label]) => (
                    <div key={k} className="rounded-lg bg-secondary/50 px-3 py-1.5 text-xs">
                      <div className="text-muted-foreground">{label}</div>
                      <div className="font-bold text-foreground">{Number((e as any)[k]).toFixed(1)}</div>
                    </div>
                  ))}
                </div>
                {(e.highlights || e.improvements) && (
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    {e.highlights && (
                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                        <div className="mb-1 text-xs font-semibold text-primary">Destaques</div>
                        <p className="text-foreground">{e.highlights}</p>
                      </div>
                    )}
                    {e.improvements && (
                      <div className="rounded-lg border border-border bg-secondary/30 p-3">
                        <div className="mb-1 text-xs font-semibold text-muted-foreground">A melhorar</div>
                        <p className="text-foreground">{e.improvements}</p>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
