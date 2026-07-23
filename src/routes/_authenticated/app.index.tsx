import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarDays, Clock, Trophy, User as UserIcon, BellRing, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/app/")({
  component: Dashboard,
});

type Booking = {
  id: string;
  booking_date: string;
  start_hour: number;
  type: string;
  status: string;
  confirmed_at?: string | null;
};

function Dashboard() {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [needsConfirm, setNeedsConfirm] = useState<Booking[]>([]);
  const [stats, setStats] = useState({ total: 0, this_month: 0 });

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: p } = await supabase.from("profiles").select("full_name, avatar_url").eq("id", u.user.id).maybeSingle();
    setName(p?.full_name ?? "");
    if (p?.avatar_url) {
      const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(p.avatar_url, 3600);
      setAvatar(signed?.signedUrl ?? null);
    }
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
    const { data: ups } = await supabase
      .from("bookings")
      .select("id, booking_date, start_hour, type, status, confirmed_at")
      .eq("user_id", u.user.id)
      .gte("booking_date", today)
      .order("booking_date")
      .order("start_hour")
      .limit(5);
    setUpcoming(ups ?? []);
    setNeedsConfirm((ups ?? []).filter((b: any) =>
      !b.confirmed_at && b.status !== "cancelada" &&
      (b.booking_date === today || b.booking_date === tomorrow),
    ));
    const monthStart = new Date(); monthStart.setDate(1);
    const { count: total } = await supabase.from("bookings").select("id", { count: "exact", head: true }).eq("user_id", u.user.id);
    const { count: month } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", u.user.id)
      .gte("booking_date", monthStart.toISOString().slice(0, 10));
    setStats({ total: total ?? 0, this_month: month ?? 0 });
  };
  useEffect(() => { load(); }, []);

  const confirm = async (id: string) => {
    const { error } = await (supabase.from("bookings") as any).update({
      confirmed_at: new Date().toISOString(), status: "confirmada",
    }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Presença confirmada!");
    load();
  };

  const initials = (name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="space-y-8 animate-float-in">
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-soft">
        <div className="flex items-center gap-6">
          <div className="relative shrink-0">
            <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-primary via-accent to-primary opacity-70 blur-md" aria-hidden />
            <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-primary bg-secondary text-3xl font-bold text-primary-foreground sm:h-36 sm:w-36">
              {avatar ? (
                <img src={avatar} alt={name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-primary">{initials}</span>
              )}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">Olá,</p>
            <h1 className="mt-1 truncate text-3xl font-bold sm:text-4xl">{name || "jogador"}!</h1>
            <p className="mt-2 max-w-md text-muted-foreground">
              Pronto pra entrar em quadra? Veja seus próximos horários ou agende um novo.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link to="/app/agenda" className="btn-bounce rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow">
                Reservar horário
              </Link>
              <Link to="/app/perfil" className="btn-bounce rounded-full border border-border bg-background px-5 py-2.5 text-sm font-semibold">
                Completar perfil
              </Link>
            </div>
          </div>
        </div>
      </section>


      {needsConfirm.length > 0 && (
        <section className="rounded-2xl border-2 border-primary bg-primary/10 p-5 shadow-glow">
          <div className="mb-3 flex items-center gap-2">
            <BellRing className="h-5 w-5 text-primary animate-bounce-ball" style={{ animationDuration: "2s" }} />
            <h2 className="font-bold">Confirme sua presença</h2>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Você tem reservas próximas. Confirme para garantir seu horário e evitar penalidades.
          </p>
          <ul className="space-y-2">
            {needsConfirm.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded-xl bg-background/60 p-3">
                <div>
                  <div className="font-semibold">
                    {format(new Date(b.booking_date + "T00:00:00"), "EEEE, dd/MM", { locale: ptBR })} · {String(b.start_hour).padStart(2, "0")}:00
                  </div>
                  <div className="text-xs text-muted-foreground">{labelType(b.type)}</div>
                </div>
                <button
                  onClick={() => confirm(b.id)}
                  className="btn-bounce inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  <Check className="h-4 w-4" /> Confirmar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard icon={Trophy} label="Total de reservas" value={stats.total} />
        <StatCard icon={CalendarDays} label="Este mês" value={stats.this_month} />
        <StatCard icon={Clock} label="Antecedência máx." value="1 mês" />
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Próximas reservas</h2>
          <Link to="/app/agenda" className="text-sm font-medium text-primary hover:underline">Ver agenda →</Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
            <UserIcon className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-muted-foreground">Nenhuma reserva ainda. Que tal agendar a primeira?</p>
            <Link to="/app/agenda" className="btn-bounce mt-4 inline-block rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">
              Reservar agora
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-soft">
                <div>
                  <div className="text-sm text-muted-foreground">
                    {format(new Date(b.booking_date + "T00:00:00"), "EEEE, dd 'de' MMMM", { locale: ptBR })}
                  </div>
                  <div className="font-semibold">
                    {String(b.start_hour).padStart(2, "0")}:00 · {labelType(b.type)}
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  b.status === "confirmada" ? "bg-primary/20 text-foreground" : "bg-muted text-muted-foreground"
                }`}>
                  {b.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{label}</div>
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="mt-2 text-3xl font-bold">{value}</div>
    </div>
  );
}

export function labelType(t: string) {
  return {
    quadra_livre: "Quadra livre",
    aula_individual: "Aula individual",
    aula_dupla: "Aula em dupla",
    aula_trio: "Aula em trio",
    aula_quarteto: "Aula em quarteto",
  }[t] ?? t;
}
