import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import QRCode from "qrcode";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  cancelMercadoPagoPayment,
  createMercadoPagoPix,
  isMercadoPagoConfigured,
} from "@/lib/mercado-pago.server";

const BOOKING_TYPES = [
  "quadra_livre",
  "aula_individual",
  "aula_dupla",
  "aula_trio",
  "aula_quarteto",
  "teste",
] as const;

const createSchema = z.object({
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.array(z.number().int().min(6).max(22)).min(1).max(8),
  bookingType: z.enum(BOOKING_TYPES),
  professorId: z.string().uuid().nullable(),
}).strict();

const cancelSchema = z.object({
  orderId: z.string().uuid(),
}).strict();

type HoldResult = {
  order_id: string;
  booking_ids: string[];
  amount_cents: number;
  description: string;
  expires_at: string;
  idempotency_key: string;
};

function localPaymentSimulationAllowed() {
  const baseUrl = process.env.APP_BASE_URL?.trim() ?? "";
  return process.env.PAYMENT_PROVIDER === "local"
    && process.env.ALLOW_LOCAL_PAYMENT_SIMULATION === "true"
    && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl);
}

function localPixPayload(orderId: string, amountCents: number) {
  return [
    "PIX-LOCAL",
    `ORDER=${orderId}`,
    `AMOUNT=${(amountCents / 100).toFixed(2)}`,
    "RECEIVER=ON TENNIS TESTE LOCAL",
  ].join("|");
}

export const createBookingPixCheckoutServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const localSimulation = localPaymentSimulationAllowed();
    if (!localSimulation && !isMercadoPagoConfigured()) {
      throw new Error("Mercado Pago ainda nao foi configurado no servidor.");
    }

    const uniqueHours = [...new Set(data.hours)].sort((a, b) => a - b);
    const { data: holdData, error: holdError } = await (supabaseAdmin as any).rpc(
      "create_booking_checkout_hold",
      {
        p_user_id: context.userId,
        p_booking_date: data.bookingDate,
        p_hours: uniqueHours,
        p_booking_type: data.bookingType,
        p_professor_id: data.professorId,
      },
    );

    if (holdError || !holdData) {
      throw new Error(holdError?.message ?? "Nao foi possivel reservar os horarios.");
    }

    const hold = holdData as HoldResult;
    if (localSimulation) {
      const paymentAttemptId = crypto.randomUUID();
      const pixCopyPaste = localPixPayload(hold.order_id, hold.amount_cents);
      const qrCodeDataUrl = await QRCode.toDataURL(pixCopyPaste, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 320,
      });
      const { error: localOrderError } = await (supabaseAdmin as any)
        .from("checkout_orders")
        .update({ provider: "local" })
        .eq("id", hold.order_id);
      if (localOrderError) throw new Error(localOrderError.message);
      const { error: localAttemptError } = await (supabaseAdmin as any)
        .from("payment_attempts")
        .insert({
          id: paymentAttemptId,
          checkout_order_id: hold.order_id,
          provider: "local",
          provider_order_id: `LOCAL-${hold.order_id}`,
          provider_payment_id: `LOCAL-PAY-${paymentAttemptId}`,
          payment_method: "pix",
          status: "pending",
          amount_cents: hold.amount_cents,
          qr_code: pixCopyPaste,
          qr_code_base64: qrCodeDataUrl,
          expires_at: hold.expires_at,
          provider_payload: { simulated: true },
        });
      if (localAttemptError) throw new Error(localAttemptError.message);

      return {
        orderId: hold.order_id,
        paymentId: paymentAttemptId,
        bookingIds: hold.booking_ids,
        amountCents: hold.amount_cents,
        pixCopyPaste,
        qrCodeDataUrl,
        expiresAt: hold.expires_at,
        status: "pending" as const,
        description: hold.description,
      };
    }

    const [{ data: authUser }, { data: profile }] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(context.userId),
      supabaseAdmin
        .from("profiles")
        .select("full_name, cpf")
        .eq("id", context.userId)
        .maybeSingle(),
    ]);
    const email = authUser.user?.email;
    if (!email) throw new Error("A conta precisa ter um e-mail valido para pagar.");

    let providerPayment: any;
    try {
      providerPayment = await createMercadoPagoPix({
        orderId: hold.order_id,
        idempotencyKey: hold.idempotency_key,
        amountCents: hold.amount_cents,
        description: hold.description,
        expiresAt: hold.expires_at,
        payer: {
          email,
          fullName: profile?.full_name,
          cpf: (profile as any)?.cpf,
        },
      });
    } catch (error) {
      console.error("[MercadoPago] Pix creation failed", {
        orderId: hold.order_id,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      throw new Error(
        "Nao foi possivel gerar o Pix agora. A reserva temporaria expirara automaticamente.",
      );
    }

    const providerPaymentId = String(providerPayment.id ?? "");
    const transaction = providerPayment.point_of_interaction?.transaction_data;
    const qrCode = transaction?.qr_code ?? "";
    const qrCodeBase64 = transaction?.qr_code_base64 ?? "";
    if (!providerPaymentId || !qrCode || !qrCodeBase64) {
      throw new Error("O Mercado Pago nao retornou os dados completos do Pix.");
    }

    const paymentAttemptId = crypto.randomUUID();
    const { error: attemptError } = await (supabaseAdmin as any)
      .from("payment_attempts")
      .insert({
        id: paymentAttemptId,
        checkout_order_id: hold.order_id,
        provider: "mercado_pago",
        provider_order_id: null,
        provider_payment_id: providerPaymentId,
        payment_method: "pix",
        status: providerPayment.status === "approved" ? "paid" : "pending",
        amount_cents: hold.amount_cents,
        qr_code: qrCode,
        qr_code_base64: qrCodeBase64,
        ticket_url: transaction?.ticket_url ?? null,
        expires_at: providerPayment.date_of_expiration ?? hold.expires_at,
        paid_at: providerPayment.date_approved ?? null,
        provider_payload: providerPayment,
      });

    if (attemptError) {
      console.error("[MercadoPago] Failed to persist payment attempt", {
        orderId: hold.order_id,
        providerPaymentId,
        error: attemptError.message,
      });
      throw new Error("Pix criado, mas a confirmacao local falhou. Aguarde a conciliacao.");
    }

    if (providerPayment.status === "approved") {
      const { error: paidOrderError } = await (supabaseAdmin as any)
        .from("checkout_orders")
        .update({ status: "paid", paid_at: providerPayment.date_approved ?? new Date().toISOString() })
        .eq("id", hold.order_id)
        .eq("status", "pending");
      if (paidOrderError) {
        console.error("[MercadoPago] Immediate approval requires reconciliation", {
          orderId: hold.order_id,
          providerPaymentId,
          error: paidOrderError.message,
        });
        throw new Error("Pagamento aprovado e em conciliacao. Aguarde a confirmacao da reserva.");
      }
    }

    return {
      orderId: hold.order_id,
      paymentId: paymentAttemptId,
      bookingIds: hold.booking_ids,
      amountCents: hold.amount_cents,
      pixCopyPaste: qrCode,
      qrCodeDataUrl: `data:image/png;base64,${qrCodeBase64}`,
      expiresAt: providerPayment.date_of_expiration ?? hold.expires_at,
      status: providerPayment.status === "approved" ? "paid" as const : "pending" as const,
      description: hold.description,
    };
  });

export const approveLocalPixCheckoutServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => cancelSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (!localPaymentSimulationAllowed()) {
      throw new Error("A simulacao de pagamento nao esta habilitada.");
    }

    const { data: order } = await (supabaseAdmin as any)
      .from("checkout_orders")
      .select("id, user_id, status, amount_cents, description, expires_at, metadata")
      .eq("id", data.orderId)
      .eq("provider", "local")
      .maybeSingle();
    if (!order || order.user_id !== context.userId) {
      throw new Error("Cobranca nao encontrada.");
    }
    if (order.status === "paid") return { status: "paid" as const };
    if (order.status !== "pending" || new Date(order.expires_at).getTime() <= Date.now()) {
      throw new Error("Esta cobranca nao esta mais disponivel.");
    }

    const { error: approvalError } = await (supabaseAdmin as any)
      .rpc("approve_local_booking_checkout", {
        p_order_id: order.id,
        p_user_id: context.userId,
      });
    if (approvalError) throw new Error(approvalError.message);

    return { status: "paid" as const };
  });

export const cancelBookingPixCheckoutServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => cancelSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: order } = await (supabaseAdmin as any)
      .from("checkout_orders")
      .select("id, user_id, status")
      .eq("id", data.orderId)
      .maybeSingle();

    if (!order || order.user_id !== context.userId) {
      throw new Error("Cobranca nao encontrada.");
    }
    if (order.status === "paid") {
      throw new Error("Uma reserva paga exige estorno pelo administrador.");
    }
    if (order.status !== "pending") return { ok: true };

    const { data: attempt } = await (supabaseAdmin as any)
      .from("payment_attempts")
      .select("id, provider_payment_id, status")
      .eq("checkout_order_id", data.orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      attempt?.provider_payment_id
      && attempt.status === "pending"
      && !attempt.provider_payment_id.startsWith("LOCAL-PAY-")
    ) {
      await cancelMercadoPagoPayment(attempt.provider_payment_id);
    }

    const { error: cancelError } = await (supabaseAdmin as any)
      .rpc("cancel_booking_checkout", {
        p_order_id: data.orderId,
        p_user_id: context.userId,
      });
    if (cancelError) throw new Error(cancelError.message);

    return { ok: true };
  });
