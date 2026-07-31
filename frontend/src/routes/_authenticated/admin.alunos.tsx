import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PersonList, PersonRow, PersonStat } from "@/components/PersonList";

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
      const { data } = await (supabase as any).rpc("list_students_for_staff");
      setList((data ?? []) as Aluno[]);
    })();
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? list.filter((a) => (a.full_name ?? "").toLowerCase().includes(t)) : list;
  }, [list, q]);

  return (
    <div className="stack-app">
      <PageHeader
        eyebrow="Admin · Alunos"
        title="Alunos"
        subtitle={`${list.length} aluno(s) cadastrado(s).`}
        actions={
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nome…"
              className="w-64 rounded-full border border-input bg-background pl-9 pr-3 py-2 text-sm"
            />
          </div>
        }
      />

      <div className="plane">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Nenhum aluno.</p>
        ) : (
          <PersonList>
            {filtered.map((a) => (
              <PersonRow
                key={a.id}
                to="/admin/aluno/$id"
                params={{ id: a.id }}
                name={a.full_name ?? "Sem nome"}
                meta={`${a.phone ?? "—"}${a.skill_level ? ` · ${a.skill_level}` : ""}`}
                trailing={
                  <>
                    <PersonStat label="Reservas" value={a.bookings} />
                    <PersonStat label="Presenças" value={a.attended} />
                    <PersonStat label="Faltas" value={a.missed} tone="danger" />
                  </>
                }
              />
            ))}
          </PersonList>
        )}
      </div>
    </div>
  );
}
