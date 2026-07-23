import { useEffect, useState } from "react";
import { Trophy, Swords } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Stats = {
  user_id: string;
  level_name: string | null;
  level_color: string | null;
  level_slug: string | null;
  matches_played: number;
  certificates_count: number;
};

// Simple in-memory cache (request-deduped) for stats during the session.
const cache = new Map<string, Stats>();
const inflight = new Map<string, Promise<Stats | null>>();

async function fetchStats(userIds: string[]): Promise<Stats[]> {
  const missing = userIds.filter((id) => !cache.has(id) && !inflight.has(id));
  if (missing.length > 0) {
    const p = (async () => {
      const { data, error } = await (supabase as any).rpc("get_players_stats", { _user_ids: missing });
      if (error || !data) return null;
      for (const row of data as Stats[]) cache.set(row.user_id, row);
      return null;
    })();
    for (const id of missing) inflight.set(id, p as any);
    await p;
    for (const id of missing) inflight.delete(id);
  }
  // Await any inflight requests covering requested ids
  const pending = userIds.map((id) => inflight.get(id)).filter(Boolean) as Promise<unknown>[];
  if (pending.length) await Promise.all(pending);
  return userIds.map((id) => cache.get(id)).filter(Boolean) as Stats[];
}

export function PlayerStatsLine({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [s, setS] = useState<Stats | null>(() => cache.get(userId) ?? null);

  useEffect(() => {
    let cancelled = false;
    if (cache.has(userId)) {
      setS(cache.get(userId) ?? null);
      return;
    }
    fetchStats([userId]).then((rows) => {
      if (!cancelled) setS(rows.find((r) => r.user_id === userId) ?? null);
    });
    return () => { cancelled = true; };
  }, [userId]);

  if (!s) return null;
  const hasAnything = s.level_name || s.matches_played > 0 || s.certificates_count > 0;
  if (!hasAnything) return null;

  const items: string[] = [];
  if (s.matches_played > 0) items.push(`${s.matches_played} ${s.matches_played === 1 ? "match" : "matches"}`);
  if (s.certificates_count > 0) items.push(`${s.certificates_count} ${s.certificates_count === 1 ? "cert" : "certs"}`);

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground ${compact ? "" : ""}`}>
      {s.level_name && (
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold"
          style={{
            backgroundColor: `${s.level_color ?? "#888"}22`,
            color: s.level_color ?? undefined,
          }}
          title={`Nível ${s.level_name}`}
        >
          {s.level_name}
        </span>
      )}
      {s.matches_played > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Swords className="h-2.5 w-2.5" /> {s.matches_played}
        </span>
      )}
      {s.certificates_count > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Trophy className="h-2.5 w-2.5" /> {s.certificates_count}
        </span>
      )}
      {!s.level_name && items.length === 0 && <span className="italic opacity-60">novo por aqui</span>}
    </span>
  );
}

// Prefetch helper — call once with all visible user ids to batch the RPC.
export async function prefetchPlayerStats(userIds: string[]) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return;
  await fetchStats(unique);
}
