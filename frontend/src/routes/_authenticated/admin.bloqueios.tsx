import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Trash2, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { format } from "date-fns";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/bloqueios")({
  component: AdminBloqueios,
});

type Block = {
  id: string;
  block_date: string;
  start_hour: number;
  reason: string | null;
  professor_id: string | null;
  blocked_by: string;
  created_at: string;
};

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

function AdminBloqueios() {
  const { staffRole } = Route.useRouteContext();
  const [rows, setRows] = useState<Block[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [professors, setProfessors] = useState<{ id: string; full_name: string | null }[]>([]);
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [hours, setHours] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState("");
  const [profId, setProfId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data } = await (supabase as any)
      .from("blocked_slots")
      .select("*")
      .gte("block_date", format(new Date(), "yyyy-MM-dd"))
      .order("block_date")
      .order("start_hour");
    setRows((data ?? []) as Block[]);
    const ids = new Set<string>();
    (data ?? []).forEach((r: Block) => { if (r.professor_id) ids.add(r.professor_id); });
    if (ids.size) {
      const { data: pf } = await (supabase as any).from("profiles_public").select("id, full_name").in("id", [...ids]);
      setNames(Object.fromEntries((pf ?? []).map((p: any) => [p.id, p.full_name ?? "—"])));
    }
  };

  useEffect(() => {
    (async () => {
      load();
      const { data: auth } = await supabase.auth.getUser();
      setUserId(auth.user?.id ?? null);
      if (staffRole === "professor" && auth.user) {
        setProfId(auth.user.id);
      } else {
        const { data: professorRows } = await (supabase as any).rpc("list_active_professors");
        setProfessors(professorRows ?? []);
      }
    })();
  }, [staffRole]);

  const toggle = (h: number) => {
    playPop();
    setHours((p) => {
      const n = new Set(p);
      if (n.has(h)) n.delete(h);
      else n.add(h);
      return n;
    });
  };

  const create = async () => {
    if (hours.size === 0) return toast.error("Selecione ao menos um horário");
    playPop();
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setLoading(false); return; }
    const inserts = Array.from(hours).map((h) => ({
      block_date: date,
      start_hour: h,
      reason: reason.trim() || null,
      professor_id: profId || null,
      blocked_by: u.user!.id,
    }));
    const { error } = await (supabase as any).from("blocked_slots").insert(inserts);
    setLoading(false);
    if (error) return toast.error(error?.message ?? "Não foi possível criar o bloqueio. Tente de novo.");
    toast.success(`${hours.size} horário${hours.size > 1 ? "s" : ""} bloqueado${hours.size > 1 ? "s" : ""}`);
    setHours(new Set());
    setReason("");
    load();
  };

  const remove = async (id: string) => {
    playPop();
    const { error } = await (supabase as any).from("blocked_slots").delete().eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível remover o bloqueio. Tente de novo.");
    setRows((rs) => rs.filter((r) => r.id !== id));
    toast.success("Bloqueio removido");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${staffRole === "admin" ? "Admin" : "Professor"} · Bloqueios`}
        title="Bloqueios de horário"
        subtitle={staffRole === "admin"
          ? "Trave horários quando a quadra estiver indisponível."
          : "Bloqueie horários em que você não poderá ministrar aulas."}
      />

      <div className="plane">
        <div className="grid gap-4 md:grid-cols-[200px_1fr]">
          <div className="space-y-3">
            <div>
              <label className="type-eyebrow mb-1 block">Data</label>
              <input
                type="date"
                value={date}
                min={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {staffRole === "admin" ? (
              <div>
                <label className="type-eyebrow mb-1 block">Aplica a</label>
                <select
                  value={profId}
                  onChange={(e) => setProfId(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Quadra toda (geral)</option>
                  {professors.map((p) => (
                    <option key={p.id} value={p.id}>Só prof. {p.full_name ?? "—"}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <span className="type-eyebrow mb-1 block">Aplica a</span>
                <p className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm">Minha agenda</p>
              </div>
            )}
            <div>
              <label className="type-eyebrow mb-1 block">Motivo (opcional)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={120}
                placeholder="Ex.: manutenção, evento"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <div className="type-eyebrow mb-2">Selecione os horários</div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {HOURS.map((h) => (
                <button
                  key={h}
                  onClick={() => toggle(h)}
                  className={`btn-bounce type-data rounded-full border px-2 py-2 text-xs font-semibold ${hours.has(h) ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-secondary hover:border-destructive"}`}
                >
                  {String(h).padStart(2, "0")}:00
                </button>
              ))}
            </div>
            <button
              onClick={create}
              disabled={loading || hours.size === 0}
              className="btn-bounce mt-4 inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Bloquear {hours.size > 0 ? `${hours.size} horário${hours.size > 1 ? "s" : ""}` : ""}
            </button>
          </div>
        </div>
      </div>

      <div className="plane">
        <h2 className="type-h2 mb-4">Bloqueios ativos</h2>
        {rows.length === 0 ? (
          <p className="type-small py-8 text-center text-muted-foreground">Nenhum bloqueio cadastrado.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <Lock className="h-4 w-4 text-destructive" />
                  <div>
                    <div className="type-data text-sm font-medium">
                      {format(new Date(r.block_date + "T00:00:00"), "dd/MM/yyyy")} · {String(r.start_hour).padStart(2, "0")}:00
                    </div>
                    <div className="type-small text-muted-foreground">
                      {r.professor_id ? `Só ${names[r.professor_id] ?? "professor"}` : "Quadra toda"}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </div>
                  </div>
                </div>
                {(staffRole === "admin" || r.blocked_by === userId) && (
                  <button onClick={() => remove(r.id)} className="btn-bounce rounded-full border border-border p-2 hover:bg-destructive/10">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
