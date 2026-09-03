import { isLocalSupabaseMode, supabase } from "@/integrations/supabase/client";
import { cancelCreditBookingServer, createCreditBookingServer } from "@/lib/credits.functions";
import { assertBookingSchedule, venueBookingStartMs } from "@/lib/booking-schedule";

export type CreditModality = "individual" | "dupla" | "grupo";

export type CreateCreditBookingInput = {
  bookingDate: string;
  startHour: number;
  bookingType: "aula_individual" | "aula_dupla" | "aula_trio" | "aula_quarteto";
  professorId: string;
};

export type CreateCreditBookingResult = {
  booking_id: string;
  session_id: string;
  allocation_id: string;
  available_credits: number;
  modality: CreditModality;
  booking_date: string;
  start_hour: number;
};

export type CancelCreditBookingResult = {
  booking_id: string;
  credit_returned: boolean;
  available_credits: number;
  notice_hours: number;
  already_cancelled: boolean;
};

export function creditModalityForBookingType(type: string): CreditModality | null {
  if (type === "aula_individual") return "individual";
  if (type === "aula_dupla") return "dupla";
  if (type === "aula_trio" || type === "aula_quarteto") return "grupo";
  return null;
}

export async function createCreditBooking(
  input: CreateCreditBookingInput,
): Promise<CreateCreditBookingResult> {
  if (isLocalSupabaseMode()) return createLocalCreditBooking(input);
  return createCreditBookingServer({ data: input }) as Promise<CreateCreditBookingResult>;
}

export async function cancelCreditBooking(bookingId: string): Promise<CancelCreditBookingResult> {
  if (isLocalSupabaseMode()) return cancelLocalCreditBooking(bookingId);
  return cancelCreditBookingServer({ data: { bookingId } }) as Promise<CancelCreditBookingResult>;
}

async function createLocalCreditBooking(
  input: CreateCreditBookingInput,
): Promise<CreateCreditBookingResult> {
  assertBookingSchedule(input.bookingDate, input.startHour);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sessão expirada.");
  const modality = creditModalityForBookingType(input.bookingType);
  if (!modality) throw new Error("Este tipo de aula não aceita crédito.");

  const [{ data: grants }, { data: ledger }, { data: product }, { data: sessions }] =
    await Promise.all([
      (supabase as any)
        .from("student_credit_grants")
        .select("*")
        .eq("user_id", auth.user.id)
        .eq("modality", modality)
        .eq("status", "active")
        .order("granted_at"),
      (supabase as any).from("student_credit_ledger").select("*").eq("user_id", auth.user.id),
      (supabase as any)
        .from("pricing")
        .select("*")
        .eq("booking_type", input.bookingType)
        .eq("active", true)
        .maybeSingle(),
      (supabase as any)
        .from("reservation_sessions")
        .select("*")
        .eq("booking_date", input.bookingDate)
        .eq("start_hour", input.startHour)
        .eq("status", "open"),
    ]);
  if (!product) throw new Error("Este tipo de aula não está disponível.");

  const balanceForGrant = (grantId: string) =>
    (ledger ?? [])
      .filter((entry: any) => entry.grant_id === grantId)
      .reduce((sum: number, entry: any) => sum + Number(entry.credit_delta || 0), 0);
  const grant = (grants ?? []).find((item: any) => balanceForGrant(item.id) > 0);
  if (!grant) throw new Error("Você não possui crédito disponível para esta modalidade.");

  const { data: occupied } = await (supabase as any)
    .from("bookings_occupancy")
    .select("id, session_id, user_id");
  let session = (sessions ?? [])[0];
  if (session) {
    if (session.product_type !== input.bookingType || session.professor_id !== input.professorId) {
      throw new Error("Este horário possui outro tipo de aula ou professor.");
    }
    const participants = (occupied ?? []).filter((row: any) => row.session_id === session.id);
    if (participants.some((row: any) => row.user_id === auth.user.id)) {
      throw new Error("Você já possui uma vaga neste horário.");
    }
    if (participants.length >= session.capacity) {
      throw new Error("A última vaga deste horário já foi ocupada.");
    }
  } else {
    const { data: blocks } = await (supabase as any)
      .from("blocked_slots")
      .select("professor_id")
      .eq("block_date", input.bookingDate)
      .eq("start_hour", input.startHour);
    if (
      (blocks ?? []).some(
        (block: any) => block.professor_id == null || block.professor_id === input.professorId,
      )
    ) {
      throw new Error("O horário está bloqueado.");
    }
    session = {
      id: crypto.randomUUID(),
      booking_date: input.bookingDate,
      start_hour: input.startHour,
      professor_id: input.professorId,
      product_type: input.bookingType,
      capacity: product.student_capacity,
      unit_price_cents: product.price_cents,
      status: "open",
    };
    await (supabase as any).from("reservation_sessions").insert(session);
  }

  const bookingId = crypto.randomUUID();
  const allocationId = crypto.randomUUID();
  const now = new Date().toISOString();
  await (supabase as any).from("bookings").insert({
    id: bookingId,
    session_id: session.id,
    user_id: auth.user.id,
    professor_id: session.professor_id,
    booking_date: input.bookingDate,
    start_hour: input.startHour,
    duration_hours: 1,
    type: input.bookingType,
    status: "confirmada",
    payment_status: "pago",
    payment_method: "credito_plano",
    price_cents: 0,
    amount_cents: 0,
    checkout_order_id: null,
    credit_grant_id: grant.id,
    hold_expires_at: null,
    confirmed_at: now,
    attended: null,
  });
  await (supabase as any).from("student_credit_allocations").insert({
    id: allocationId,
    grant_id: grant.id,
    user_id: auth.user.id,
    booking_id: bookingId,
    status: "reserved",
    reserved_at: now,
    resolved_at: null,
  });
  await (supabase as any).from("student_credit_ledger").insert({
    user_id: auth.user.id,
    grant_id: grant.id,
    booking_id: bookingId,
    checkout_order_id: grant.checkout_order_id,
    entry_type: "booking_debit",
    credit_delta: -1,
    idempotency_key: `booking-debit:${bookingId}`,
    reason: "Crédito reservado para uma aula.",
    actor_user_id: auth.user.id,
    metadata: { booking_date: input.bookingDate, start_hour: input.startHour },
    previous_hash: "local",
    entry_hash: `local-${crypto.randomUUID()}`,
    created_at: now,
  });

  await (supabase as any).from("notifications").insert({
    user_id: auth.user.id,
    title: "Aula confirmada",
    body: `Sua vaga para ${input.bookingDate.split("-").reverse().slice(0, 2).join("/")} às ${String(input.startHour).padStart(2, "0")}:00 foi confirmada com 1 crédito.`,
    kind: "credit_booking_confirmed",
    related_booking_id: bookingId,
  });

  const availableCredits =
    (grants ?? []).reduce((sum: number, item: any) => sum + balanceForGrant(item.id), 0) - 1;
  return {
    booking_id: bookingId,
    session_id: session.id,
    allocation_id: allocationId,
    available_credits: availableCredits,
    modality,
    booking_date: input.bookingDate,
    start_hour: input.startHour,
  };
}

async function cancelLocalCreditBooking(bookingId: string): Promise<CancelCreditBookingResult> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sessão expirada.");
  const [{ data: booking }, { data: allocation }, { data: policy }] = await Promise.all([
    (supabase as any).from("bookings").select("*").eq("id", bookingId).maybeSingle(),
    (supabase as any)
      .from("student_credit_allocations")
      .select("*")
      .eq("booking_id", bookingId)
      .maybeSingle(),
    (supabase as any)
      .from("site_settings")
      .select("value")
      .eq("key", "cancellation_notice_hours")
      .maybeSingle(),
  ]);
  if (!booking || booking.user_id !== auth.user.id || !allocation) {
    throw new Error("Reserva por crédito não encontrada.");
  }
  const noticeHours = Math.min(720, Math.max(0, Number(policy?.value ?? 24) || 24));
  if (booking.status === "cancelada") {
    const { data: summary } = await (supabase as any)
      .from("student_credit_summary")
      .select("available_credits")
      .eq("user_id", auth.user.id);
    return {
      booking_id: booking.id,
      credit_returned: allocation.status === "returned",
      available_credits: (summary ?? []).reduce(
        (sum: number, row: any) => sum + Number(row.available_credits || 0),
        0,
      ),
      notice_hours: noticeHours,
      already_cancelled: true,
    };
  }
  if (allocation.status !== "reserved") {
    throw new Error("Esta aula já foi concluída e o crédito foi consumido.");
  }
  const startMs = venueBookingStartMs(booking.booking_date, booking.start_hour);
  if (startMs <= Date.now()) throw new Error("Uma aula que já começou não pode ser cancelada.");
  const creditReturned = startMs >= Date.now() + noticeHours * 60 * 60 * 1000;
  const now = new Date().toISOString();
  await (supabase as any).from("bookings").update({ status: "cancelada" }).eq("id", booking.id);
  await (supabase as any)
    .from("student_credit_allocations")
    .update({ status: creditReturned ? "returned" : "forfeited", resolved_at: now })
    .eq("id", allocation.id);
  if (creditReturned) {
    await (supabase as any).from("student_credit_ledger").insert({
      user_id: auth.user.id,
      grant_id: allocation.grant_id,
      booking_id: booking.id,
      checkout_order_id: null,
      entry_type: "cancellation_credit",
      credit_delta: 1,
      idempotency_key: `booking-cancellation:${booking.id}`,
      reason: "Crédito devolvido por cancelamento dentro do prazo.",
      actor_user_id: auth.user.id,
      metadata: { notice_hours: noticeHours },
      previous_hash: "local",
      entry_hash: `local-${crypto.randomUUID()}`,
      created_at: now,
    });
  } else {
    await (supabase as any).from("student_credit_ledger").insert({
      user_id: auth.user.id,
      grant_id: allocation.grant_id,
      booking_id: booking.id,
      checkout_order_id: null,
      entry_type: "late_cancellation_forfeit",
      credit_delta: 0,
      idempotency_key: `booking-cancellation:${booking.id}`,
      reason: "Aula cancelada fora do prazo; o crédito permaneceu consumido.",
      actor_user_id: auth.user.id,
      metadata: { notice_hours: noticeHours },
      previous_hash: "local",
      entry_hash: `local-${crypto.randomUUID()}`,
      created_at: now,
    });
  }
  await (supabase as any).from("notifications").insert({
    user_id: auth.user.id,
    title: creditReturned ? "Crédito devolvido" : "Aula cancelada",
    body: creditReturned
      ? "Sua aula foi cancelada e o crédito já está disponível para uma nova reserva."
      : `Sua aula foi cancelada. Como faltavam menos de ${noticeHours} horas, o crédito não foi devolvido.`,
    kind: "credit_booking_cancelled",
    related_booking_id: booking.id,
  });
  const { data: summary } = await (supabase as any)
    .from("student_credit_summary")
    .select("available_credits")
    .eq("user_id", auth.user.id);
  return {
    booking_id: booking.id,
    credit_returned: creditReturned,
    available_credits: (summary ?? []).reduce(
      (sum: number, row: any) => sum + Number(row.available_credits || 0),
      0,
    ),
    notice_hours: noticeHours,
    already_cancelled: false,
  };
}
