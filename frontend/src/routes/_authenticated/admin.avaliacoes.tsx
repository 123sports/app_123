import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Award, Loader2, Save, Star, Search, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { PageHeader } from "@/components/PageHeader";
import { useConfirmation } from "@/hooks/use-confirmation";

export const Route = createFileRoute("/_authenticated/admin/avaliacoes")({
  component: AdminEvaluations,
});

const SKILLS = [
  { key: "score_forehand", label: "Forehand" },
  { key: "score_backhand", label: "Backhand" },
  { key: "score_serve",    label: "Saque" },
  { key: "score_volley",   label: "Volley" },
  { key: "score_mental",   label: "Cabeça/Mental" },
  { key: "score_fitness",  label: "Condicionamento" },
] as const;

type Student = { id: string; full_name: string | null };
type Evaluation = {
  id: string;
  student_id: string;
  professor_id: string;
  evaluation_date: string;
  overall_score: number;
  highlights: string | null;
  improvements: string | null;
  score_forehand: number;
  score_backhand: number;
  score_serve: number;
  score_volley: number;
  score_mental: number;
  score_fitness: number;
};

const defaultScores = () => Object.fromEntries(SKILLS.map((s) => [s.key, 5])) as Record<string, number>;

function AdminEvaluations() {
  const requestConfirmation = useConfirmation();
  const { staffRole } = Route.useRouteContext();
  const [students, setStudents] = useState<Student[]>([]);
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>(defaultScores());
  const [highlights, setHighlights] = useState("");
  const [improvements, setImprovements] = useState("");

  const load = async () => {
    const [{ data: profiles }, { data: e }] = await Promise.all([
      (supabase as any).rpc("list_students_for_staff"),
      (supabase as any)
        .from("student_evaluations")
        .select("id, student_id, professor_id, evaluation_date, overall_score, highlights, improvements, score_forehand, score_backhand, score_serve, score_volley, score_mental, score_fitness")
        .order("evaluation_date", { ascending: false })
        .limit(50),
    ]);
    setStudents((profiles as Student[]) ?? []);
    setEvals((e as Evaluation[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const studentMap = useMemo(
    () => new Map(students.map((s) => [s.id, s.full_name ?? "Aluno"])),
    [students],
  );
  const filtered = useMemo(
    () =>
      students.filter((s) =>
        (s.full_name ?? "").toLowerCase().includes(q.toLowerCase()),
      ),
    [students, q],
  );

  const resetForm = () => {
    setEditingId(null);
    setSelected("");
    setHighlights("");
    setImprovements("");
    setScores(defaultScores());
  };

  const startEdit = (ev: Evaluation) => {
    playPop();
    setEditingId(ev.id);
    setSelected(ev.student_id);
    setHighlights(ev.highlights ?? "");
    setImprovements(ev.improvements ?? "");
    setScores({
      score_forehand: Number(ev.score_forehand),
      score_backhand: Number(ev.score_backhand),
      score_serve: Number(ev.score_serve),
      score_volley: Number(ev.score_volley),
      score_mental: Number(ev.score_mental),
      score_fitness: Number(ev.score_fitness),
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeEval = async (ev: Evaluation) => {
    const studentName = studentMap.get(ev.student_id) ?? "aluno";
    const evaluationDate = new Date(ev.evaluation_date).toLocaleDateString("pt-BR");
    const confirmed = await requestConfirmation({
      title: "Excluir esta avaliação?",
      description: `A avaliação de ${studentName}, feita em ${evaluationDate}, será removida permanentemente.`,
      confirmLabel: "Excluir avaliação",
      cancelLabel: "Manter avaliação",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await (supabase as any).from("student_evaluations").delete().eq("id", ev.id);
    if (error) { toast.error(error?.message ?? "Não foi possível excluir a avaliação. Tente de novo."); return; }
    toast.success("Avaliação excluída");
    if (editingId === ev.id) resetForm();
    load();
  };

  const submit = async () => {
    playPop();
    if (!selected) {
      toast.error("Selecione um aluno");
      return;
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setSaving(false); return; }

    let error;
    if (editingId) {
      const res = await (supabase as any).from("student_evaluations").update({
        student_id: selected,
        ...scores,
        highlights: highlights || null,
        improvements: improvements || null,
      }).eq("id", editingId);
      error = res.error;
    } else {
      const res = await (supabase as any).from("student_evaluations").insert({
        student_id: selected,
        professor_id: u.user.id,
        ...scores,
        highlights: highlights || null,
        improvements: improvements || null,
      });
      error = res.error;
    }
    setSaving(false);
    if (error) {
      toast.error(error?.message ?? "Não foi possível salvar a avaliação. Tente de novo.");
      return;
    }
    toast.success(editingId ? "Avaliação atualizada!" : "Avaliação registrada!");
    resetForm();
    load();
  };

  const overall =
    SKILLS.reduce((acc, s) => acc + (scores[s.key] ?? 0), 0) / SKILLS.length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${staffRole === "admin" ? "Admin" : "Professor"} · Avaliações`}
        title="Avaliações"
        subtitle="Registre a evolução do aluno após cada aula. Notas geram nível e certificados automaticamente."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Form */}
        <section className="plane">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="type-h3">
              {editingId ? "Editar avaliação" : "Nova avaliação"}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={() => { playPop(); resetForm(); }}
                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                <X className="h-3 w-3" /> Cancelar edição
              </button>
            )}
          </div>

          <label className="type-eyebrow mb-1 block">Aluno</label>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar aluno…"
              className="w-full rounded-xl border border-input bg-background py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <div className="mb-4 max-h-44 overflow-y-auto rounded-xl border border-border">
            {filtered.length === 0 && (
              <div className="type-small p-3">Nenhum aluno</div>
            )}
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { playPop(); setSelected(s.id); }}
                className={`btn-bounce flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-0 ${
                  selected === s.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                }`}
              >
                <span>{s.full_name ?? "Sem nome"}</span>
                {selected === s.id && <span className="type-micro">selecionado</span>}
              </button>
            ))}
          </div>

          {selected ? (
          <>
          <div className="space-y-3">
            {SKILLS.map((sk) => (
              <div key={sk.key}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="type-eyebrow">{sk.label}</span>
                  <span className="type-data font-bold text-primary">{scores[sk.key]?.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={scores[sk.key]}
                  onChange={(e) =>
                    setScores({ ...scores, [sk.key]: Number(e.target.value) })
                  }
                  className="on-range w-full"
                  style={{
                    background: `linear-gradient(to right, var(--foreground) ${(scores[sk.key] ?? 0) * 10}%, var(--input) ${(scores[sk.key] ?? 0) * 10}%)`,
                  }}
                />
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3">
            <textarea
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Destaques da aula (opcional)"
              className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
            <textarea
              value={improvements}
              onChange={(e) => setImprovements(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="O que melhorar (opcional)"
              className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-secondary px-4 py-3">
            <span className="text-sm text-muted-foreground">Nota geral</span>
            <span className="type-data text-2xl font-bold text-primary">{overall.toFixed(2)}</span>
          </div>

          <button
            onClick={submit}
            disabled={saving || !selected}
            className="btn-bounce mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editingId ? "Atualizar avaliação" : "Salvar avaliação"}
          </button>
          </>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Selecione um aluno acima para iniciar a avaliação.
            </div>
          )}
        </section>

        {/* History */}
        <section className="plane">
          <h2 className="type-h3 mb-3 flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" /> Últimas avaliações
          </h2>
          {evals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nenhuma avaliação registrada ainda.
            </div>
          ) : (
            <ul className="space-y-2">
              {evals.map((e) => (
                <li
                  key={e.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                    editingId === e.id ? "border-primary bg-primary/10" : "border-border bg-secondary"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {studentMap.get(e.student_id) ?? "Aluno"}
                    </div>
                    <div className="type-small">
                      {new Date(e.evaluation_date).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                  <div className="type-data flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                    <Star className="h-3.5 w-3.5 fill-primary" />
                    {Number(e.overall_score).toFixed(2)}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(e)}
                      title="Editar"
                      className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-primary"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {staffRole === "admin" && (
                      <button
                        type="button"
                        onClick={() => removeEval(e)}
                        title="Excluir"
                        className="rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
