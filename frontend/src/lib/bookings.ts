import { isLocalSupabaseMode, supabase } from "@/integrations/supabase/client";
import { reschedulePaidBookingServer } from "@/lib/bookings.functions";
import { assertBookingSchedule, hasBookingMinimumNotice } from "@/lib/booking-schedule";

export type ReschedulePaidBookingInput = {
  bookingId: string;
  newBookingDate: string;
  newStartHour: number;
};

export type ReschedulePaidBookingResult = {
  booking_id: string;
  old_booking_date: string;
  old_start_hour: number;
  new_booking_date: string;
  new_start_hour: number;
  payment_status: string;
};

function assertLocalRescheduleWindow(
  oldDate: string,
  oldHour: number,
  newDate: string,
  newHour: number,
) {
  if (!hasBookingMinimumNotice(oldDate, oldHour)) {
    throw new Error("A troca exige no mínimo duas horas de antecedência.");
  }
  assertBookingSchedule(newDate, newHour);
  if (oldDate === newDate && oldHour === newHour) {
    throw new Error("Escolha um horário diferente da reserva atual.");
  }
}

async function rescheduleLocalPaidBooking(
  input: ReschedulePaidBookingInput,
): Promise<ReschedulePaidBookingResult> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sessão expirada.");

  const { data: booking, error: bookingError } = await (supabase as any)
    .from("bookings")
    .select("*")
    .eq("id", input.bookingId)
    .maybeSingle();
  if (bookingError || !booking || booking.user_id !== auth.user.id) {
    throw new Error("Reserva não encontrada.");
  }
  if (booking.status !== "confirmada" || booking.payment_status !== "pago") {
    throw new Error("Somente uma reserva paga e confirmada pode ser trocada.");
  }
  if (booking.attended === true) {
    throw new Error("Uma reserva com presença registrada não pode ser trocada.");
  }

  if (booking.booking_date === input.newBookingDate && booking.start_hour === input.newStartHour) {
    return {
      booking_id: booking.id,
      old_booking_date: booking.booking_date,
      old_start_hour: booking.start_hour,
      new_booking_date: input.newBookingDate,
      new_start_hour: input.newStartHour,
      payment_status: booking.payment_status,
    };
  }

  assertLocalRescheduleWindow(
    booking.booking_date,
    booking.start_hour,
    input.newBookingDate,
    input.newStartHour,
  );

  const [{ data: occupied }, { data: blocks }] = await Promise.all([
    (supabase as any)
      .from("bookings_occupancy")
      .select("id")
      .eq("booking_date", input.newBookingDate)
      .eq("start_hour", input.newStartHour),
    (supabase as any)
      .from("blocked_slots")
      .select("professor_id")
      .eq("block_date", input.newBookingDate)
      .eq("start_hour", input.newStartHour),
  ]);

  if ((occupied ?? []).some((row: any) => row.id !== booking.id)) {
    throw new Error("O novo horário não está mais disponível.");
  }
  if (
    (blocks ?? []).some(
      (row: any) => row.professor_id == null || row.professor_id === booking.professor_id,
    )
  ) {
    throw new Error("O novo horário está bloqueado.");
  }

  const movedAt = new Date().toISOString();
  const { error: updateError } = await (supabase as any)
    .from("bookings")
    .update({
      booking_date: input.newBookingDate,
      start_hour: input.newStartHour,
    })
    .eq("id", booking.id)
    .eq("user_id", auth.user.id);
  if (updateError) throw new Error(updateError.message);

  await (supabase as any).from("booking_reschedules").insert({
    booking_id: booking.id,
    user_id: auth.user.id,
    changed_by: auth.user.id,
    professor_id: booking.professor_id,
    checkout_order_id: booking.checkout_order_id ?? crypto.randomUUID(),
    old_booking_date: booking.booking_date,
    old_start_hour: booking.start_hour,
    new_booking_date: input.newBookingDate,
    new_start_hour: input.newStartHour,
    booking_type: booking.type,
    amount_cents: booking.amount_cents ?? booking.price_cents ?? 1,
    reason: "student_reschedule",
    created_at: movedAt,
  });

  await (supabase as any).from("notifications").insert({
    user_id: auth.user.id,
    title: "Horário alterado",
    body: `Tudo certo! Sua reserva agora está marcada para ${input.newBookingDate.split("-").reverse().join("/")} às ${String(input.newStartHour).padStart(2, "0")}:00.`,
    kind: "booking_rescheduled",
    related_booking_id: booking.id,
  });

  return {
    booking_id: booking.id,
    old_booking_date: booking.booking_date,
    old_start_hour: booking.start_hour,
    new_booking_date: input.newBookingDate,
    new_start_hour: input.newStartHour,
    payment_status: booking.payment_status,
  };
}

export async function reschedulePaidBooking(
  input: ReschedulePaidBookingInput,
): Promise<ReschedulePaidBookingResult> {
  if (isLocalSupabaseMode()) return rescheduleLocalPaidBooking(input);
  return reschedulePaidBookingServer({ data: input }) as Promise<ReschedulePaidBookingResult>;
}
