import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FeedbackForm } from "@/components/FeedbackForm";

export const Route = createFileRoute("/_authenticated/app/feedback")({
  component: AppFeedback,
});

type Prof = { id: string; full_name: string | null; avatar_url: string | null };

function AppFeedback() {
  const [userId, setUserId] = useState<string | null>(null);
  const [professors, setProfessors] = useState<Prof[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Prof | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setUserId(u.user?.id ?? null);
      const { data: profIds } = await supabase.from("user_roles").select("user_id").eq("role", "professor");
      const ids = (profIds ?? []).map((r: any) => r.user_id);
      if (!ids.length) return;
      const { data: pf } = await (supabase as any).from("profiles_public").select("id, full_name, avatar_url").in("id", ids);
      const list = (pf ?? []) as Prof[];
      setProfessors(list);
      const entries = await Promise.all(
        list.map(async (p) => {
          if (!p.avatar_url) return [p.id, ""] as const;
          const { data: s } = await supabase.storage.from("avatars").createSignedUrl(p.avatar_url, 3600);
          return [p.id, s?.signedUrl ?? ""] as const;
        })
      );
      setAvatars(Object.fromEntries(entries));
    })();
  }, []);

  return (
    <div className="space-y-6 animate-float-in">
      <div>
        <h1 className="text-3xl font-bold">Avaliar professores</h1>
        <p className="text-muted-foreground">Conte como tem sido aprender — seu feedback ajuda muito.</p>
      </div>

      {!selected ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {professors.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className="btn-bounce flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-soft hover:border-primary"
            >
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground font-bold">
                {avatars[p.id]
                  ? <img src={avatars[p.id]} alt={p.full_name ?? ""} className="h-full w-full object-cover" />
                  : (p.full_name ?? "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div>
                <div className="font-semibold">{p.full_name ?? "Professor"}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Star className="h-3 w-3" /> Avaliar
                </div>
              </div>
            </button>
          ))}
          {professors.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
              Nenhum professor cadastrado ainda.
            </div>
          )}
        </div>
      ) : userId ? (
        <div className="space-y-3">
          <button
            onClick={() => setSelected(null)}
            className="btn-bounce text-sm text-muted-foreground hover:text-foreground"
          >
            ← Trocar professor
          </button>
          <FeedbackForm
            professorId={selected.id}
            professorName={selected.full_name ?? "Professor"}
            studentId={userId}
            onDone={() => setSelected(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
