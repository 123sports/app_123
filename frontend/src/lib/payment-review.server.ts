import { supabaseAdmin } from "@/integrations/supabase/client.server";

const REVIEWABLE_ORDER_STATUSES = ["pending", "paid", "expired", "cancelled", "failed"];

function friendlyReviewMessage(orderId: string, reason: string) {
  const reference = orderId.slice(0, 8).toUpperCase();

  if (/reservas? ativas?/i.test(reason)) {
    return `O Pix foi recebido depois que o prazo da reserva terminou. Confira o registro em Pagamentos e combine um novo horário com o aluno. Referência ${reference}.`;
  }
  if (/valor|moeda|referencia externa/i.test(reason)) {
    return `Os dados recebidos do pagamento não correspondem ao pedido. Confira o registro em Pagamentos antes de confirmar a reserva. Referência ${reference}.`;
  }

  return `Este Pix não pôde ser conciliado automaticamente. Confira o registro em Pagamentos. Referência ${reference}.`;
}

async function hasReviewNotification(userId: string, orderId: string) {
  const { data, error } = await (supabaseAdmin as any)
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "payment_review")
    .eq("related_checkout_order_id", orderId)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function insertReviewNotification(input: {
  userId: string;
  title: string;
  body: string;
  orderId: string;
  bookingId?: string | null;
}) {
  const { error } = await (supabaseAdmin as any).from("notifications").insert({
    user_id: input.userId,
    title: input.title,
    body: input.body,
    kind: "payment_review",
    related_checkout_order_id: input.orderId,
    related_booking_id: input.bookingId ?? null,
  });
  if (error && error.code !== "23505") throw error;
}

async function notifyAdmins(
  orderId: string,
  reason: string,
  payerUserId: string,
  bookingId?: string | null,
) {
  const body = friendlyReviewMessage(orderId, reason);
  const { data: admins, error: adminsError } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  if (adminsError) throw adminsError;

  for (const admin of admins ?? []) {
    if (admin.user_id === payerUserId) continue;
    if (await hasReviewNotification(admin.user_id, orderId)) continue;

    await insertReviewNotification({
      userId: admin.user_id,
      title: "Pagamento precisa de atenção",
      body,
      orderId,
      bookingId,
    });
  }
}

async function notifyPayer(orderId: string, payerUserId: string, bookingId?: string | null) {
  const reference = orderId.slice(0, 8).toUpperCase();
  if (await hasReviewNotification(payerUserId, orderId)) return;

  await insertReviewNotification({
    userId: payerUserId,
    title: "Pagamento em análise",
    body: `Recebemos uma atualização do seu Pix, mas a confirmação precisa de uma conferência. Não faça outro pagamento. Acompanhe o status em Pagamentos. Referência ${reference}.`,
    orderId,
    bookingId,
  });
}

export async function flagPaymentForReview(orderId: string, reason: string) {
  const { data: flaggedOrder, error: flagError } = await (supabaseAdmin as any)
    .from("checkout_orders")
    .update({ status: "paid_needs_review" })
    .eq("id", orderId)
    .in("status", REVIEWABLE_ORDER_STATUSES)
    .select("id, status")
    .maybeSingle();
  if (flagError) throw flagError;

  const [{ data: currentOrder, error: currentError }, { data: booking, error: bookingError }] =
    await Promise.all([
      (supabaseAdmin as any)
        .from("checkout_orders")
        .select("status, user_id")
        .eq("id", orderId)
        .maybeSingle(),
      (supabaseAdmin as any)
        .from("bookings")
        .select("id")
        .eq("checkout_order_id", orderId)
        .order("booking_date", { ascending: true })
        .order("start_hour", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
  if (currentError) throw currentError;
  if (bookingError) throw bookingError;

  // Keep paid/refunded financial states immutable while still alerting the
  // participants about a reconciliation inconsistency. Notifications are idempotent.
  if ((flaggedOrder || currentOrder) && currentOrder?.user_id) {
    await Promise.all([
      notifyPayer(orderId, currentOrder.user_id, booking?.id),
      notifyAdmins(orderId, reason, currentOrder.user_id, booking?.id),
    ]);
  }

  return (flaggedOrder?.status ?? currentOrder?.status ?? "paid_needs_review") as string;
}
