import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  QrCode,
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
import { useConfirmation } from "@/hooks/use-confirmation";
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
  createClassPlanPixCheckout,
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

type ClassPlan = {
  id: string;
  title: string;
  description: string | null;
  duration_months: number;
  frequency_per_week: number;
  class_duration_min: number;
  price_cents: number;
  credit_modality: CreditModality;
  credit_quantity: number;
};

const PLAN_MODALITY_LABELS: Record<CreditModality, string> = {
  individual: "Individual",
  dupla: "Dupla",
  grupo: "Grupo (3 ou 4 alunos)",
};

function bookingTypeForPlan(plan: ClassPlan, groupSize: 3 | 4 = 4): BookingType {
  if (plan.credit_modality === "individual") return "aula_individual";
  if (plan.credit_modality === "dupla") return "aula_dupla";
  return groupSize === 3 ? "aula_trio" : "aula_quarteto";
}

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
  const requestConfirmation = useConfirmation();
  const [selected, setSelected] = useState(() => addDays(new Date(), 1));
  const [cursor, setCursor] = useState(() => selected);
  const [sessions, setSessions] = useState<SessionAvailability[]>([]);
  const [blocks, setBlocks] = useState<BlockedSlot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [plans, setPlans] = useState<ClassPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [professors, setProfessors] = useState<{ id: string; full_name: string | null }[]>([]);
  const [type, setType] = useState<BookingType>("quadra_livre");
  const [professorId, setProfessorId] = useState("");
  const [pendingHours, setPendingHours] = useState<Set<number>>(new Set());
  const [checkout, setCheckout] = useState<PixCheckout | null>(null);
  const [buyingPlan, setBuyingPlan] = useState(false);
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
  const activePlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const activeCreditModality = rescheduling
    ? creditModalityForBookingType(type)
    : (activePlan?.credit_modality ?? null);
  const availableCredits = activeCreditModality ? creditBalances[activeCreditModality] : 0;

  const monthDays = useMemo(() => {
    const start = startOfMonth(cursor);
    return {
      pad: getDay(start),
      days: eachDayOfInterval({ start, end: endOfMonth(cursor) }),
    };
  }, [cursor]);

  const loadCatalog = useCallback(async () => {
    const [
      { data: productRows, error: productError },
      { data: planRows, error: planError },
      { data: professorRows },
    ] = await Promise.all([
      supabase
        .from("pricing")
        .select(
          "booking_type, display_name, price_cents, student_capacity, requires_professor, sort_order",
        )
        .eq("active", true)
        .order("sort_order"),
      (supabase as any)
        .from("class_plans")
        .select(
          "id, title, description, duration_months, frequency_per_week, class_duration_min, price_cents, credit_modality, credit_quantity",
        )
        .eq("active", true)
        .order("credit_modality")
        .order("duration_months"),
      (supabase as any).rpc("list_active_professors"),
    ]);
    if (productError || planError) {
      toast.error("Não foi possível carregar os planos de aula.");
      return;
    }
    const visibleProducts = ((productRows ?? []) as Product[]).filter(
      (product) =>
        product.booking_type !== "teste" ||
        import.meta.env.VITE_ENABLE_TEST_BOOKING_TYPE === "true",
    );
    const visiblePlans = (planRows ?? []) as ClassPlan[];
    setProducts(visibleProducts);
    setPlans(visiblePlans);
    setProfessors(professorRows ?? []);
    setSelectedPlanId((current) =>
      visiblePlans.some((plan) => plan.id === current) ? current : (visiblePlans[0]?.id ?? ""),
    );
  }, []);

  useEffect(() => {
    void loadCatalog();
    const refresh = () => void loadCatalog();
    const channel = supabase
      .channel("student-booking-catalog")
      .on("postgres_changes", { event: "*", schema: "public", table: "pricing" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "class_plans" }, refresh)
      .subscribe();
    window.addEventListener("on-tennis-local-data-change", refresh);
    return () => {
      window.removeEventListener("on-tennis-local-data-change", refresh);
      void supabase.removeChannel(channel);
    };
  }, [loadCatalog]);

  useEffect(() => {
    if (!activePlan || rescheduling) return;
    const currentModality = creditModalityForBookingType(type);
    if (currentModality === activePlan.credit_modality) return;
    setType(bookingTypeForPlan(activePlan));
    setPendingHours(new Set());
  }, [activePlan, rescheduling, type]);

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
  const selectedHour = [...pendingHours][0];
  const selectedSession = selectedHour == null ? null : (sessionsByHour.get(selectedHour) ?? null);
  const selectedCapacity = selectedSession?.capacity ?? activeProduct?.student_capacity ?? 0;
  const selectedOccupiedAfterBooking = selectedSession
    ? Math.min(selectedSession.occupied_seats + 1, selectedSession.capacity)
    : selectedCapacity > 0
      ? 1
      : 0;
  const selectedAvailableAfterBooking = Math.max(
    selectedCapacity - selectedOccupiedAfterBooking,
    0,
  );
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
    const compatibleType = rescheduling
      ? session.product_type === type
      : Boolean(
          activePlan &&
          creditModalityForBookingType(session.product_type) === activePlan.credit_modality,
        );
    if (!compatibleType || session.is_full || session.my_booking_id) return false;
    return !rescheduling || session.professor_id === rescheduling.professor_id;
  };

  const canCreateSessionAt = (hour: number) => {
    if (
      !activePlan ||
      !activeProduct ||
      creditModalityForBookingType(activeProduct.booking_type) !== activePlan.credit_modality ||
      blockedByHour.has(hour) ||
      sessionsByHour.has(hour)
    )
      return false;
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
    const modality = creditModalityForBookingType(session.product_type);
    const compatiblePlan = plans.find((plan) => plan.credit_modality === modality);
    if (compatiblePlan) setSelectedPlanId(compatiblePlan.id);
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
    if (session) {
      setType(session.product_type);
      if (session.professor_id) setProfessorId(session.professor_id);
    }
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

  const buySelectedPlan = async () => {
    const startHour = [...pendingHours][0];
    const selectedSession = startHour == null ? null : sessionsByHour.get(startHour);
    const bookingProfessor = selectedSession?.professor_id ?? effectiveProfessorId;
    if (!activePlan || !activeProduct || startHour == null) return;
    if (!bookingProfessor) {
      toast.error("Selecione o professor antes de continuar.");
      return;
    }
    playPop();
    setBuyingPlan(true);
    try {
      setCheckout(
        await createClassPlanPixCheckout({
          planId: activePlan.id,
          initialBooking: {
            bookingDate: selectedDate,
            startHour,
            bookingType: type as "aula_individual" | "aula_dupla" | "aula_trio" | "aula_quarteto",
            professorId: bookingProfessor,
          },
        }),
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível gerar o Pix deste plano.");
    } finally {
      setBuyingPlan(false);
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
    const confirmed = await requestConfirmation({
      title: "Cancelar esta aula?",
      description: `A vaga será liberada imediatamente. ${policy}`,
      confirmLabel: "Cancelar aula",
      cancelLabel: "Manter aula",
      destructive: true,
    });
    if (!confirmed) return;
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

  return (
    <div className="stack-app animate-float-in">
      <PageHeader
        eyebrow="Agenda"
        title="Agenda da quadra"
        subtitle="Escolha seu plano, a data e o horário da aula"
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
              htmlFor="booking-plan"
            >
              Plano de aula
            </label>
            {rescheduling ? (
              <div className="w-full rounded-xl border border-input bg-muted px-3 py-2 text-sm">
                {activeProduct?.display_name ?? "Reserva atual"}
              </div>
            ) : (
              <select
                id="booking-plan"
                value={selectedPlanId}
                onChange={(event) => {
                  const plan = plans.find((item) => item.id === event.target.value);
                  setSelectedPlanId(event.target.value);
                  if (plan) setType(bookingTypeForPlan(plan));
                  setPendingHours(new Set());
                }}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              >
                {plans.length === 0 && <option value="">Nenhum plano disponível</option>}
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.title} · {brl(plan.price_cents)}
                  </option>
                ))}
              </select>
            )}
            {activePlan && !rescheduling && (
              <p className="mt-1 text-xs text-muted-foreground">
                {PLAN_MODALITY_LABELS[activePlan.credit_modality]} · {activePlan.credit_quantity}{" "}
                {activePlan.credit_quantity === 1 ? "crédito" : "créditos"} ·{" "}
                {activePlan.class_duration_min} minutos por aula.
              </p>
            )}
          </div>

          {activePlan && !rescheduling && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Pessoas por horário
              </div>
              <div className="inline-flex overflow-hidden rounded-xl border border-input bg-background">
                {(activePlan.credit_modality === "individual"
                  ? ([1] as const)
                  : activePlan.credit_modality === "dupla"
                    ? ([2] as const)
                    : ([3, 4] as const)
                ).map((size) => {
                  const bookingType = bookingTypeForPlan(activePlan, size === 3 ? 3 : 4);
                  const productAvailable =
                    size === 1 || size === 2
                      ? Boolean(activeProduct)
                      : productByType.has(bookingType);
                  const selectedSize = activeProduct?.student_capacity === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        if (size === 3 || size === 4) {
                          setType(bookingTypeForPlan(activePlan, size));
                          setPendingHours(new Set());
                        }
                      }}
                      disabled={!productAvailable}
                      aria-pressed={selectedSize}
                      className={`min-w-20 border-l border-input px-3 py-2 text-sm font-semibold first:border-l-0 disabled:cursor-not-allowed disabled:opacity-45 ${
                        selectedSize ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                      }`}
                    >
                      {size} {size === 1 ? "pessoa" : "pessoas"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activePlan && !activeProduct && (
            <div className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Esta modalidade está temporariamente indisponível para reservas.
            </div>
          )}

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
              {rescheduling
                ? "Pagamento já confirmado"
                : availableCredits > 0
                  ? `${availableCredits} créditos disponíveis`
                  : activePlan
                    ? `Plano por ${brl(activePlan.price_cents)}`
                    : "Nenhum plano disponível"}
            </span>
            <span className="text-xs text-muted-foreground">
              {rescheduling
                ? "sem nova cobrança"
                : availableCredits > 0
                  ? "use 1 por aula"
                  : "pagamento por Pix"}
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
              {!rescheduling && selectedCapacity > 1 && (
                <div className="flex items-start gap-2 border-t border-primary/20 pt-2 text-xs">
                  <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    Após reservar, a turma ficará com {selectedOccupiedAfterBooking} de{" "}
                    {selectedCapacity} vagas ocupadas e {selectedAvailableAfterBooking}{" "}
                    {selectedAvailableAfterBooking === 1 ? "vaga restante" : "vagas restantes"}.
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between border-y border-primary/20 py-2">
                <span className="text-sm text-muted-foreground">
                  {rescheduling
                    ? "Troca de horário"
                    : availableCredits > 0
                      ? "Crédito utilizado"
                      : "Plano selecionado"}
                </span>
                <strong className="type-data text-lg">
                  {rescheduling
                    ? "Sem cobrança"
                    : availableCredits > 0
                      ? "1 crédito"
                      : activePlan
                        ? brl(activePlan.price_cents)
                        : "—"}
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
                  {activePlan && activeCreditModality && availableCredits > 0 ? (
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
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void buySelectedPlan()}
                        disabled={buyingPlan || !activePlan}
                        className="btn-bounce inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {buyingPlan ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <QrCode className="h-4 w-4" />
                        )}
                        Comprar plano e reservar
                      </button>
                      <p className="text-center text-xs text-muted-foreground">
                        Esta vaga fica protegida enquanto o Pix estiver pendente. Quando o pagamento
                        for confirmado, o plano será ativado e 1 crédito confirmará automaticamente
                        esta aula.
                      </p>
                    </>
                  )}
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
                        {session.capacity > 1 && (
                          <span className="block text-xs font-medium text-primary">
                            Sua vaga · {session.occupied_seats}/{session.capacity} ocupadas ·{" "}
                            {session.available_seats}{" "}
                            {session.available_seats === 1 ? "restante" : "restantes"}
                          </span>
                        )}
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
          onPaid={() => {
            setPendingHours(new Set());
            void Promise.all([loadMonth(), loadCredits()]);
          }}
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
  let occupancyDetail: string | null = null;
  if (blockedReason !== undefined && !session) detail = "Bloqueado";
  if (session?.is_full && !mine) detail = "Lotado";
  if (session && canJoin) {
    detail = `${session.available_seats} ${session.available_seats === 1 ? "vaga" : "vagas"}`;
    occupancyDetail = `${session.occupied_seats}/${session.capacity} ocupadas`;
  }
  if (mine) {
    detail = session?.my_payment_status === "pendente" ? "Aguardando Pix" : "Sua vaga";
    if (session && session.capacity > 1) {
      occupancyDetail =
        session.available_seats === 0
          ? "Turma completa"
          : `${session.occupied_seats}/${session.capacity} · ${session.available_seats} ${session.available_seats === 1 ? "restante" : "restantes"}`;
    }
  }
  if (session && !mine && !canJoin && !session.is_full) detail = "Outra aula";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !actionable}
      title={blockedReason ? `Bloqueado: ${blockedReason}` : session?.display_name}
      className={`flex h-[4.5rem] flex-col items-center justify-center border px-1.5 py-2 text-xs font-semibold transition ${
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
      {occupancyDetail && (
        <span className="mt-0.5 max-w-full text-center text-[10px] font-medium leading-tight">
          {occupancyDetail}
        </span>
      )}
    </button>
  );
}
