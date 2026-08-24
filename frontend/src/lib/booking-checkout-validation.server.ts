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
        .select("id, status, payment_status, amount_cents, hold_expires_at")
        .eq("checkout_order_id", order.id),
      (supabaseAdmin as any)
        .from("checkout_items")
        .select("reference_id, total_amount_cents")
        .eq("checkout_order_id", order.id)
        .eq("item_type", "booking"),
    ]);

  if (bookingsError) throw bookingsError;
  if (itemsError) throw itemsError;

  const bookingRows = bookings ?? [];
  const itemRows = items ?? [];
  if (!bookingRows.length || bookingRows.length !== itemRows.length) return false;

  const now = Date.now();
  const itemIds = new Set(itemRows.map((item: any) => item.reference_id).filter(Boolean));
  const allBookingsActive = bookingRows.every(
    (booking: any) =>
      booking.status === "pendente" &&
      booking.payment_status === "pendente" &&
      typeof booking.hold_expires_at === "string" &&
      new Date(booking.hold_expires_at).getTime() > now &&
      itemIds.has(booking.id),
  );
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
    itemIds.size === bookingRows.length &&
    bookingTotal === order.amount_cents &&
    itemTotal === order.amount_cents
  );
}
