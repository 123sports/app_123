import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Star, Check, X, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { format } from "date-fns";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/feedbacks")({
  component: AdminFeedbacks,
});

type Feedback = {
  id: string;
  student_id: string | null;
  professor_id: string;
  rating: number;
  comment: string | null;
  is_anonymous: boolean;
  public_consent: boolean;
  approved_admin: boolean;
  approved_professor: boolean;
  featured: boolean;
  created_at: string;
};

function AdminFeedbacks() {
  const { staffRole } = Route.useRouteContext();
  const [rows, setRows] = useState<Feedback[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "pending" | "featured">("all");

  const load = async () => {
    const { data } = await (supabase as any)
      .from("professor_feedback")
      .select("*")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as Feedback[]);
    const ids = new Set<string>();
    (data ?? []).forEach((r: Feedback) => {
      ids.add(r.professor_id);
      if (r.student_id) ids.add(r.student_id);
    });
    if (ids.size) {
      const { data: pf } = await (supabase as any).from("profiles_public").select("id, full_name").in("id", [...ids]);
      setNames(Object.fromEntries((pf ?? []).map((p: any) => [p.id, p.full_name ?? "—"])));
    }
  };
  useEffect(() => { load(); }, []);

  const update = async (id: string, patch: Partial<Feedback>) => {
    playPop();
    const { error } = await (supabase as any).from("professor_feedback").update(patch).eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível atualizar o feedback. Tente de novo.");
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } as Feedback : r)));
    toast.success("Atualizado");
  };

  const remove = async (id: string) => {
    playPop();
    if (!confirm("Excluir este feedback?")) return;
    const { error } = await (supabase as any).from("professor_feedback").delete().eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível remover o feedback. Tente de novo.");
    setRows((rs) => rs.filter((r) => r.id !== id));
    toast.success("Removido");
  };

  const filtered = rows.filter((r) => {
    if (filter === "pending") {
      return staffRole === "admin" ? !r.approved_admin : !r.approved_professor;
    }
    if (filter === "featured") return r.featured;
    return true;
  });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${staffRole === "admin" ? "Admin" : "Professor"} · Feedbacks`}
        title="Feedbacks dos alunos"
        subtitle={staffRole === "admin"
          ? "Aprove e destaque depoimentos para divulgar na landing page."
          : "Consulte e aprove os feedbacks recebidos dos seus alunos."}
        actions={
          <>
            {(["all", "pending", "featured"] as const).map((f) => (
              <button
                key={f}
                onClick={() => { playPop(); setFilter(f); }}
                className={`btn-bounce rounded-full border px-3 py-1.5 type-small ${filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent"}`}
              >
                {f === "all" ? "Todos" : f === "pending" ? "Pendentes" : "Destacados"}
              </button>
            ))}
          </>
        }
      />

      <div className="grid gap-4 auto-rows-fr md:grid-cols-2">
        {filtered.map((r) => (
          <div key={r.id} className="plane h-full">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 type-small">
                  <span className="font-semibold">Para:</span>
                  <span>{names[r.professor_id] ?? "—"}</span>
                </div>
                <div className="type-micro text-muted-foreground">
                  De: {r.is_anonymous ? "Anônimo" : (r.student_id ? (names[r.student_id] ?? "—") : "—")}
                  {" · "}
                  <span className="type-data">{format(new Date(r.created_at), "dd/MM/yy HH:mm")}</span>
                </div>
              </div>
              {staffRole === "admin" && (
                <button onClick={() => remove(r.id)} className="btn-bounce rounded-full border border-border p-1.5 hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </button>
              )}
            </div>
            <div className="my-3 flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={`h-4 w-4 ${n <= r.rating ? "fill-primary text-primary" : "text-muted-foreground/40"}`} />
              ))}
            </div>
            {r.comment && <p className="type-small text-muted-foreground italic">"{r.comment}"</p>}
            <div className="mt-4 flex flex-wrap gap-2 type-micro">
              <span className={`rounded-full px-2 py-0.5 ${r.public_consent ? "bg-secondary text-foreground" : "bg-muted text-muted-foreground"}`}>
                {r.public_consent ? "Aluno autorizou divulgar" : "Sem autorização pública"}
              </span>
              {r.approved_professor && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-foreground">Aprovado prof.</span>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => update(
                  r.id,
                  staffRole === "admin"
                    ? { approved_admin: !r.approved_admin }
                    : { approved_professor: !r.approved_professor },
                )}
                className={`btn-bounce inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 type-small font-semibold ${(staffRole === "admin" ? r.approved_admin : r.approved_professor) ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}
              >
                {(staffRole === "admin" ? r.approved_admin : r.approved_professor) ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {(staffRole === "admin" ? r.approved_admin : r.approved_professor) ? "Aprovado" : "Aprovar"}
              </button>
              {staffRole === "admin" && (
                <button
                  disabled={!r.public_consent || !r.approved_admin}
                  onClick={() => update(r.id, { featured: !r.featured })}
                  title={!r.public_consent ? "Aluno não autorizou divulgação" : !r.approved_admin ? "Aprove primeiro" : ""}
                  className={`btn-bounce inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 type-small font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${r.featured ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}
                >
                  <Sparkles className="h-3 w-3" />
                  {r.featured ? "Destacado na landing" : "Destacar na landing"}
                </button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-secondary p-12 text-center type-small text-muted-foreground">
            Nenhum feedback {filter === "pending" ? "pendente" : filter === "featured" ? "destacado" : "ainda"}.
          </div>
        )}
      </div>
    </div>
  );
}
