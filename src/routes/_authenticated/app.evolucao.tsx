import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Award, Loader2, Star, TrendingUp, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";

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
    <div className="stack-app">
      <PageHeader
        eyebrow="Minha evolução"
        title="Sua evolução"
        subtitle="Acompanhe suas avaliações, nível atual e certificados conquistados."
      />

      {/* Current level card */}
      <section
        className="plane plane-hero relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${currentLevel?.color ?? "#b6f24a"}33, transparent)`,
        }}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="type-eyebrow text-muted-foreground">
              Nível atual
            </div>
            <div className="mt-1 text-4xl font-bold" style={{ color: currentLevel?.color }}>
              {currentLevel?.name ?? "Iniciante"}
            </div>
            <div className="mt-1 type-small text-muted-foreground">
              Média {currentLevel?.avg.toFixed(2)} em {currentLevel?.count} avaliações (últimos 90 dias)
            </div>
          </div>
          <Trophy className="h-16 w-16 opacity-80" style={{ color: currentLevel?.color }} />
        </div>

        {nextLevel && (
          <div className="mt-5">
            <div className="mb-1 flex justify-between type-micro text-muted-foreground">
              <span>Próximo: <strong className="text-foreground">{nextLevel.name}</strong></span>
              <span className="type-data">{currentLevel?.avg.toFixed(1)} / {Number(nextLevel.min_score).toFixed(1)}</span>
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
        <h2 className="mb-3 flex items-center gap-2 type-h2">
          <Award className="h-5 w-5 text-primary" /> Certificados
        </h2>
        {certs.length === 0 ? (
          <div className="plane border-dashed p-6 text-center type-small text-muted-foreground">
            Você ainda não tem certificados. Continue treinando e o primeiro vem logo!
          </div>
        ) : (
          <div className="grid gap-4 auto-rows-fr sm:grid-cols-2 lg:grid-cols-3">
            {certs.map((c) => {
              const lvl = certLevels.get(c.level_id);
              return (
                <div
                  key={c.id}
                  className="plane relative h-full overflow-hidden border-2"
                  style={{ borderColor: lvl?.color ?? "#b6f24a" }}
                >
                  <div className="absolute right-3 top-3 opacity-30">
                    <Award className="h-12 w-12" style={{ color: lvl?.color }} />
                  </div>
                  <div className="type-eyebrow text-muted-foreground">
                    Certificado
                  </div>
                  <div className="mt-1 type-h3 text-2xl" style={{ color: lvl?.color }}>
                    {lvl?.name ?? "Nível"}
                  </div>
                  <div className="mt-1 type-micro text-muted-foreground">
                    Conquistado em {new Date(c.awarded_at).toLocaleDateString("pt-BR")}
                  </div>
                  <div className="mt-3 flex items-center justify-between type-micro">
                    <span className="text-muted-foreground">Média</span>
                    <span className="font-bold type-data">{Number(c.average_score).toFixed(2)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between type-micro">
                    <span className="text-muted-foreground">Código</span>
                    <span className="font-mono type-data">{c.code}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 type-h2">
          <TrendingUp className="h-5 w-5 text-primary" /> Histórico de avaliações
        </h2>
        {evals.length === 0 ? (
          <div className="plane border-dashed p-6 text-center type-small text-muted-foreground">
            Nenhuma avaliação ainda. Após sua próxima aula o professor pode te avaliar aqui.
          </div>
        ) : (
          <ul className="space-y-3">
            {evals.map((e) => (
              <li key={e.id} className="plane">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <div className="type-micro text-muted-foreground">
                      {new Date(e.evaluation_date).toLocaleDateString("pt-BR", {
                        day: "2-digit", month: "long", year: "numeric",
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-1.5 text-base font-bold type-data">
                    <Star className="h-4 w-4 fill-current" />
                    {Number(e.overall_score).toFixed(2)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(SKILL_LABELS).map(([k, label]) => (
                    <div key={k} className="bg-secondary px-3 py-1.5 type-micro">
                      <div className="text-muted-foreground">{label}</div>
                      <div className="font-bold text-foreground type-data">{Number((e as any)[k]).toFixed(1)}</div>
                    </div>
                  ))}
                </div>
                {(e.highlights || e.improvements) && (
                  <div className="mt-3 grid gap-2 type-small sm:grid-cols-2">
                    {e.highlights && (
                      <div className="border border-border bg-secondary p-3">
                        <div className="mb-1 type-eyebrow text-primary">Destaques</div>
                        <p className="text-foreground">{e.highlights}</p>
                      </div>
                    )}
                    {e.improvements && (
                      <div className="border border-border bg-secondary p-3">
                        <div className="mb-1 type-eyebrow text-muted-foreground">A melhorar</div>
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
