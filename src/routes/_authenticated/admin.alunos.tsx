import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/alunos")({
  component: AdminAlunos,
});

type Aluno = {
  id: string;
  full_name: string | null;
  phone: string | null;
  birth_date: string | null;
  skill_level: string | null;
  bookings: number;
  attended: number;
  missed: number;
};

function AdminAlunos() {
  const [list, setList] = useState<Aluno[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data: alunos } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "aluno");
      const ids = (alunos ?? []).map((r) => r.user_id);
      if (!ids.length) return setList([]);
      const [{ data: profs }, { data: bs }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, phone, birth_date, skill_level").in("id", ids),
        supabase.from("bookings").select("user_id, attended, status").in("user_id", ids),
      ]);
      const byUser: Record<string, { b: number; a: number; m: number }> = {};
      (bs ?? []).forEach((b: any) => {
        const e = (byUser[b.user_id] ||= { b: 0, a: 0, m: 0 });
        e.b++;
        if (b.attended === true) e.a++;
        if (b.attended === false) e.m++;
      });
      setList(
        (profs ?? []).map((p: any) => ({
          ...p,
          bookings: byUser[p.id]?.b ?? 0,
          attended: byUser[p.id]?.a ?? 0,
          missed: byUser[p.id]?.m ?? 0,
        })),
      );
    })();
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? list.filter((a) => (a.full_name ?? "").toLowerCase().includes(t)) : list;
  }, [list, q]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Alunos</h1>
          <p className="text-muted-foreground">{list.length} aluno(s) cadastrado(s).</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome…"
            className="w-64 rounded-full border border-input bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Nome</th>
              <th className="p-3">Telefone</th>
              <th className="p-3">Nível</th>
              <th className="p-3 text-right">Reservas</th>
              <th className="p-3 text-right">Presenças</th>
              <th className="p-3 text-right">Faltas</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="border-b border-border/60 hover:bg-background/40">
                <td className="p-3">
                  <Link to="/admin/aluno/$id" params={{ id: a.id }} className="font-medium hover:underline">
                    {a.full_name ?? "Sem nome"}
                  </Link>
                </td>
                <td className="p-3 text-muted-foreground">{a.phone ?? "—"}</td>
                <td className="p-3">{a.skill_level ?? "—"}</td>
                <td className="p-3 text-right">{a.bookings}</td>
                <td className="p-3 text-right text-primary">{a.attended}</td>
                <td className="p-3 text-right text-destructive">{a.missed}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhum aluno.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
