import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { playPop } from "@/lib/sfx";
import { Loader2, Plus, Users, Clock, CalendarDays, X, LogIn, LogOut } from "lucide-react";
import { MatchDrawCard } from "@/components/MatchDrawCard";
import { PlayerStatsLine, prefetchPlayerStats } from "@/components/PlayerStatsLine";

export const Route = createFileRoute("/_authenticated/app/match-aberto")({
  component: MatchAbertoPage,
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
  cancelled_reason: string | null;
  creator_name?: string;
  participants?: { user_id: string; full_name: string | null }[];
};

function MatchAbertoPage() {
  const [me, setMe] = useState<string>("");
  const [tab, setTab] = useState<"abertos" | "meus">("abertos");
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    match_date: "",
    start_hour: 19,
    duration_hours: 1,
    max_players: 4,
    skill_level: "",
    notes: "",
  });

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setMe(u.user.id);
    const { data: ms } = await (supabase as any)
      .from("open_matches")
      .select("*")
      .order("match_date", { ascending: true })
      .order("start_hour", { ascending: true });
    const list = (ms ?? []) as Match[];
    const { data: parts } = list.length
      ? await (supabase as any).from("open_match_participants").select("match_id, user_id").in("match_id", list.map((m) => m.id))
      : { data: [] as any[] };
    const allIds = Array.from(new Set([
      ...list.map((m) => m.creator_id),
      ...((parts ?? []) as any[]).map((p) => p.user_id),
    ]));
    const { data: profs } = allIds.length
      ? await (supabase as any).from("profiles_public").select("id, full_name").in("id", allIds)
      : { data: [] as any[] };
    const nameOf = new Map<string, string>((profs ?? []).map((p: any) => [p.id, p.full_name]));
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
      .channel("open_matches_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "open_matches" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "open_match_participants" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    playPop();
    if (!form.match_date) {
      toast.error("Escolha uma data");
      return;
    }
    const { error } = await (supabase as any).from("open_matches").insert({
      creator_id: me,
      match_date: form.match_date,
      start_hour: form.start_hour,
      duration_hours: form.duration_hours,
      max_players: form.max_players,
      skill_level: form.skill_level || null,
      notes: form.notes || null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vaga aberta! Já apareceu pra galera 🎾");
    setCreating(false);
    setForm({ match_date: "", start_hour: 19, duration_hours: 1, max_players: 4, skill_level: "", notes: "" });
  };

  const join = async (m: Match) => {
    playPop();
    const { error } = await (supabase as any)
      .from("open_match_participants")
      .insert({ match_id: m.id, user_id: me });
    if (error) toast.error(error.message);
    else toast.success("Você entrou no match! 🎾");
  };

  const leave = async (m: Match) => {
    playPop();
    const { error } = await (supabase as any)
      .from("open_match_participants")
      .delete()
      .eq("match_id", m.id)
      .eq("user_id", me);
    if (error) toast.error(error.message);
    else toast.success("Você saiu do match.");
  };

  const cancel = async (m: Match) => {
    playPop();
    if (!confirm("Cancelar esta vaga?")) return;
    const { error } = await (supabase as any)
      .from("open_matches")
      .update({ status: "cancelado", cancelled_reason: "Cancelado pelo criador" })
      .eq("id", m.id);
    if (error) toast.error(error.message);
    else toast.success("Vaga cancelada.");
  };

  const visible = matches.filter((m) =>
    tab === "meus" ? m.creator_id === me : m.status === "aprovado" || m.status === "fechado",
  );

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Match Aberto</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Veja quem tá afim de jogar — ou abra uma vaga e chame a galera.
          </p>
        </div>
        <button
          onClick={() => { playPop(); setCreating(true); }}
          className="btn-bounce inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
        >
          <Plus className="h-4 w-4" /> Abrir vaga
        </button>
      </div>

      <div className="flex gap-2">
        {(["abertos", "meus"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { playPop(); setTab(t); }}
            className={`btn-bounce rounded-full px-4 py-2 text-sm font-medium ${
              tab === t ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground hover:bg-secondary"
            }`}
          >
            {t === "abertos" ? "Vagas abertas" : "Minhas vagas"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {tab === "abertos" ? "Nenhuma vaga aberta no momento. Que tal abrir a primeira?" : "Você ainda não abriu nenhuma vaga."}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((m) => {
            const iAmIn = m.participants?.some((p) => p.user_id === me);
            const mine = m.creator_id === me;
            const full = (m.participants?.length ?? 0) >= m.max_players;
            return (
              <div key={m.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <CalendarDays className="h-4 w-4 text-primary" />
                      {new Date(m.match_date + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                      <Clock className="ml-2 h-4 w-4 text-primary" />
                      {String(m.start_hour).padStart(2, "0")}:00 · {m.duration_hours}h
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">por {m.creator_name}</div>
                    <div className="mt-1"><PlayerStatsLine userId={m.creator_id} /></div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusBadge(m.status)}`}>
                    {m.status}
                  </span>
                </div>

                {m.skill_level && (
                  <div className="mt-3 inline-block rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                    Nível: {m.skill_level}
                  </div>
                )}
                {m.notes && <p className="mt-3 text-sm text-muted-foreground">{m.notes}</p>}

                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="h-4 w-4" />
                  {(m.participants?.length ?? 0)}/{m.max_players} confirmados
                </div>
                {m.participants && m.participants.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {m.participants.map((p) => (
                      <li key={p.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-1 text-[11px]">
                        <span>{p.full_name ?? "Aluno"}</span>
                        <PlayerStatsLine userId={p.user_id} compact />
                      </li>
                    ))}
                  </ul>
                )}
                {m.status === "cancelado" && m.cancelled_reason && (
                  <p className="mt-3 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{m.cancelled_reason}</p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {mine && m.status !== "cancelado" && (
                    <button
                      onClick={() => cancel(m)}
                      className="btn-bounce inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs hover:bg-secondary"
                    >
                      <X className="h-3.5 w-3.5" /> Cancelar vaga
                    </button>
                  )}
                  {!mine && m.status === "aprovado" && !iAmIn && !full && (
                    <button
                      onClick={() => join(m)}
                      className="btn-bounce inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                    >
                      <LogIn className="h-3.5 w-3.5" /> Quero jogar
                    </button>
                  )}
                  {!mine && iAmIn && m.status !== "cancelado" && (
                    <button
                      onClick={() => leave(m)}
                      className="btn-bounce inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs hover:bg-secondary"
                    >
                      <LogOut className="h-3.5 w-3.5" /> Sair
                    </button>
                  )}
                  {full && m.status === "aprovado" && (
                    <span className="text-xs font-semibold text-emerald-600">Match completo!</span>
                  )}
                </div>

                {(iAmIn || mine) && m.status !== "cancelado" && (m.participants?.length ?? 0) >= 4 && (
                  <MatchDrawCard
                    sourceType="open_match"
                    sourceId={m.id}
                    participants={[
                      { user_id: m.creator_id, full_name: m.creator_name ?? null },
                      ...(m.participants ?? []).filter((p) => p.user_id !== m.creator_id),
                    ]}
                    canDraw={mine}
                    startsAt={new Date(`${m.match_date}T${String(m.start_hour).padStart(2, "0")}:00:00-03:00`)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreating(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={create}
            className="w-full max-w-md space-y-3 rounded-3xl border border-border bg-card p-6 shadow-glow"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Abrir vaga pra jogar</h2>
              <button type="button" onClick={() => setCreating(false)} className="btn-bounce rounded-full p-1 hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              A vaga é publicada na hora. Se o horário não estiver livre, o sistema avisa.
              Caso alguém reserve e pague esse horário antes que o match feche, sua vaga é cancelada automaticamente.
            </p>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Data *</label>
              <input
                required
                type="date"
                value={form.match_date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setForm({ ...form, match_date: e.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Hora *</label>
                <select
                  value={form.start_hour}
                  onChange={(e) => setForm({ ...form, start_hour: Number(e.target.value) })}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                >
                  {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Duração</label>
                <select
                  value={form.duration_hours}
                  onChange={(e) => setForm({ ...form, duration_hours: Number(e.target.value) })}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                >
                  {[1, 2, 3].map((h) => <option key={h} value={h}>{h}h</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Total de jogadores</label>
                <select
                  value={form.max_players}
                  onChange={(e) => setForm({ ...form, max_players: Number(e.target.value) })}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                >
                  {[2, 3, 4].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Nível</label>
                <input
                  value={form.skill_level}
                  onChange={(e) => setForm({ ...form, skill_level: e.target.value })}
                  placeholder="iniciante, intermediário…"
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Recado</label>
              <textarea
                rows={3}
                maxLength={300}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Ex: bora rachar uma hora boa, jogo descontraído..."
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <button type="submit" className="btn-bounce w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-glow">
              Enviar vaga
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
