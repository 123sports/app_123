import { supabaseAdmin } from "@/integrations/supabase/client.server";

type CheckoutOrderForValidation = {
  id: string;
  kind: string;
  amount_cents: number;
};

export async function hasCompleteActiveBookingHold(order: CheckoutOrderForValidation) {
  if (order.kind !== "booking") return true;

  const [{ data: bookings, error: bookingsError }, { data: items, error: itemsError }] =
    await Promise.all([
      (supabaseAdmin as any)
        .from("bookings")
        .select(
          "id, session_id, booking_date, start_hour, type, professor_id, status, payment_status, price_cents, amount_cents, hold_expires_at",
        )
        .eq("checkout_order_id", order.id),
      (supabaseAdmin as any)
        .from("checkout_items")
        .select("reference_id, quantity, unit_amount_cents, total_amount_cents, metadata")
        .eq("checkout_order_id", order.id)
        .eq("item_type", "booking"),
    ]);

  if (bookingsError) throw bookingsError;
  if (itemsError) throw itemsError;

  const bookingRows = bookings ?? [];
  const itemRows = items ?? [];
  if (!bookingRows.length || bookingRows.length !== itemRows.length) return false;

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
      Number(session.unit_price_cents) === Number(booking.amount_cents) &&
      Number(booking.price_cents ?? booking.amount_cents) === Number(booking.amount_cents) &&
      booking.status === "pendente" &&
      booking.payment_status === "pendente" &&
      typeof booking.hold_expires_at === "string" &&
      new Date(booking.hold_expires_at).getTime() > now &&
      item?.metadata?.session_id === booking.session_id &&
      Number(item?.quantity ?? 0) === 1 &&
      Number(item?.unit_amount_cents ?? 0) === Number(booking.amount_cents ?? 0) &&
      Number(item?.total_amount_cents ?? 0) === Number(booking.amount_cents ?? 0)
    );
  });
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
