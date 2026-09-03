import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";
import { PixCheckoutDialog } from "@/components/PixCheckoutDialog";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { hasBookingMinimumNotice, isBookingScheduleAllowed } from "@/lib/booking-schedule";
import { reschedulePaidBooking } from "@/lib/bookings";
import {
  cancelCreditBooking,
  createCreditBooking,
  creditModalityForBookingType,
  type CreditModality,
} from "@/lib/credits";
import { brl } from "@/lib/money";
import {
  cancelLocalPixCheckout,
  createBookingPixCheckout,
  getPixCheckout,
  type PixCheckout,
} from "@/lib/payments";
import { playPop } from "@/lib/sfx";

export const Route = createFileRoute("/_authenticated/app/agenda")({ component: Agenda });

const HOURS = Array.from({ length: 17 }, (_, index) => index + 6);
type BookingType = Database["public"]["Enums"]["booking_type"];

type Product = {
  booking_type: BookingType;
  display_name: string;
  price_cents: number;
  student_capacity: number;
  requires_professor: boolean;
  sort_order: number;
};

type SessionAvailability = {
  session_id: string;
  booking_date: string;
  start_hour: number;
  professor_id: string | null;
  product_type: BookingType;
  display_name: string;
  capacity: number;
  unit_price_cents: number;
  occupied_seats: number;
  available_seats: number;
  is_full: boolean;
  my_booking_id: string | null;
  my_booking_status: string | null;
  my_payment_status: string | null;
  my_payment_method: string | null;
  my_checkout_order_id: string | null;
  my_credit_grant_id: string | null;
  my_hold_expires_at: string | null;
};

type BlockedSlot = {
  id: string;
  block_date: string;
  start_hour: number;
  professor_id: string | null;
  reason: string | null;
};

type ReschedulingBooking = {
  id: string;
  professor_id: string | null;
  booking_date: string;
  start_hour: number;
  type: BookingType;
};

function Agenda() {
  const [selected, setSelected] = useState(() => addDays(new Date(), 1));
  const [cursor, setCursor] = useState(() => selected);
  const [sessions, setSessions] = useState<SessionAvailability[]>([]);
  const [blocks, setBlocks] = useState<BlockedSlot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [professors, setProfessors] = useState<{ id: string; full_name: string | null }[]>([]);
  const [type, setType] = useState<BookingType>("quadra_livre");
  const [professorId, setProfessorId] = useState("");
  const [pendingHours, setPendingHours] = useState<Set<number>>(new Set());
  const [checkout, setCheckout] = useState<PixCheckout | null>(null);
  const [rescheduling, setRescheduling] = useState<ReschedulingBooking | null>(null);
  const [loading, setLoading] = useState(false);
  const [creditBalances, setCreditBalances] = useState<Record<CreditModality, number>>({
    individual: 0,
    dupla: 0,
    grupo: 0,
  });
  const [cancellationNoticeHours, setCancellationNoticeHours] = useState(24);

  const minDate = startOfDay(new Date());
  const maxDate = addDays(minDate, 31);
  const selectedDate = format(selected, "yyyy-MM-dd");
  const productByType = useMemo(
    () => new Map(products.map((product) => [product.booking_type, product])),
    [products],
  );
  const activeProduct = productByType.get(type) ?? null;
  const activeCreditModality = creditModalityForBookingType(type);
  const availableCredits = activeCreditModality ? creditBalances[activeCreditModality] : 0;

  const monthDays = useMemo(() => {
    const start = startOfMonth(cursor);
    return {
      pad: getDay(start),
      days: eachDayOfInterval({ start, end: endOfMonth(cursor) }),
    };
  }, [cursor]);

  const loadCatalog = useCallback(async () => {
    const [{ data: productRows, error: productError }, { data: professorRows }] = await Promise.all(
      [
        supabase
          .from("pricing")
          .select(
            "booking_type, display_name, price_cents, student_capacity, requires_professor, sort_order",
          )
          .eq("active", true)
          .order("sort_order"),
        (supabase as any).rpc("list_active_professors"),
      ],
    );
    if (productError) {
      toast.error("Não foi possível carregar os tipos de aula.");
      return;
    }
    const visibleProducts = ((productRows ?? []) as Product[]).filter(
      (product) =>
        product.booking_type !== "teste" ||
        import.meta.env.VITE_ENABLE_TEST_BOOKING_TYPE === "true",
    );
    setProducts(visibleProducts);
    setProfessors(professorRows ?? []);
    setType((current) =>
      visibleProducts.some((product) => product.booking_type === current)
        ? current
        : (visibleProducts[0]?.booking_type ?? current),
    );
  }, []);

  useEffect(() => {
    void loadCatalog();
    const refresh = () => void loadCatalog();
    const channel = supabase
      .channel("student-booking-catalog")
      .on("postgres_changes", { event: "*", schema: "public", table: "pricing" }, refresh)
      .subscribe();
    window.addEventListener("on-tennis-local-data-change", refresh);
    return () => {
      window.removeEventListener("on-tennis-local-data-change", refresh);
      void supabase.removeChannel(channel);
    };
  }, [loadCatalog]);

  const loadCredits = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const [{ data: summaryRows }, { data: policy }] = await Promise.all([
      (supabase as any)
        .from("student_credit_summary")
        .select("modality, available_credits")
        .eq("user_id", auth.user.id),
      (supabase as any)
        .from("site_settings")
        .select("value")
        .eq("key", "cancellation_notice_hours")
        .maybeSingle(),
    ]);
    const balances: Record<CreditModality, number> = { individual: 0, dupla: 0, grupo: 0 };
    for (const row of summaryRows ?? []) {
      if (row.modality in balances) {
        balances[row.modality as CreditModality] = Math.max(0, Number(row.available_credits) || 0);
      }
    }
    setCreditBalances(balances);
    const hours = Number(policy?.value ?? 24);
    setCancellationNoticeHours(Number.isInteger(hours) && hours >= 0 && hours <= 720 ? hours : 24);
  }, []);

  useEffect(() => {
    void loadCredits();
    const refresh = () => void loadCredits();
    const channel = supabase
      .channel("student-credit-balance-agenda")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "student_credit_ledger" },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "site_settings" }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadCredits]);

  useEffect(() => {
    if (activeProduct?.requires_professor && !professorId && professors[0]) {
      setProfessorId(professors[0].id);
    }
    if (activeProduct && !activeProduct.requires_professor && professorId) {
      setProfessorId("");
    }
  }, [activeProduct, professorId, professors]);

  const loadMonth = useCallback(async () => {
    const from = format(startOfMonth(cursor), "yyyy-MM-dd");
    const to = format(endOfMonth(cursor), "yyyy-MM-dd");
    const [{ data: sessionRows, error: sessionError }, { data: blockRows, error: blockError }] =
      await Promise.all([
        supabase
          .from("reservation_session_availability")
          .select("*")
          .gte("booking_date", from)
          .lte("booking_date", to),
        supabase
          .from("blocked_slots")
          .select("id, block_date, start_hour, professor_id, reason")
          .gte("block_date", from)
          .lte("block_date", to),
      ]);
    if (sessionError || blockError) {
      toast.error("Não foi possível atualizar a agenda.");
      return;
    }
    setSessions((sessionRows ?? []) as SessionAvailability[]);
    setBlocks((blockRows ?? []) as BlockedSlot[]);
  }, [cursor]);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  useEffect(() => {
    const refresh = () => void loadMonth();
    const channel = supabase
      .channel(`student-agenda-${format(cursor, "yyyy-MM")}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservation_sessions" },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "blocked_slots" }, refresh)
      .subscribe();
    const refreshInterval = window.setInterval(refresh, 30_000);
    window.addEventListener("on-tennis-local-data-change", refresh);
    return () => {
      window.removeEventListener("on-tennis-local-data-change", refresh);
      window.clearInterval(refreshInterval);
      void supabase.removeChannel(channel);
    };
  }, [cursor, loadMonth]);

  useEffect(() => {
    setPendingHours(new Set());
  }, [selectedDate, type]);

  const daySessions = sessions.filter((session) => session.booking_date === selectedDate);
  const sessionsByHour = new Map(daySessions.map((session) => [session.start_hour, session]));
  const effectiveProfessorId = rescheduling?.professor_id ?? (professorId || null);
  const blockedByHour = new Map(
    blocks
      .filter(
        (block) =>
          block.block_date === selectedDate &&
          (block.professor_id === null || block.professor_id === effectiveProfessorId),
      )
      .map((block) => [block.start_hour, block.reason] as const),
  );

  const isPickable = (date: Date) =>
    !isBefore(date, minDate) && !isAfter(date, maxDate) && isSameMonth(date, cursor);

  const changeMonth = (offset: number) => {
    const nextCursor = addMonths(cursor, offset);
    const nextStart = startOfMonth(nextCursor);
    const nextEnd = endOfMonth(nextCursor);
    if (isBefore(nextEnd, minDate) || isAfter(nextStart, maxDate)) return;

    setCursor(nextCursor);
    if (!isSameMonth(selected, nextCursor)) {
      setSelected(isBefore(nextStart, minDate) ? minDate : nextStart);
    }
  };

  const previousMonthDisabled = isBefore(endOfMonth(addMonths(cursor, -1)), minDate);
  const nextMonthDisabled = isAfter(startOfMonth(addMonths(cursor, 1)), maxDate);

  const canUseSession = (session: SessionAvailability) => {
    if (session.product_type !== type || session.is_full || session.my_booking_id) return false;
    return !rescheduling || session.professor_id === rescheduling.professor_id;
  };

  const canCreateSessionAt = (hour: number) => {
    if (!activeProduct || blockedByHour.has(hour) || sessionsByHour.has(hour)) return false;
    if (activeProduct.requires_professor && !effectiveProfessorId) return false;
    return isBookingScheduleAllowed(selectedDate, hour);
  };

  const beginReschedule = (session: SessionAvailability) => {
    if (!session.my_booking_id) return;
    if (!hasBookingMinimumNotice(session.booking_date, session.start_hour)) {
      toast.error("A troca exige no mínimo 2 horas de antecedência.");
      return;
    }
    playPop();
    setRescheduling({
      id: session.my_booking_id,
      booking_date: session.booking_date,
      start_hour: session.start_hour,
      professor_id: session.professor_id,
      type: session.product_type,
    });
    setType(session.product_type);
    setProfessorId(session.professor_id ?? "");
    setPendingHours(new Set());
  };

  const cancelPendingCheckout = async (orderId: string) => {
    playPop();
    setLoading(true);
    try {
      await cancelLocalPixCheckout(orderId);
      toast.success("Cobrança cancelada. A vaga foi liberada.");
      await loadMonth();
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível cancelar esta cobrança.");
    } finally {
      setLoading(false);
    }
  };

  const openPendingCheckout = async (orderId: string) => {
    playPop();
    setLoading(true);
    try {
      setCheckout(await getPixCheckout(orderId));
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível abrir esta cobrança.");
      await loadMonth();
    } finally {
      setLoading(false);
    }
  };

  const chooseHour = (hour: number, session?: SessionAvailability) => {
    if (session?.my_booking_id) {
      if (session.my_payment_method === "credito_plano") return;
      if (session.my_payment_status === "pago") beginReschedule(session);
      else if (session.my_payment_status === "pendente" && session.my_checkout_order_id) {
        void openPendingCheckout(session.my_checkout_order_id);
      }
      return;
    }
    if (session && !canUseSession(session)) return;
    if (!session && !canCreateSessionAt(hour)) return;
    playPop();
    if (session?.professor_id) setProfessorId(session.professor_id);
    const singleSelection = Boolean(rescheduling || activeProduct?.requires_professor || session);
    setPendingHours((current) => {
      if (current.has(hour)) return new Set();
      if (singleSelection) return new Set([hour]);
      const next = new Set(current);
      next.add(hour);
      return next;
    });
  };

  const confirmReschedule = async () => {
    const newStartHour = [...pendingHours][0];
    if (!rescheduling || newStartHour == null) return;
    playPop();
    setLoading(true);
    try {
      await reschedulePaidBooking({
        bookingId: rescheduling.id,
        newBookingDate: selectedDate,
        newStartHour,
      });
      toast.success("Horário alterado com sucesso", {
        description: `Seu pagamento foi mantido para ${format(selected, "dd/MM")} às ${String(newStartHour).padStart(2, "0")}:00.`,
      });
      setRescheduling(null);
      setPendingHours(new Set());
      await loadMonth();
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível trocar o horário.");
      await loadMonth();
    } finally {
      setLoading(false);
    }
  };

  const confirmBooking = async () => {
    if (!activeProduct || pendingHours.size === 0) return;
    const selectedSession = sessionsByHour.get([...pendingHours][0]);
    const checkoutProfessor = selectedSession?.professor_id ?? effectiveProfessorId;
    if (activeProduct.requires_professor && !checkoutProfessor) {
      toast.error("Selecione o professor antes de continuar.");
      return;
    }
    playPop();
    setLoading(true);
    try {
      const created = await createBookingPixCheckout({
        bookingDate: selectedDate,
        hours: [...pendingHours],
        bookingType: type,
        professorId: checkoutProfessor,
      });
      setPendingHours(new Set());
      await loadMonth();
      setCheckout(created);
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível gerar o pagamento.");
      await loadMonth();
    } finally {
      setLoading(false);
    }
  };

  const confirmCreditBooking = async () => {
    const startHour = [...pendingHours][0];
    if (!activeProduct || startHour == null || !activeCreditModality || availableCredits < 1)
      return;
    const selectedSession = sessionsByHour.get(startHour);
    const creditProfessor = selectedSession?.professor_id ?? effectiveProfessorId;
    if (!creditProfessor) {
      toast.error("Selecione o professor antes de continuar.");
      return;
    }
    playPop();
    setLoading(true);
    try {
      const result = await createCreditBooking({
        bookingDate: selectedDate,
        startHour,
        bookingType: type as "aula_individual" | "aula_dupla" | "aula_trio" | "aula_quarteto",
        professorId: creditProfessor,
      });
      toast.success("Aula confirmada com crédito", {
        description: `Você ainda possui ${result.available_credits} ${result.available_credits === 1 ? "crédito" : "créditos"} nesta modalidade.`,
      });
      setPendingHours(new Set());
      await Promise.all([loadMonth(), loadCredits()]);
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível usar seu crédito nesta aula.");
      await Promise.all([loadMonth(), loadCredits()]);
    } finally {
      setLoading(false);
    }
  };

  const cancelOwnedCreditBooking = async (session: SessionAvailability) => {
    if (!session.my_booking_id) return;
    const policy =
      cancellationNoticeHours === 0
        ? "O crédito retorna se a aula ainda não tiver começado."
        : `O crédito retorna quando o cancelamento é feito com pelo menos ${cancellationNoticeHours} horas de antecedência.`;
    if (!window.confirm(`Cancelar esta aula?\n\n${policy}`)) return;
    playPop();
    setLoading(true);
    try {
      const result = await cancelCreditBooking(session.my_booking_id);
      toast.success(
        result.credit_returned ? "Aula cancelada e crédito devolvido" : "Aula cancelada",
        {
          description: result.credit_returned
            ? "O crédito já está disponível para uma nova reserva."
            : `A vaga foi liberada, mas o crédito não retornou porque faltavam menos de ${result.notice_hours} horas.`,
        },
      );
      await Promise.all([loadMonth(), loadCredits()]);
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível cancelar esta aula.");
      await loadMonth();
    } finally {
      setLoading(false);
    }
  };

  const selectedTotal = [...pendingHours].reduce((total, hour) => {
    const session = sessionsByHour.get(hour);
    return total + (session?.unit_price_cents ?? activeProduct?.price_cents ?? 0);
  }, 0);

  return (
    <div className="stack-app animate-float-in">
      <PageHeader
        eyebrow="Agenda"
        title="Agenda da quadra"
        subtitle="Escolha uma aula e reserve com crédito ou Pix"
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="plane">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              disabled={previousMonthDisabled}
              className="btn-bounce rounded-full p-2 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="type-h3 capitalize">{format(cursor, "MMMM yyyy", { locale: ptBR })}</h2>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              disabled={nextMonthDisabled}
              className="btn-bounce rounded-full p-2 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-2 grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((day, index) => (
              <div key={index}>{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: monthDays.pad }).map((_, index) => (
              <div key={`pad-${index}`} />
            ))}
            {monthDays.days.map((date) => {
              const selectedDay = isSameDay(date, selected);
              const available = isPickable(date);
              const count = sessions.filter(
                (session) => session.booking_date === format(date, "yyyy-MM-dd"),
              ).length;
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  aria-label={format(date, "dd/MM/yyyy")}
                  disabled={!available}
                  onClick={() => setSelected(date)}
                  className={`relative flex aspect-square flex-col items-center justify-start gap-0.5 rounded-xl p-1 text-sm font-medium transition ${selectedDay ? "bg-primary text-primary-foreground" : available ? "bg-secondary hover:bg-muted" : "bg-muted/40 text-muted-foreground/40"}`}
                >
                  <span className="type-data leading-none">{date.getDate()}</span>
                  {count > 0 && (
                    <span className="mt-auto rounded-full bg-primary/80 px-1.5 py-px type-micro font-bold text-primary-foreground">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            O número no calendário indica quantos horários já têm atividade no dia.
          </p>
        </div>

        <div className="space-y-4 plane">
          <div>
            <div className="type-eyebrow text-muted-foreground">Selecionado</div>
            <div className="type-h3 capitalize">
              {format(selected, "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </div>
          </div>

          {rescheduling && (
            <div className="border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-start gap-3">
                <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">Trocar horário</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Escolha uma vaga do mesmo tipo e professor. Seu pagamento será mantido.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRescheduling(null);
                    setPendingHours(new Set());
                  }}
                  disabled={loading}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Sair
                </button>
              </div>
            </div>
          )}

          <div>
            <label
              className="mb-1 block text-xs font-medium text-muted-foreground"
              htmlFor="booking-product"
            >
              Tipo de aula
            </label>
            <select
              id="booking-product"
              value={type}
              onChange={(event) => setType(event.target.value as BookingType)}
              disabled={Boolean(rescheduling)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            >
              {products.map((product) => (
                <option key={product.booking_type} value={product.booking_type}>
                  {product.display_name} · {brl(product.price_cents)}
                </option>
              ))}
            </select>
            {activeProduct && (
              <p className="mt-1 text-xs text-muted-foreground">
                {brl(activeProduct.price_cents)} por aluno · até {activeProduct.student_capacity}{" "}
                {activeProduct.student_capacity === 1 ? "aluno" : "alunos"} no horário.
              </p>
            )}
          </div>

          {activeProduct?.requires_professor && (
            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted-foreground"
                htmlFor="booking-professor"
              >
                Professor
              </label>
              <select
                id="booking-professor"
                value={professorId}
                onChange={(event) => {
                  setProfessorId(event.target.value);
                  setPendingHours(new Set());
                }}
                disabled={Boolean(rescheduling)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              >
                {professors.length === 0 && <option value="">Nenhum professor disponível</option>}
                {professors.map((professor) => (
                  <option key={professor.id} value={professor.id}>
                    {professor.full_name ?? "Professor"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-between border border-input bg-background px-3 py-2 text-sm">
            <span className="font-medium">
              {availableCredits > 0
                ? `${availableCredits} créditos disponíveis`
                : "Pagamento por Pix"}
            </span>
            <span className="text-xs text-muted-foreground">
              {rescheduling
                ? "já confirmado"
                : availableCredits > 0
                  ? "use 1 por aula"
                  : "confirmação automática"}
            </span>
          </div>

          <div>
            <div className="mb-2 type-eyebrow">
              {rescheduling ? "Escolha o novo horário" : "Horários"}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {HOURS.map((hour) => (
                <SlotButton
                  key={hour}
                  hour={hour}
                  session={sessionsByHour.get(hour)}
                  blockedReason={blockedByHour.get(hour)}
                  selected={pendingHours.has(hour)}
                  disabled={loading}
                  canJoin={Boolean(
                    sessionsByHour.get(hour) && canUseSession(sessionsByHour.get(hour)!),
                  )}
                  canCreate={canCreateSessionAt(hour)}
                  onClick={() => chooseHour(hour, sessionsByHour.get(hour))}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-4 w-4" />
              Aulas em grupo mostram apenas a quantidade de vagas, sem dados de outros alunos.
            </div>
          </div>

          {pendingHours.size > 0 && (
            <div className="space-y-3 border border-primary/30 bg-primary/5 p-3">
              <div className="text-xs text-muted-foreground">
                {pendingHours.size}{" "}
                {pendingHours.size === 1 ? "horário selecionado" : "horários selecionados"} ·{" "}
                {[...pendingHours]
                  .sort((a, b) => a - b)
                  .map((hour) => `${String(hour).padStart(2, "0")}h`)
                  .join(", ")}
              </div>
              <div className="flex items-center justify-between border-y border-primary/20 py-2">
                <span className="text-sm text-muted-foreground">
                  {rescheduling
                    ? "Novo pagamento"
                    : availableCredits > 0
                      ? "Reserva avulsa por Pix"
                      : "Total"}
                </span>
                <strong className="type-data text-lg">
                  {rescheduling ? "R$ 0,00" : brl(selectedTotal)}
                </strong>
              </div>
              {rescheduling ? (
                <button
                  type="button"
                  onClick={confirmReschedule}
                  disabled={loading}
                  className="btn-bounce inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirmar troca
                </button>
              ) : (
                <div className="grid gap-2">
                  {activeCreditModality && availableCredits > 0 && (
                    <button
                      type="button"
                      onClick={() => void confirmCreditBooking()}
                      disabled={loading}
                      className="btn-bounce inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <WalletCards className="h-4 w-4" />
                      )}
                      Reservar com 1 crédito
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void confirmBooking()}
                    disabled={loading || selectedTotal <= 0}
                    className={`btn-bounce inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60 ${availableCredits > 0 ? "border border-input bg-background text-foreground" : "bg-primary text-primary-foreground"}`}
                  >
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Pagar reserva avulsa com Pix
                  </button>
                </div>
              )}
            </div>
          )}

          {daySessions.some((session) => session.my_booking_id) && (
            <div className="border-t border-border pt-4">
              <div className="mb-2 type-eyebrow">Minhas vagas neste dia</div>
              <ul className="space-y-2 text-sm">
                {daySessions
                  .filter((session) => session.my_booking_id)
                  .map((session) => (
                    <li
                      key={session.session_id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span>
                        <strong className="type-data">
                          {String(session.start_hour).padStart(2, "0")}:00
                        </strong>
                        <span className="block text-xs text-muted-foreground">
                          {session.display_name}
                        </span>
                      </span>
                      {session.my_payment_status === "pendente" && session.my_checkout_order_id ? (
                        <span className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => void openPendingCheckout(session.my_checkout_order_id!)}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Abrir Pix
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void cancelPendingCheckout(session.my_checkout_order_id!)
                            }
                            className="text-xs font-medium text-muted-foreground hover:text-destructive"
                          >
                            Cancelar
                          </button>
                        </span>
                      ) : session.my_payment_method === "credito_plano" ? (
                        <button
                          type="button"
                          onClick={() => void cancelOwnedCreditBooking(session)}
                          disabled={loading}
                          className="text-xs font-medium text-destructive hover:underline"
                        >
                          Cancelar aula
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => chooseHour(session.start_hour, session)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          trocar horário
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {checkout && (
        <PixCheckoutDialog
          checkout={checkout}
          onClose={() => setCheckout(null)}
          onPaid={() => void loadMonth()}
        />
      )}
    </div>
  );
}

function SlotButton({
  hour,
  session,
  blockedReason,
  selected,
  disabled,
  canJoin,
  canCreate,
  onClick,
}: {
  hour: number;
  session?: SessionAvailability;
  blockedReason?: string | null;
  selected: boolean;
  disabled: boolean;
  canJoin: boolean;
  canCreate: boolean;
  onClick: () => void;
}) {
  const mine = Boolean(session?.my_booking_id);
  const actionable = mine || canJoin || canCreate;
  let detail = "Livre";
  if (blockedReason !== undefined && !session) detail = "Bloqueado";
  if (session?.is_full && !mine) detail = "Lotado";
  if (session && canJoin)
    detail = `${session.available_seats} ${session.available_seats === 1 ? "vaga" : "vagas"}`;
  if (mine) {
    detail =
      session?.my_payment_status === "pendente"
        ? "Aguardando Pix"
        : session?.my_payment_method === "credito_plano"
          ? "Usou crédito"
          : "Sua vaga";
  }
  if (session && !mine && !canJoin && !session.is_full) detail = "Outra aula";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !actionable}
      title={blockedReason ? `Bloqueado: ${blockedReason}` : session?.display_name}
      className={`flex min-h-14 flex-col items-center justify-center border px-1.5 py-2 text-xs font-semibold transition ${
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : mine
            ? "border-primary bg-primary/15 text-primary"
            : canJoin
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800"
              : canCreate
                ? "border-border bg-secondary hover:border-primary"
                : "cursor-not-allowed border-border bg-muted/50 text-muted-foreground"
      }`}
    >
      <span className="type-data">{String(hour).padStart(2, "0")}:00</span>
      <span className="mt-0.5 type-micro font-medium">{detail}</span>
    </button>
  );
}
