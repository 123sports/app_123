import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hasCompleteActiveBookingHold } from "@/lib/booking-checkout-validation.server";
import { getMercadoPagoPayment, isMercadoPagoConfigured } from "@/lib/mercado-pago.server";
import {
  mercadoPagoPaymentStatus,
  safeMercadoPagoPayload,
  validateMercadoPagoPaymentForOrder,
} from "@/lib/payment-security";

const reconcileSchema = z
  .object({
    orderId: z.string().uuid(),
  })
  .strict();

async function requireAdmin(userId: string) {
  const { data, error } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error("Não foi possível validar o acesso administrativo.");
  if (!data) throw new Error("Acesso restrito ao administrador.");
}

function reviewResult(message: string) {
  return { status: "paid_needs_review" as const, resolved: false, message };
}

export const reconcileReviewedPaymentServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => reconcileSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    if (!isMercadoPagoConfigured()) {
      throw new Error("Mercado Pago ainda não foi configurado no servidor.");
    }

    const { data: order, error: orderError } = await (supabaseAdmin as any)
      .from("checkout_orders")
      .select("id, user_id, kind, status, amount_cents, currency")
      .eq("id", data.orderId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pagamento não encontrado.");
    if (order.status === "paid") {
      return { status: "paid" as const, resolved: true, message: "Este Pix já está confirmado." };
    }
    if (order.status !== "paid_needs_review") {
      throw new Error("Este pagamento não está aguardando conferência.");
    }

    const { data: attempt, error: attemptError } = await (supabaseAdmin as any)
      .from("payment_attempts")
      .select("id, status, provider_payment_id")
      .eq("checkout_order_id", order.id)
      .eq("provider", "mercado_pago")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (attemptError) throw new Error(attemptError.message);
    if (!attempt?.provider_payment_id) {
      return reviewResult("Não há uma identificação do Mercado Pago para consultar.");
    }

    let payment;
    try {
      payment = await getMercadoPagoPayment(attempt.provider_payment_id);
    } catch (error) {
      console.warn("[MercadoPago] Administrative reconciliation query failed", {
        orderId: order.id,
        error: error instanceof Error ? error.name : "unknown_error",
      });
      throw new Error("Não foi possível consultar o Mercado Pago agora. Tente novamente.");
    }

    const mappedStatus = mercadoPagoPaymentStatus(payment.status, payment.status_detail);
    const validation = validateMercadoPagoPaymentForOrder(payment, order);
    if (!validation.valid) {
      return reviewResult(
        "O pagamento consultado não corresponde ao valor, moeda, método ou referência deste pedido.",
      );
    }
    if (mappedStatus !== "paid") {
      return reviewResult(
        mappedStatus === "pending"
          ? "O Mercado Pago ainda não confirmou este Pix."
          : `O Mercado Pago informou o status ${mappedStatus}; a reserva não foi confirmada.`,
      );
    }

    const { error: attemptUpdateError } = await (supabaseAdmin as any)
      .from("payment_attempts")
      .update({
        status: "paid",
        paid_at: payment.date_approved ?? new Date().toISOString(),
        provider_payload: safeMercadoPagoPayload(payment),
      })
      .eq("id", attempt.id)
      .in("status", ["pending", "expired", "cancelled", "failed", "paid_needs_review"]);
    if (attemptUpdateError) throw new Error(attemptUpdateError.message);

    if (attempt.status !== "paid") {
      const { data: verifiedAttempt, error: verifiedAttemptError } = await (supabaseAdmin as any)
        .from("payment_attempts")
        .select("status")
        .eq("id", attempt.id)
        .maybeSingle();
      if (verifiedAttemptError) throw new Error(verifiedAttemptError.message);
      if (verifiedAttempt?.status !== "paid") {
        return reviewResult("O status financeiro mudou durante a conferência. Tente novamente.");
      }
    }

    const paidAt = payment.date_approved ?? new Date().toISOString();
    if (order.kind === "booking" && !(await hasCompleteActiveBookingHold(order))) {
      const { error: restoreError } = await (supabaseAdmin as any).rpc(
        "restore_review_booking_checkout",
        { p_order_id: order.id, p_paid_at: paidAt },
      );
      if (restoreError) {
        return reviewResult(
          `${restoreError.message} Combine uma nova data com o aluno antes de encerrar a conferência.`,
        );
      }
    } else {
      const { data: paidOrder, error: paidOrderError } = await (supabaseAdmin as any)
        .from("checkout_orders")
        .update({ status: "paid", paid_at: paidAt })
        .eq("id", order.id)
        .eq("status", "paid_needs_review")
        .select("status")
        .maybeSingle();
      if (paidOrderError) throw new Error(paidOrderError.message);
      if (!paidOrder) {
        return reviewResult(
          "O pagamento mudou durante a conferência. Atualize a tela e tente novamente.",
        );
      }
    }

    await (supabaseAdmin as any)
      .from("notifications")
      .update({ read: true })
      .eq("kind", "payment_review")
      .eq("related_checkout_order_id", order.id);

    return {
      status: "paid" as const,
      resolved: true,
      message:
        order.kind === "class_plan"
          ? "Pix confirmado e créditos liberados para o aluno."
          : "Pix confirmado e reserva reativada com segurança.",
    };
  });
