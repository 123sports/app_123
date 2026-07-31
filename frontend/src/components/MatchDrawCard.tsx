import { useEffect, useState } from "react";
import { Shuffle, Sparkles, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";

type Participant = { user_id: string; full_name: string | null };

type Props = {
  sourceType: "open_match" | "booking";
  sourceId: string;
  participants: Participant[];
  canDraw: boolean;
  startsAt: Date;
  minPlayers?: number;
};

type Draw = {
  id: string;
  teams: string[][]; // [[uid,uid],[uid,uid]]
  updated_at: string;
};

export function MatchDrawCard({
  sourceType,
  sourceId,
  participants,
  canDraw,
  startsAt,
  minPlayers = 4,
}: Props) {
  const [draw, setDraw] = useState<Draw | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    const { data } = await (supabase as any)
      .from("match_draws")
      .select("id, teams, updated_at")
      .eq("source_type", sourceType)
      .eq("source_id", sourceId)
      .maybeSingle();
    setDraw(data ?? null);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`match_draw:${sourceType}:${sourceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_draws", filter: `source_id=eq.${sourceId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, sourceType]);

  const locked = now >= startsAt;
  const enoughPlayers = participants.length >= minPlayers;

  const nameOf = (uid: string) =>
    participants.find((p) => p.user_id === uid)?.full_name ?? "Jogador";

  const handleDraw = async () => {
    playPop();
    if (!enoughPlayers) {
      toast.error(`Precisa de pelo menos ${minPlayers} jogadores.`);
      return;
    }
    setLoading(true);
    // Fisher–Yates shuffle
    const ids = participants.map((p) => p.user_id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const teams: string[][] = [];
    for (let i = 0; i + 1 < ids.length; i += 2) {
      teams.push([ids[i], ids[i + 1]]);
    }
    if (ids.length % 2 === 1) teams.push([ids[ids.length - 1]]); // leftover solo

    const { data: u } = await supabase.auth.getUser();
    const payload = {
      source_type: sourceType,
      source_id: sourceId,
      teams,
      drawn_by: u.user?.id ?? null,
    };
    const { error } = await (supabase as any)
      .from("match_draws")
      .upsert(payload, { onConflict: "source_type,source_id" });
    setLoading(false);
    if (error) toast.error(error.message);
    else toast.success("Duplas sorteadas! 🎲");
  };

  if (!draw && !canDraw) return null;
  if (!draw && !enoughPlayers) return null;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-secondary/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          Sorteio de duplas
        </div>
        {locked && <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Lock className="h-3 w-3" /> bloqueado</span>}
      </div>

      {draw && draw.teams.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {draw.teams.map((team, idx) => (
            <div key={idx} className="rounded-xl border border-border bg-card p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Dupla {idx + 1}
              </div>
              <div className="mt-1 text-sm font-medium">
                {team.map((uid) => nameOf(uid)).join(" & ")}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ainda não foi sorteado. {canDraw && enoughPlayers ? "Clique abaixo para sortear." : ""}
        </p>
      )}

      {canDraw && !locked && enoughPlayers && (
        <button
          onClick={handleDraw}
          disabled={loading}
          className="btn-bounce mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
        >
          <Shuffle className="h-3.5 w-3.5" />
          {draw ? "Sortear novamente" : "Sortear duplas"}
        </button>
      )}
    </div>
  );
}
