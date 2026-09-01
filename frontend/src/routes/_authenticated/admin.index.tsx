import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CalendarCheck, Users, AlertCircle, Cake, QrCode, CircleCheckBig, Clock3, ShieldAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/money";
import { PageHeader } from "@/components/PageHeader";
import { PersonList, PersonRow } from "@/components/PersonList";
import { format, startOfMonth, endOfMonth, addDays, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: StaffDashboard,
});

type BookingRow = {
  id: string;
  user_id: string;
  booking_date: string;
  start_hour: number;
  type: string;
  status: string;
  payment_status: string;
};

type CheckoutOrderRow = {
  id: string;
  user_id: string;
  status: string;
  amount_cents: number;
  description: string;
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
};

function StaffDashboard() {
  const { staffRole } = Route.useRouteContext();
  return staffRole === "admin" ? <AdminDashboard /> : <ProfessorDashboard />;
}

function ProfessorDashboard() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [feedbacks, setFeedbacks] = useState(0);

  useEffect(() => {
    (async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const [{ data: rows }, { count }] = await Promise.all([
        supabase
          .from("bookings")
          .select("id, user_id, booking_date, start_hour, type, status, payment_status")
          .gte("booking_date", today)
          .neq("status", "cancelada")
          .order("booking_date")
          .order("start_hour")
          .limit(50),
        (supabase as any)
          .from("professor_feedback")
          .select("id", { count: "exact", head: true }),
      ]);
      const nextBookings = (rows ?? []) as BookingRow[];
      setBookings(nextBookings);
      setFeedbacks(count ?? 0);

      const ids = [...new Set(nextBookings.map((booking) => booking.user_id))];
      if (ids.length) {
        const { data: profiles } = await (supabase as any)
          .from("profiles_public")
          .select("id, full_name")
          .in("id", ids);
        setNames(Object.fromEntries(
          (profiles ?? []).map((profile: any) => [profile.id, profile.full_name ?? "Aluno"]),
        ));
      }
    })();
  }, []);

  const today = format(new Date(), "yyyy-MM-dd");
  const todayBookings = bookings.filter((booking) => booking.booking_date === today);
  const studentCount = new Set(bookings.map((booking) => booking.user_id)).size;

  return (
    <>
      <PageHeader
        eyebrow="Professor · Painel"
        title="Minha agenda"
        subtitle={format(new Date(), "EEEE, dd 'de' MMMM", { locale: ptBR })}
      />
      <div className="stack-app">
        <section className="grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat to="/admin/reservas" icon={CalendarCheck} label="Aulas hoje" value={todayBookings.length} hint="Ver agenda" />
          <Stat to="/admin/reservas" icon={CalendarCheck} label="Próximas aulas" value={bookings.length} hint="Ver reservas" />
          <Stat to="/admin/alunos" icon={Users} label="Alunos vinculados" value={studentCount} hint="Ver alunos" />
          <Stat to="/admin/feedbacks" icon={AlertCircle} label="Feedbacks" value={feedbacks} hint="Ver feedbacks" />
        </section>

        <section className="plane">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="type-h3">Próximos horários</h2>
            <Link to="/admin/reservas" className="type-small font-bold hover:underline">Agenda completa</Link>
          </div>
          {bookings.length === 0 ? (
            <p className="py-6 text-center type-small text-muted-foreground">Nenhuma aula agendada.</p>
          ) : (
            <PersonList>
              {bookings.slice(0, 8).map((booking) => (
                <PersonRow
                  key={booking.id}
                  to="/admin/aluno/$id"
                  params={{ id: booking.user_id }}
                  name={names[booking.user_id] ?? "Aluno"}
                  meta={`${format(new Date(`${booking.booking_date}T00:00:00`), "dd/MM")} · ${String(booking.start_hour).padStart(2, "0")}:00 · ${booking.type.replace("_", " ")}`}
                />
              ))}
            </PersonList>
          )}
        </section>
      </div>
    </>
  );
}

function AdminDashboard() {
  const [bookingsMonth, setBookingsMonth] = useState<BookingRow[]>([]);
  const [students, setStudents] = useState(0);
  const [paidOrders, setPaidOrders] = useState<CheckoutOrderRow[]>([]);
  const [pendingOrders, setPendingOrders] = useState<CheckoutOrderRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [birthdays, setBirthdays] = useState<{ id: string; full_name: string | null; birth_date: string | null }[]>([]);
  const [today] = useState(new Date());

  useEffect(() => {
    const load = async () => {
      const from = format(startOfMonth(today), "yyyy-MM-dd");
      const to = format(endOfMonth(today), "yyyy-MM-dd");
      const paidFrom = startOfMonth(today).toISOString();
      const paidUntil = startOfMonth(addMonths(today, 1)).toISOString();
      const nowIso = new Date().toISOString();
      const activePendingFilter = `expires_at.is.null,expires_at.gt.${nowIso}`;

      const [
        { data: bs },
        { count: stCount },
        { data: paid },
        { data: pending },
        { count: activePendingCount },
        { count: needsReview },
        { data: profs },
      ] =
        await Promise.all([
          supabase.from("bookings").select("id, user_id, booking_date, start_hour, type, status, payment_status")
            .gte("booking_date", from).lte("booking_date", to).neq("status", "cancelada"),
          supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "aluno"),
          supabase.from("checkout_orders")
            .select("id, user_id, status, amount_cents, description, created_at, paid_at, expires_at")
            .eq("status", "paid").gte("paid_at", paidFrom).lt("paid_at", paidUntil),
          supabase.from("checkout_orders")
            .select("id, user_id, status, amount_cents, description, created_at, paid_at, expires_at")
            .eq("status", "pending").or(activePendingFilter).order("created_at", { ascending: false }).limit(10),
          supabase.from("checkout_orders")
            .select("id", { count: "exact", head: true }).eq("status", "pending").or(activePendingFilter),
          supabase.from("checkout_orders")
            .select("id", { count: "exact", head: true }).eq("status", "paid_needs_review"),
          supabase.from("profiles").select("id, full_name, birth_date"),
        ]);

      setBookingsMonth(bs ?? []);
      setStudents(stCount ?? 0);
      setPaidOrders((paid ?? []) as CheckoutOrderRow[]);
      setPendingOrders((pending ?? []) as CheckoutOrderRow[]);
      setPendingCount(activePendingCount ?? 0);
      setReviewCount(needsReview ?? 0);

      const md = (d: string | null) => d?.slice(5, 10);
      const now = md(format(today, "yyyy-MM-dd"))!;
      const in15 = md(format(addDays(today, 15), "yyyy-MM-dd"))!;
      setBirthdays(
        (profs ?? [])
          .filter((p: any) => p.birth_date)
          .filter((p: any) => {
            const m = md(p.birth_date)!;
            return now <= in15 ? m >= now && m <= in15 : m >= now || m <= in15;
          })
          .slice(0, 8),
      );
    };

    void load();
    const refreshInterval = window.setInterval(() => void load(), 60_000);
    const channel = supabase
      .channel("admin-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "checkout_orders" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => void load())
      .subscribe();

    return () => {
      window.clearInterval(refreshInterval);
      void supabase.removeChannel(channel);
    };
  }, [today]);

  const pixRevenue = paidOrders.reduce((sum, order) => sum + order.amount_cents, 0);

  return (
    <>
      <PageHeader
        eyebrow="Admin · Painel"
        title="Painel administrativo"
        subtitle={format(today, "MMMM 'de' yyyy", { locale: ptBR })}
      />

      <div className="stack-app">
        <section className="grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-3">
          <Stat to="/admin/reservas" icon={CalendarCheck} label="Reservas no mês" value={bookingsMonth.length} hint="Ver todas" />
          <Stat to="/admin/pagamentos" icon={QrCode} label="Pix recebido no mês" value={brl(pixRevenue)} hint="Ver pagamentos" />
          <Stat to="/admin/pagamentos" icon={CircleCheckBig} label="Pix confirmados no mês" value={paidOrders.length} hint="Ver pagos" />
          <Stat to="/admin/pagamentos" icon={Clock3} label="Aguardando Pix" value={pendingCount} hint="Acompanhar" />
          <Stat to="/admin/alunos" icon={Users} label="Alunos" value={students} hint="Ver lista" />
          <Stat
            to="/admin/pagamentos"
            icon={ShieldAlert}
            label="Revisar pagamentos"
            value={reviewCount}
            accent={reviewCount > 0 ? "bad" : undefined}
            hint="Revisar"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="plane">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="type-h3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-foreground" /> Aguardando Pix
              </h2>
              <Link to="/admin/pagamentos" className="type-small font-bold hover:underline">Ver pagamentos</Link>
            </div>
            {pendingOrders.length === 0 ? (
              <p className="py-6 text-center type-small text-muted-foreground">Nenhum Pix aguardando pagamento.</p>
            ) : (
              <ul className="flex flex-col">
                {pendingOrders.map((order) => (
                  <li
                    key={order.id}
                    className="border-t border-border first:border-t-0 [&:has(a:hover)]:border-transparent [&:has(a:hover)+li]:border-transparent"
                  >
                    <Link
                      to="/admin/pagamentos"
                      className="group -mx-5 flex items-center justify-between px-5 py-3 transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 pr-3">
                        <span className="block truncate type-small font-bold">{order.description}</span>
                        <span className="block type-micro text-muted-foreground">
                          Gerado em {format(new Date(order.created_at), "dd/MM 'às' HH:mm")}
                        </span>
                      </span>
                      <span className="whitespace-nowrap type-small font-bold">
                        {brl(order.amount_cents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="plane">
            <h2 className="type-h3 mb-4 flex items-center gap-2">
              <Cake className="h-4 w-4 text-foreground" /> Aniversariantes (15 dias)
            </h2>
            {birthdays.length === 0 ? (
              <p className="py-4 text-center type-small text-muted-foreground">Ninguém por enquanto.</p>
            ) : (
              <PersonList>
                {birthdays.map((b) => (
                  <PersonRow
                    key={b.id}
                    to="/admin/aluno/$id"
                    params={{ id: b.id }}
                    name={b.full_name ?? "Aluno"}
                    trailing={
                      <span className="type-data text-muted-foreground">
                        {b.birth_date ? format(new Date(b.birth_date + "T00:00:00"), "dd/MM") : "—"}
                      </span>
                    }
                  />
                ))}
              </PersonList>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({
  to, search, icon: Icon, label, value, accent, hint,
}: {
  to: string;
  search?: Record<string, string>;
  icon: any;
  label: string;
  value: any;
  accent?: "good" | "bad";
  hint?: string;
}) {
  const valueColor = accent === "bad" ? "text-destructive" : "text-foreground";
  return (
    <Link
      to={to}
      search={search as any}
      className="group btn-bounce flex h-full flex-col bg-card/30 p-5 transition-colors duration-300 ease-[cubic-bezier(.625,.05,0,1)] hover:bg-card"
    >
      <div className="flex items-center justify-between">
        <span className="type-eyebrow">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <span className={`type-data text-3xl ${valueColor}`}>{value}</span>
        {hint ? (
          <span className="hidden items-center whitespace-nowrap type-micro text-muted-foreground sm:flex">
            {hint}
            <span className="inline-block w-0 overflow-hidden opacity-0 transition-all duration-300 ease-[cubic-bezier(.625,.05,0,1)] group-hover:ml-1 group-hover:w-4 group-hover:opacity-100">
              →
            </span>
          </span>
        ) : null}
      </div>
    </Link>
  );
}
