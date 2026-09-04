import { supabaseAdmin } from "@/integrations/supabase/client.server";

type CheckoutOrderForValidation = {
  id: string;
  kind: string;
  amount_cents: number;
  metadata?: {
    initial_booking?: {
      booking_id?: unknown;
      session_id?: unknown;
      booking_date?: unknown;
      start_hour?: unknown;
      booking_type?: unknown;
      professor_id?: unknown;
      capacity?: unknown;
    } | null;
    booking_ids?: unknown;
    session_ids?: unknown;
  } | null;
};

export async function hasCompleteActiveBookingHold(order: CheckoutOrderForValidation) {
  const initialBooking = order.metadata?.initial_booking;
  const isPlanBooking = order.kind === "class_plan" && Boolean(initialBooking);
  if (order.kind !== "booking" && !isPlanBooking) return true;

  const bookingsQuery = (supabaseAdmin as any)
    .from("bookings")
    .select(
      "id, session_id, booking_date, start_hour, duration_hours, type, professor_id, status, payment_status, price_cents, amount_cents, hold_expires_at",
    )
    .eq("checkout_order_id", order.id);
  const [{ data: bookings, error: bookingsError }, { data: items, error: itemsError }] =
    await Promise.all([
      bookingsQuery,
      isPlanBooking
        ? Promise.resolve({ data: [], error: null })
        : (supabaseAdmin as any)
            .from("checkout_items")
            .select("reference_id, quantity, unit_amount_cents, total_amount_cents, metadata")
            .eq("checkout_order_id", order.id)
            .eq("item_type", "booking"),
    ]);

  if (bookingsError) throw bookingsError;
  if (itemsError) throw itemsError;

  const bookingRows = bookings ?? [];
  const itemRows = items ?? [];
  if (!bookingRows.length || (!isPlanBooking && bookingRows.length !== itemRows.length))
    return false;

  const now = Date.now();
  const itemsByBookingId = new Map(itemRows.map((item: any) => [item.reference_id, item]));
  const sessionIds = [
    ...new Set(bookingRows.map((booking: any) => booking.session_id).filter(Boolean)),
  ];
  const { data: sessions, error: sessionsError } = sessionIds.length
    ? await (supabaseAdmin as any)
        .from("reservation_sessions")
        .select(
          "id, booking_date, start_hour, product_type, professor_id, capacity, unit_price_cents, status",
        )
        .in("id", sessionIds)
    : { data: [], error: null };
  if (sessionsError) throw sessionsError;
  const sessionsById = new Map((sessions ?? []).map((session: any) => [session.id, session]));
  const allBookingsActive = bookingRows.every((booking: any) => {
    const session: any = sessionsById.get(booking.session_id);
    const item: any = itemsByBookingId.get(booking.id);
    return (
      session?.status === "open" &&
      session.booking_date === booking.booking_date &&
      session.start_hour === booking.start_hour &&
      session.product_type === booking.type &&
      session.professor_id === booking.professor_id &&
      Number(booking.duration_hours) === 1 &&
      Number(session.unit_price_cents) === Number(booking.amount_cents) &&
      Number(booking.price_cents) === Number(booking.amount_cents) &&
      booking.status === "pendente" &&
      booking.payment_status === "pendente" &&
      typeof booking.hold_expires_at === "string" &&
      new Date(booking.hold_expires_at).getTime() > now &&
      (isPlanBooking ||
        (item?.metadata?.session_id === booking.session_id &&
          Number(item?.quantity ?? 0) === 1 &&
          Number(item?.unit_amount_cents ?? 0) === Number(booking.amount_cents ?? 0) &&
          Number(item?.total_amount_cents ?? 0) === Number(booking.amount_cents ?? 0)))
    );
  });

  if (isPlanBooking) {
    if (bookingRows.length !== 1 || !initialBooking) return false;
    const [booking] = bookingRows;
    const session: any = sessionsById.get(booking.session_id);
    const bookingIds = order.metadata?.booking_ids;
    const sessionIds = order.metadata?.session_ids;
    return (
      allBookingsActive &&
      sessionsById.size === 1 &&
      Array.isArray(bookingIds) &&
      bookingIds.length === 1 &&
      bookingIds[0] === booking.id &&
      Array.isArray(sessionIds) &&
      sessionIds.length === 1 &&
      sessionIds[0] === booking.session_id &&
      String(initialBooking.booking_id ?? "") === booking.id &&
      String(initialBooking.session_id ?? "") === booking.session_id &&
      String(initialBooking.booking_date ?? "") === booking.booking_date &&
      Number(initialBooking.start_hour) === booking.start_hour &&
      String(initialBooking.booking_type ?? "") === booking.type &&
      String(initialBooking.professor_id ?? "") === String(booking.professor_id ?? "") &&
      Number(initialBooking.capacity) === Number(session?.capacity)
    );
  }

  const bookingTotal = bookingRows.reduce(
    (total: number, booking: any) => total + Number(booking.amount_cents ?? 0),
    0,
  );
  const itemTotal = itemRows.reduce(
    (total: number, item: any) => total + Number(item.total_amount_cents ?? 0),
    0,
  );

  return (
    allBookingsActive &&
    sessionsById.size === sessionIds.length &&
    itemsByBookingId.size === bookingRows.length &&
    bookingTotal === order.amount_cents &&
    itemTotal === order.amount_cents
  );
}
