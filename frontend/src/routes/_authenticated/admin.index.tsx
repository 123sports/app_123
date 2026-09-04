import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarCheck,
  CalendarDays,
  CalendarX2,
  Users,
  AlertCircle,
  Cake,
  QrCode,
  CircleCheckBig,
  Clock3,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { isLocalSupabaseMode, supabase } from "@/integrations/supabase/client";
import { refreshAdminPaymentActivityServer } from "@/lib/payments-admin.functions";
import { addIsoDateDays, venueDateKey, venueMonthUtcRange } from "@/lib/booking-schedule";
import { brl } from "@/lib/money";
import { PageHeader } from "@/components/PageHeader";
import { PersonList, PersonRow } from "@/components/PersonList";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: StaffDashboard,
});

type BookingRow = {
  id: string;
  session_id: string | null;
  user_id: string;
  booking_date: string;
  start_hour: number;
  type: string;
  status: string;
  payment_status: string;
  hold_expires_at: string | null;
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
  metadata: Record<string, any> | null;
};

type ActivityRow = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  created_at: string;
  related_booking_id: string | null;
  related_checkout_order_id: string | null;
};

type ActivityFilter = "all" | "bookings" | "payments" | "cancellations";

const ACTIVITY_KINDS = [
  "booking_new",
  "booking_rescheduled",
  "credit_booking_cancelled",
  "payment_pending",
  "payment_paid",
  "payment_expired",
  "payment_cancelled",
  "payment_failed",
  "payment_refunded",
  "payment_review",
];

const venueLongDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  day: "2-digit",
  month: "long",
});

const venueShortDateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function StaffDashboard() {
  const { staffRole, user } = Route.useRouteContext();
  return staffRole === "admin" ? <AdminDashboard userId={user.id} /> : <ProfessorDashboard />;
}

function ProfessorDashboard() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [feedbacks, setFeedbacks] = useState(0);

  useEffect(() => {
    (async () => {
      const today = venueDateKey();
      const [{ data: rows }, { count }] = await Promise.all([
        supabase
          .from("bookings")
          .select(
            "id, session_id, user_id, booking_date, start_hour, type, status, payment_status, hold_expires_at",
          )
          .gte("booking_date", today)
          .eq("status", "confirmada")
          .eq("payment_status", "pago")
          .order("booking_date")
          .order("start_hour")
          .limit(50),
        (supabase as any).from("professor_feedback").select("id", { count: "exact", head: true }),
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
        setNames(
          Object.fromEntries(
            (profiles ?? []).map((profile: any) => [profile.id, profile.full_name ?? "Aluno"]),
          ),
        );
      }
    })();
  }, []);

  const today = venueDateKey();
  const todayBookings = bookings.filter((booking) => booking.booking_date === today);
  const todayClasses = new Set(todayBookings.map((booking) => booking.session_id ?? booking.id))
    .size;
  const upcomingClasses = new Set(bookings.map((booking) => booking.session_id ?? booking.id)).size;
  const studentCount = new Set(bookings.map((booking) => booking.user_id)).size;

  return (
    <>
      <PageHeader
        eyebrow="Professor · Painel"
        title="Minha agenda"
        subtitle={venueLongDateFormatter.format(new Date())}
      />
      <div className="stack-app">
        <section className="grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            to="/admin/reservas"
            icon={CalendarCheck}
            label="Aulas hoje"
            value={todayClasses}
            hint="Ver agenda"
          />
          <Stat
            to="/admin/reservas"
            icon={CalendarCheck}
            label="Próximas aulas"
            value={upcomingClasses}
            hint="Ver reservas"
          />
          <Stat
            to="/admin/alunos"
            icon={Users}
            label="Alunos vinculados"
            value={studentCount}
            hint="Ver alunos"
          />
          <Stat
            to="/admin/feedbacks"
            icon={AlertCircle}
            label="Feedbacks"
            value={feedbacks}
            hint="Ver feedbacks"
          />
        </section>

        <section className="plane">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="type-h3">Próximos horários</h2>
            <Link to="/admin/reservas" className="type-small font-bold hover:underline">
              Agenda completa
            </Link>
          </div>
          {bookings.length === 0 ? (
            <p className="py-6 text-center type-small text-muted-foreground">
              Nenhuma aula agendada.
            </p>
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

function bookingTypeLabel(type: string) {
  return (
    (
      {
        quadra_livre: "Quadra livre",
        aula_individual: "Aula individual",
        aula_dupla: "Aula em dupla",
        aula_trio: "Aula em trio",
        aula_quarteto: "Aula em quarteto",
        teste: "Aula de teste",
      } as Record<string, string>
    )[type] ?? "Aula"
  );
}

function bookingCapacity(type: string) {
  return ({ aula_dupla: 2, aula_trio: 3, aula_quarteto: 4 } as Record<string, number>)[type] ?? 1;
}

function activityCategory(kind: string): Exclude<ActivityFilter, "all"> {
  if (
    kind === "credit_booking_cancelled" ||
    kind === "payment_expired" ||
    kind === "payment_cancelled" ||
    kind === "payment_refunded"
  ) {
    return "cancellations";
  }
  return kind.startsWith("payment_") ? "payments" : "bookings";
}

function activityPresentation(kind: string) {
  if (kind === "payment_paid") {
    return { icon: CircleCheckBig, color: "bg-primary/10 text-primary" };
  }
  if (kind === "booking_new") {
    return { icon: CalendarCheck, color: "bg-acid text-ink" };
  }
  if (kind === "booking_rescheduled") {
    return { icon: CalendarDays, color: "bg-acid text-ink" };
  }
  if (kind === "payment_pending") {
    return { icon: Clock3, color: "bg-acid text-ink" };
  }
  if (kind === "payment_review") {
    return { icon: ShieldAlert, color: "bg-amber-100 text-amber-800" };
  }
  if (kind === "payment_refunded") {
    return { icon: RotateCcw, color: "bg-destructive/10 text-destructive" };
  }
  return { icon: CalendarX2, color: "bg-destructive/10 text-destructive" };
}

function activityTarget(activity: ActivityRow): "/admin/pagamentos" | "/admin/reservas" {
  return activity.kind.startsWith("payment_") ? "/admin/pagamentos" : "/admin/reservas";
}

function AdminDashboard({ userId }: { userId: string }) {
  const [upcomingBookings, setUpcomingBookings] = useState<BookingRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [paidOrders, setPaidOrders] = useState<CheckoutOrderRow[]>([]);
  const [pendingOrders, setPendingOrders] = useState<CheckoutOrderRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [birthdays, setBirthdays] = useState<
    { id: string; full_name: string | null; birth_date: string | null }[]
  >([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [maintenanceWarning, setMaintenanceWarning] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let latestRequest = 0;

    const load = async () => {
      const requestId = ++latestRequest;

      try {
        const nowMs = Date.now();
        const todayKey = venueDateKey(nowMs);
        const weekEnd = addIsoDateDays(todayKey, 7);
        const { from: paidFrom, until: paidUntil } = venueMonthUtcRange(nowMs);
        const nowIso = new Date(nowMs).toISOString();
        const activePendingFilter = `expires_at.is.null,expires_at.gt.${nowIso}`;

        const results = await Promise.all([
          supabase
            .from("bookings")
            .select(
              "id, session_id, user_id, booking_date, start_hour, type, status, payment_status, hold_expires_at",
            )
            .gte("booking_date", todayKey)
            .lte("booking_date", weekEnd)
            .in("status", ["confirmada", "concluida"])
            .eq("payment_status", "pago")
            .order("booking_date")
            .order("start_hour"),
          supabase
            .from("checkout_orders")
            .select(
              "id, user_id, status, amount_cents, description, created_at, paid_at, expires_at, metadata",
            )
            .eq("status", "paid")
            .gte("paid_at", paidFrom)
            .lt("paid_at", paidUntil),
          supabase
            .from("checkout_orders")
            .select(
              "id, user_id, status, amount_cents, description, created_at, paid_at, expires_at, metadata",
            )
            .eq("status", "pending")
            .or(activePendingFilter)
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("checkout_orders")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending")
            .or(activePendingFilter),
          supabase
            .from("checkout_orders")
            .select("id", { count: "exact", head: true })
            .eq("status", "paid_needs_review"),
          supabase.from("profiles").select("id, full_name, birth_date"),
          supabase
            .from("notifications")
            .select(
              "id, title, body, kind, created_at, related_booking_id, related_checkout_order_id",
            )
            .eq("user_id", userId)
            .in("kind", ACTIVITY_KINDS)
            .order("created_at", { ascending: false })
            .limit(30),
        ]);

        if (!active || requestId !== latestRequest) return;

        const queryError = results.find((result) => result.error)?.error;
        if (queryError) throw queryError;

        const [
          bookingsResult,
          paidResult,
          pendingResult,
          pendingCountResult,
          reviewResult,
          profilesResult,
          activityResult,
        ] = results;
        const profiles = profilesResult.data ?? [];

        setUpcomingBookings((bookingsResult.data ?? []) as BookingRow[]);
        setPaidOrders((paidResult.data ?? []) as CheckoutOrderRow[]);
        setPendingOrders((pendingResult.data ?? []) as CheckoutOrderRow[]);
        setPendingCount(pendingCountResult.count ?? 0);
        setReviewCount(reviewResult.count ?? 0);
        setActivities((activityResult.data ?? []) as ActivityRow[]);
        setNames(
          Object.fromEntries(
            profiles.map((profile: any) => [profile.id, profile.full_name ?? "Aluno"]),
          ),
        );

        const md = (date: string | null) => date?.slice(5, 10);
        const now = md(todayKey)!;
        const in15 = md(addIsoDateDays(todayKey, 15))!;
        setBirthdays(
          profiles
            .filter((profile: any) => profile.birth_date)
            .filter((profile: any) => {
              const birthday = md(profile.birth_date)!;
              return now <= in15
                ? birthday >= now && birthday <= in15
                : birthday >= now || birthday <= in15;
            })
            .slice(0, 8),
        );
        setLoadError(null);
      } catch (error) {
        if (!active || requestId !== latestRequest) return;
        console.error("[Dashboard] Could not load administrator data", error);
        setLoadError(
          "Não foi possível atualizar o painel agora. Os dados exibidos podem estar desatualizados.",
        );
      }
    };

    const refresh = async () => {
      if (!isLocalSupabaseMode()) {
        try {
          await refreshAdminPaymentActivityServer();
          if (active) setMaintenanceWarning(null);
        } catch (error) {
          console.warn("[Dashboard] Could not refresh expired Pix activity", error);
          if (active) {
            setMaintenanceWarning(
              "A atualização dos Pix vencidos não foi concluída. As demais informações continuam disponíveis.",
            );
          }
        }
      }
      await load();
    };
    const handleLocalChange = () => void load();
    void refresh();
    const refreshInterval = window.setInterval(() => void refresh(), 60_000);
    const channel = supabase
      .channel(`admin-dashboard:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "checkout_orders" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => void load(),
      )
      .subscribe();
    window.addEventListener("on-tennis-local-data-change", handleLocalChange);

    return () => {
      active = false;
      latestRequest += 1;
      window.clearInterval(refreshInterval);
      window.removeEventListener("on-tennis-local-data-change", handleLocalChange);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const today = new Date();
  const todayKey = venueDateKey(today.getTime());
  const pixRevenue = paidOrders.reduce((sum, order) => sum + order.amount_cents, 0);
  const todayBookings = useMemo(
    () => upcomingBookings.filter((booking) => booking.booking_date === todayKey),
    [todayKey, upcomingBookings],
  );
  const nextSevenDaysBookings = useMemo(
    () => upcomingBookings.filter((booking) => booking.booking_date > todayKey),
    [todayKey, upcomingBookings],
  );
  const classesToday = new Set(todayBookings.map((booking) => booking.session_id ?? booking.id))
    .size;
  const classesNextSevenDays = new Set(
    nextSevenDaysBookings.map((booking) => booking.session_id ?? booking.id),
  ).size;
  const attentionCount = pendingCount + reviewCount;
  const todayAgenda = useMemo(() => {
    const grouped = new Map<
      string,
      {
        id: string;
        hour: number;
        type: string;
        capacity: number;
        students: string[];
      }
    >();

    for (const booking of todayBookings) {
      const key = booking.session_id ?? booking.id;
      const current = grouped.get(key) ?? {
        id: key,
        hour: booking.start_hour,
        type: booking.type,
        capacity: bookingCapacity(booking.type),
        students: [],
      };
      current.students.push(names[booking.user_id] ?? "Aluno");
      grouped.set(key, current);
    }

    return [...grouped.values()].sort((a, b) => a.hour - b.hour);
  }, [names, todayBookings]);
  const visibleActivities = useMemo(
    () =>
      activities
        .filter(
          (activity) =>
            activityFilter === "all" || activityCategory(activity.kind) === activityFilter,
        )
        .slice(0, 12),
    [activities, activityFilter],
  );

  return (
    <>
      <PageHeader
        eyebrow="Admin · Painel"
        title="Painel administrativo"
        subtitle={venueLongDateFormatter.format(today)}
      />

      <div className="stack-app">
        {loadError ? (
          <div
            role="alert"
            className="flex items-start gap-3 border border-destructive/30 bg-destructive/5 p-4 text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="type-small font-semibold">{loadError}</p>
          </div>
        ) : maintenanceWarning ? (
          <div
            role="status"
            className="flex items-start gap-3 border border-amber-300 bg-amber-50 p-4 text-amber-900"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="type-small font-semibold">{maintenanceWarning}</p>
          </div>
        ) : null}

        <section className="grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            to="/admin/reservas"
            icon={CalendarCheck}
            label="Aulas hoje"
            value={classesToday}
            hint={`${todayBookings.length} ${todayBookings.length === 1 ? "aluno" : "alunos"}`}
          />
          <Stat
            to="/admin/reservas"
            icon={CalendarDays}
            label="Próximos 7 dias"
            value={classesNextSevenDays}
            hint={`${nextSevenDaysBookings.length} vagas ocupadas`}
          />
          <Stat
            to="/admin/pagamentos"
            icon={QrCode}
            label="Pix recebido no mês"
            value={brl(pixRevenue)}
            hint={`${paidOrders.length} ${paidOrders.length === 1 ? "pagamento" : "pagamentos"}`}
          />
          <Stat
            to="/admin/pagamentos"
            icon={ShieldAlert}
            label="Precisa de atenção"
            value={attentionCount}
            accent={reviewCount > 0 ? "bad" : undefined}
            hint={
              reviewCount > 0 ? `${reviewCount} para revisar` : `${pendingCount} Pix em andamento`
            }
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
          <div className="plane min-w-0">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="type-h3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-foreground" /> Movimentações recentes
              </h2>
              <div>
                <div className="grid grid-cols-2 rounded-md border border-border bg-background p-0.5 sm:flex">
                  {(
                    [
                      ["all", "Tudo"],
                      ["bookings", "Reservas"],
                      ["payments", "Pagamentos"],
                      ["cancellations", "Cancelamentos"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={activityFilter === value}
                      className={`h-8 px-3 type-micro font-bold transition-colors ${
                        activityFilter === value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setActivityFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {visibleActivities.length === 0 ? (
              <p className="py-8 text-center type-small text-muted-foreground">
                Nenhuma movimentação neste filtro.
              </p>
            ) : (
              <ul>
                {visibleActivities.map((activity) => {
                  const presentation = activityPresentation(activity.kind);
                  const Icon = presentation.icon;
                  return (
                    <li
                      key={activity.id}
                      className="border-t border-border first:border-t-0 [&:has(a:hover)]:border-transparent [&:has(a:hover)+li]:border-transparent"
                    >
                      <Link
                        to={activityTarget(activity)}
                        className="group -mx-5 grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 px-5 py-3 transition-colors hover:bg-accent sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-center"
                      >
                        <span
                          className={`flex h-9 w-9 items-center justify-center rounded-full ${presentation.color}`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block type-small font-bold">{activity.title}</span>
                          {activity.body ? (
                            <span className="mt-0.5 block type-micro text-muted-foreground">
                              {activity.body}
                            </span>
                          ) : null}
                        </span>
                        <span className="col-start-2 type-micro text-muted-foreground sm:col-start-3 sm:row-start-1">
                          {formatDistanceToNow(new Date(activity.created_at), {
                            addSuffix: true,
                            locale: ptBR,
                          })}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="plane min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="type-h3 flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-foreground" /> Agenda de hoje
              </h2>
              <Link to="/admin/reservas" className="type-small font-bold hover:underline">
                Ver agenda
              </Link>
            </div>
            {todayAgenda.length === 0 ? (
              <p className="py-8 text-center type-small text-muted-foreground">
                Nenhuma aula confirmada para hoje.
              </p>
            ) : (
              <ul>
                {todayAgenda.map((session) => (
                  <li
                    key={session.id}
                    className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 border-t border-border py-3 first:border-t-0"
                  >
                    <span className="type-data text-lg">
                      {String(session.hour).padStart(2, "0")}:00
                    </span>
                    <span className="min-w-0">
                      <span className="block type-small font-bold">
                        {session.students.join(", ")}
                      </span>
                      <span className="mt-0.5 block type-micro text-muted-foreground">
                        {bookingTypeLabel(session.type)} · {session.students.length} de{" "}
                        {session.capacity} {session.capacity === 1 ? "vaga" : "vagas"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="plane">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="type-h3 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-foreground" /> Pix em andamento
              </h2>
              <Link to="/admin/pagamentos" className="type-small font-bold hover:underline">
                Ver pagamentos
              </Link>
            </div>
            {pendingOrders.length === 0 ? (
              <p className="py-6 text-center type-small text-muted-foreground">
                Nenhum Pix aguardando pagamento.
              </p>
            ) : (
              <ul className="flex flex-col">
                {pendingOrders.map((order) => {
                  const initialBooking = order.metadata?.initial_booking;
                  const bookingDate =
                    typeof initialBooking?.booking_date === "string"
                      ? initialBooking.booking_date
                      : null;
                  const startHour =
                    typeof initialBooking?.start_hour === "number"
                      ? initialBooking.start_hour
                      : null;
                  return (
                    <li
                      key={order.id}
                      className="border-t border-border first:border-t-0 [&:has(a:hover)]:border-transparent [&:has(a:hover)+li]:border-transparent"
                    >
                      <Link
                        to="/admin/pagamentos"
                        className="group -mx-5 flex items-start justify-between gap-4 px-5 py-3 transition-colors hover:bg-accent"
                      >
                        <span className="min-w-0">
                          <span className="block truncate type-small font-bold">
                            {names[order.user_id] ?? "Aluno"}
                          </span>
                          <span className="mt-0.5 block type-micro text-muted-foreground">
                            {order.description}
                          </span>
                          <span className="mt-1 block type-micro text-muted-foreground">
                            {bookingDate && startHour !== null
                              ? `Reserva provisória em ${bookingDate
                                  .split("-")
                                  .reverse()
                                  .slice(0, 2)
                                  .join("/")} às ${String(startHour).padStart(2, "0")}:00`
                              : `Pix gerado em ${venueShortDateTimeFormatter.format(
                                  new Date(order.created_at),
                                )}`}
                            {order.expires_at
                              ? ` · expira ${formatDistanceToNow(new Date(order.expires_at), {
                                  addSuffix: true,
                                  locale: ptBR,
                                })}`
                              : ""}
                          </span>
                        </span>
                        <span className="whitespace-nowrap type-small font-bold">
                          {brl(order.amount_cents)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="plane">
            <h2 className="type-h3 mb-4 flex items-center gap-2">
              <Cake className="h-4 w-4 text-foreground" /> Aniversariantes (15 dias)
            </h2>
            {birthdays.length === 0 ? (
              <p className="py-4 text-center type-small text-muted-foreground">
                Ninguém por enquanto.
              </p>
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
  to,
  search,
  icon: Icon,
  label,
  value,
  accent,
  hint,
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
