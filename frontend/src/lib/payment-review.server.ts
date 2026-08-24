import { supabaseAdmin } from "@/integrations/supabase/client.server";

const REVIEWABLE_ORDER_STATUSES = [
  "pending",
  "expired",
  "cancelled",
  "failed",
  "refunded",
];

function friendlyReviewMessage(orderId: string, reason: string) {
  const reference = orderId.slice(0, 8).toUpperCase();

  if (/reserva ativa/i.test(reason)) {
    return `O Pix foi recebido depois que o prazo da reserva terminou. Confira o pagamento na área Financeiro e combine um novo horário com o aluno. Referência ${reference}.`;
  }
  if (/valor|moeda|referencia externa/i.test(reason)) {
    return `Os dados recebidos do pagamento não correspondem ao pedido. Confira os detalhes na área Financeiro antes de confirmar a reserva. Referência ${reference}.`;
  }

  return `Este Pix não pôde ser conciliado automaticamente. Confira os detalhes na área Financeiro. Referência ${reference}.`;
}

async function notifyAdmins(orderId: string, reason: string) {
  const body = friendlyReviewMessage(orderId, reason);
  const { data: admins, error: adminsError } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  if (adminsError) throw adminsError;

  for (const admin of admins ?? []) {
    const reference = orderId.slice(0, 8).toUpperCase();
    const { data: existingRows, error: existingError } = await (supabaseAdmin as any)
      .from("notifications")
      .select("id, body")
      .eq("user_id", admin.user_id)
      .eq("kind", "payment_review")
      .order("created_at", { ascending: false })
      .limit(100);
    if (existingError) throw existingError;
    if (
      existingRows?.some((notification: { body: string | null }) =>
        notification.body?.toUpperCase().includes(reference),
      )
    ) {
      continue;
    }

    const { error: notificationError } = await (supabaseAdmin as any)
      .from("notifications")
      .insert({
        user_id: admin.user_id,
        title: "Pagamento precisa de atenção",
        body,
        kind: "payment_review",
      });
    if (notificationError) throw notificationError;
  }
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

  // Only one alert per order and administrator is kept. A retry can recreate
  // a notification that failed after the order status was already changed.
  if (flaggedOrder) {
    await notifyAdmins(orderId, reason);
    return "paid_needs_review" as const;
  }

  const { data: currentOrder, error: currentError } = await (supabaseAdmin as any)
    .from("checkout_orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (currentError) throw currentError;

  if (currentOrder?.status === "paid_needs_review") {
    await notifyAdmins(orderId, reason);
  }

  return (currentOrder?.status ?? "paid_needs_review") as string;
}
