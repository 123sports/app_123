import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { playPop } from "@/lib/sfx";
import { Loader2, Check, X, Users, Clock, CalendarDays, Trash2 } from "lucide-react";
import { MatchDrawCard } from "@/components/MatchDrawCard";
import { PlayerStatsLine, prefetchPlayerStats } from "@/components/PlayerStatsLine";
import { PageHeader } from "@/components/PageHeader";
import { useConfirmation } from "@/hooks/use-confirmation";

export const Route = createFileRoute("/_authenticated/admin/match-aberto")({
  component: AdminMatchAberto,
});

type Match = {
  id: string;
  creator_id: string;
  match_date: string;
  start_hour: number;
  duration_hours: number;
  max_players: number;
  skill_level: string | null;
  notes: string | null;
  status: string;
  admin_notes: string | null;
  cancelled_reason: string | null;
  creator_name?: string;
  participants?: { user_id: string; full_name: string | null }[];
};

function AdminMatchAberto() {
  const requestConfirmation = useConfirmation();
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"todos" | "pendente" | "aprovado" | "fechado" | "cancelado">("pendente");

  const load = async () => {
    setLoading(true);
    const { data: ms } = await (supabase as any)
      .from("open_matches")
      .select("*")
      .order("created_at", { ascending: false });
    const list = (ms ?? []) as Match[];
    const { data: parts } = list.length
      ? await (supabase as any).from("open_match_participants").select("match_id, user_id").in("match_id", list.map((m) => m.id))
      : { data: [] as any[] };
    const allIds = Array.from(new Set([
      ...list.map((m) => m.creator_id),
      ...((parts ?? []) as any[]).map((p) => p.user_id),
    ]));
    const { data: profs } = allIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", allIds)
      : { data: [] as any[] };
    const nameOf = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
    const partsByMatch = new Map<string, { user_id: string; full_name: string | null }[]>();
    for (const p of (parts ?? []) as any[]) {
      const arr = partsByMatch.get(p.match_id) ?? [];
      arr.push({ user_id: p.user_id, full_name: nameOf.get(p.user_id) ?? null });
      partsByMatch.set(p.match_id, arr);
    }
    setMatches(
      list.map((m) => ({
        ...m,
        creator_name: nameOf.get(m.creator_id) ?? "Aluno",
        participants: partsByMatch.get(m.id) ?? [],
      })),
    );
    prefetchPlayerStats(allIds);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin_open_matches")
      .on("postgres_changes", { event: "*", schema: "public", table: "open_matches" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "open_match_participants" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const setStatus = async (id: string, status: string, reason?: string) => {
    playPop();
    const { data: u } = await supabase.auth.getUser();
    const patch: any = { status };
    if (status === "aprovado") {
      patch.approved_at = new Date().toISOString();
      patch.approved_by = u.user?.id;
    }
    if (reason) patch.cancelled_reason = reason;
    const { error } = await (supabase as any).from("open_matches").update(patch).eq("id", id);
    if (error) toast.error(error?.message ?? "Não foi possível atualizar. Tente de novo.");
    else toast.success("Atualizado!");
  };

  const remove = async (id: string) => {
    playPop();
    const confirmed = await requestConfirmation({
      title: "Excluir esta vaga?",
      description: "A publicação do match será removida permanentemente.",
      confirmLabel: "Excluir vaga",
      cancelLabel: "Manter vaga",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await (supabase as any).from("open_matches").delete().eq("id", id);
    if (error) toast.error(error?.message ?? "Não foi possível excluir. Tente de novo.");
    else toast.success("Excluído.");
  };

  const visible = filter === "todos" ? matches : matches.filter((m) => m.status === filter);

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pendente: "bg-amber-500/15 text-amber-600",
      aprovado: "bg-emerald-500/15 text-emerald-600",
      fechado: "bg-primary/15 text-primary",
      cancelado: "bg-destructive/15 text-destructive",
    };
    return map[s] ?? "bg-secondary text-foreground";
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin · Match Aberto"
        title="Match Aberto"
        subtitle="Vagas que os alunos criaram para jogar entre si. Aprove para que apareçam na plataforma."
      />

      <div className="flex flex-wrap gap-2">
        {(["pendente", "aprovado", "fechado", "cancelado", "todos"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { playPop(); setFilter(t); }}
            className={`btn-bounce rounded-full px-3 py-1.5 text-xs font-medium capitalize ${
              filter === t ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground hover:bg-secondary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Nada por aqui.
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((m) => (
            <div key={m.id} className="plane">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    {new Date(m.match_date + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                    <Clock className="ml-2 h-4 w-4 text-primary" />
                    {String(m.start_hour).padStart(2, "0")}:00 · {m.duration_hours}h
                  </div>
                  <div className="text-xs text-muted-foreground">por <span className="font-medium text-foreground">{m.creator_name}</span></div>
                  <PlayerStatsLine userId={m.creator_id} />
                  {m.skill_level && <div className="text-xs">Nível: {m.skill_level}</div>}
                  {m.notes && <p className="max-w-xl text-sm text-muted-foreground">{m.notes}</p>}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                  <span className="type-data">
                    {1 + (m.participants?.filter((p: any) => p.user_id !== m.creator_id).length ?? 0)}/{m.max_players}
                  </span>
                  </div>
                  {m.participants && m.participants.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5">
                      {m.participants.map((p) => (
                        <li key={p.user_id} className="type-micro inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-1">
                          <span>{p.full_name ?? "Aluno"}</span>
                          <PlayerStatsLine userId={p.user_id} compact />
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.cancelled_reason && (
                    <p className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{m.cancelled_reason}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`type-micro rounded-full px-2 py-0.5 font-semibold uppercase ${statusBadge(m.status)}`}>{m.status}</span>
                  <div className="flex flex-wrap gap-1">
                    {m.status === "pendente" && (
                      <>
                        <button onClick={() => setStatus(m.id, "aprovado")} className="btn-bounce inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">
                          <Check className="h-3 w-3" /> Aprovar
                        </button>
                        <button onClick={() => setStatus(m.id, "cancelado", "Rejeitado pelo administrador")} className="btn-bounce inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs hover:bg-secondary">
                          <X className="h-3 w-3" /> Rejeitar
                        </button>
                      </>
                    )}
                    {m.status === "aprovado" && (
                      <button onClick={() => setStatus(m.id, "fechado")} className="btn-bounce inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                        Marcar como fechado
                      </button>
                    )}
                    <button onClick={() => remove(m.id)} className="btn-bounce inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs hover:bg-secondary">
                      <Trash2 className="h-3 w-3" /> Excluir
                    </button>
                  </div>
                </div>
              </div>
              {m.status !== "cancelado"
                && 1 + (m.participants?.filter((p: any) => p.user_id !== m.creator_id).length ?? 0) >= 4
                && (
                <MatchDrawCard
                  sourceType="open_match"
                  sourceId={m.id}
                  participants={[
                    { user_id: m.creator_id, full_name: m.creator_name ?? null },
                    ...(m.participants ?? []).filter((p) => p.user_id !== m.creator_id),
                  ]}
                  canDraw={true}
                  startsAt={new Date(`${m.match_date}T${String(m.start_hour).padStart(2, "0")}:00:00-03:00`)}
                />
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
