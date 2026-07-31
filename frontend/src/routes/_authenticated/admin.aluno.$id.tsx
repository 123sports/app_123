import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Phone, AlertTriangle, Cake, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/money";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/aluno/$id")({
  component: AlunoDetalhe,
});

function AlunoDetalhe() {
  const { id } = Route.useParams();
  const { staffRole } = Route.useRouteContext();
  const [profile, setProfile] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [points, setPoints] = useState(0);
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: bs }, { data: ev }] = await Promise.all([
        (supabase as any).rpc("get_student_for_professor", { _student_id: id }),
        supabase
          .from("bookings")
          .select("id, booking_date, start_hour, type, status, payment_status, amount_cents, attended")
          .eq("user_id", id)
          .order("booking_date", { ascending: false }),
        staffRole === "admin"
          ? supabase.from("gamification_events").select("points").eq("user_id", id)
          : Promise.resolve({ data: [] }),
      ]);
      setProfile(p);
      setBookings(bs ?? []);
      setPoints((ev ?? []).reduce((s: number, e: any) => s + (e.points ?? 0), 0));
      if (p?.avatar_url) {
        const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(p.avatar_url, 3600);
        setAvatar(signed?.signedUrl ?? null);
      }
    })();
  }, [id, staffRole]);

  const total = bookings.length;
  const attended = bookings.filter((b) => b.attended === true).length;
  const missed = bookings.filter((b) => b.attended === false).length;
  const unpaid = bookings.filter((b) => b.payment_status === "pendente").length;
  const revenue = bookings.filter((b) => b.payment_status === "pago").reduce((s, b) => s + (b.amount_cents ?? 0), 0);

  return (
    <div className="space-y-4">
      <Link to="/admin/alunos" className="btn-bounce inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Alunos
      </Link>

      {!profile ? (
        <p className="text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-4 py-2">
            <div className="h-20 w-20 overflow-hidden rounded-full border-2 border-primary/40 bg-primary text-2xl font-bold text-primary-foreground flex items-center justify-center">
              {avatar ? <img src={avatar} alt={profile.full_name ?? ""} className="h-full w-full object-cover" />
                : (profile.full_name ?? "?").split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="flex-1">
              <h1 className="type-h2">{profile.full_name ?? "Sem nome"}</h1>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 type-small text-muted-foreground">
                {profile.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {profile.phone}</span>}
                {profile.birth_date && <span className="inline-flex items-center gap-1"><Cake className="h-3 w-3" /> {format(new Date(profile.birth_date + "T00:00:00"), "dd/MM/yyyy")}</span>}
                {profile.skill_level && <span>· {profile.skill_level}</span>}
              </div>
            </div>
            {staffRole === "admin" && (
              <div className="text-right">
                <div className="type-eyebrow">Pontos</div>
                <div className="flex items-center justify-end gap-1 text-2xl font-bold type-data text-primary">
                  <Trophy className="h-5 w-5" /> {points}
                </div>
              </div>
            )}
          </header>

          <section className={`grid auto-rows-fr gap-4 sm:grid-cols-2 ${staffRole === "admin" ? "lg:grid-cols-5" : "lg:grid-cols-3"}`}>
            <Mini label="Reservas" value={total} />
            <Mini label="Presenças" value={attended} accent="good" />
            <Mini label="Faltas" value={missed} accent="bad" />
            {staffRole === "admin" && (
              <>
                <Mini label="Pgto. pendente" value={unpaid} accent={unpaid ? "bad" : undefined} />
                <Mini label="Receita gerada" value={brl(revenue)} />
              </>
            )}
          </section>

          <section className="grid auto-rows-fr gap-4 lg:grid-cols-2">
            <div className="bg-card/30 p-5 h-full">
              <h2 className="type-h3 mb-3">Emergência</h2>
              <div className="space-y-2 text-sm">
                <Row label="Contato" value={profile.emergency_contact_name ?? "—"} />
                <Row label="Telefone" value={profile.emergency_contact_phone ?? "—"} />
                <Row label="Tipo sanguíneo" value={profile.blood_type ?? "—"} />
                {profile.medical_notes && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <div className="mb-1 flex items-center gap-1 font-semibold text-destructive">
                      <AlertTriangle className="h-3 w-3" /> Observação médica
                    </div>
                    {profile.medical_notes}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-card/30 p-5 h-full">
              <h2 className="type-h3 mb-3">Histórico de reservas</h2>
              {bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma reserva ainda.</p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto pr-1 text-sm">
                  {bookings.map((b) => (
                    <li key={b.id} className="flex items-center justify-between bg-secondary px-3 py-2">
                      <div>
                        <div className="type-data font-medium">{format(new Date(b.booking_date + "T00:00:00"), "dd/MM/yy")} · {String(b.start_hour).padStart(2, "0")}:00</div>
                        <div className="type-micro text-muted-foreground">{b.type.replace("_", " ")}</div>
                      </div>
                      <div className="text-right">
                        <Badge color={b.payment_status === "pago" ? "good" : "warn"}>{b.payment_status}</Badge>
                        {b.attended === true && <span className="ml-1 type-micro text-primary">presente</span>}
                        {b.attended === false && <span className="ml-1 type-micro text-destructive">faltou</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: any; accent?: "good" | "bad" }) {
  const c = accent === "good" ? "text-primary" : accent === "bad" ? "text-destructive" : "";
  return (
    <div className="bg-card/30 p-5 h-full">
      <div className="type-eyebrow">{label}</div>
      <div className={`mt-1 text-xl font-bold type-data ${c}`}>{value}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span>{value}</span></div>
  );
}
function Badge({ color, children }: { color: "good" | "warn"; children: any }) {
  const c = color === "good" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${c}`}>{children}</span>;
}
