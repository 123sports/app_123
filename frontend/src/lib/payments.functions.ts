import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import QRCode from "qrcode";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hasCompleteActiveBookingHold } from "@/lib/booking-checkout-validation.server";
import { assertBookingSchedule, isValidBookingDate } from "@/lib/booking-schedule";
import { flagPaymentForReview } from "@/lib/payment-review.server";
import {
  decidePaymentTransition,
  mercadoPagoPaymentStatus,
  safeMercadoPagoPayload,
  validateMercadoPagoPaymentForOrder,
  type CheckoutOrderStatus,
} from "@/lib/payment-security";
import {
  cancelMercadoPagoPayment,
  createMercadoPagoPix,
  getMercadoPagoPayment,
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

const PAYMENT_SYNC_MIN_INTERVAL_MS = 4_000;

const createSchema = z
  .object({
    bookingDate: z.string().refine(isValidBookingDate, "Data de reserva invalida."),
    hours: z.array(z.number().int().min(6).max(22)).min(1).max(8),
    bookingType: z.enum(BOOKING_TYPES),
    professorId: z.string().uuid().nullable(),
  })
  .strict();

const cancelSchema = z
  .object({
    orderId: z.string().uuid(),
  })
  .strict();

const createPlanSchema = z
  .object({
    planId: z.string().uuid(),
  })
  .strict();

type HoldResult = {
  order_id: string;
  booking_ids: string[];
  session_ids: string[];
  amount_cents: number;
  description: string;
  expires_at: string;
  idempotency_key: string;
};

function redactSensitiveString(value: string) {
  let redacted = value.replace(
    /\b(?:APP_USR|TEST)-[A-Za-z0-9._-]+|\bsb_secret_[A-Za-z0-9._-]+/g,
    "[redacted]",
  );
  for (const secret of [
    process.env.MERCADO_PAGO_ACCESS_TOKEN,
    process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    process.env.SUPABASE_SECRET_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ]) {
    if (secret && secret.length >= 8) redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 2) return "[truncated]";
  if (typeof value === "string") return redactSensitiveString(value);
  if (value == null || ["number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value))
    return value.slice(0, 5).map((item) => sanitizeLogValue(item, depth + 1));
  if (typeof value !== "object") return String(value);

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (/token|authorization|secret|password|credential/i.test(key)) {
      sanitized[key] = "[redacted]";
    } else {
      sanitized[key] = sanitizeLogValue(nestedValue, depth + 1);
    }
  }
  return sanitized;
}

function safeMercadoPagoError(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error || "unknown_error") };
  }

  const record = error as Record<string, unknown>;
  const details: Record<string, unknown> = {};
  for (const key of ["message", "error", "status", "statusCode", "cause", "code"]) {
    if (record[key] !== undefined) details[key] = sanitizeLogValue(record[key]);
  }

  if (error instanceof Error) {
    details.message = redactSensitiveString(error.message);
    details.name = error.name;
  }

  return Object.keys(details).length > 0 ? details : { message: "unknown_error" };
}

async function releaseFailedCheckoutHold(input: {
  orderId: string;
  userId: string;
  providerPaymentId?: string | null;
  reason: string;
}) {
  if (input.providerPaymentId) {
    try {
      await cancelMercadoPagoPayment(input.providerPaymentId);
    } catch (error) {
      console.warn("[MercadoPago] Failed to cancel provider payment after checkout failure", {
        orderId: input.orderId,
        providerPaymentId: input.providerPaymentId,
        error: safeMercadoPagoError(error),
      });
    }
  }

  const { error } = await (supabaseAdmin as any).rpc("cancel_booking_checkout", {
    p_order_id: input.orderId,
    p_user_id: input.userId,
  });
  if (error) {
    console.error("[MercadoPago] Failed to release checkout hold after Pix failure", {
      orderId: input.orderId,
      reason: input.reason,
      error: error.message,
    });
  }
}

function isValidCpf(cpf: string) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (base: string, factor: number) => {
    let sum = 0;
    for (const char of base) sum += Number(char) * factor--;
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return (
    digit(cpf.slice(0, 9), 10) === Number(cpf[9]) && digit(cpf.slice(0, 10), 11) === Number(cpf[10])
  );
}

function localPaymentSimulationAllowed() {
  const baseUrl = process.env.APP_BASE_URL?.trim() ?? "";
  return (
    process.env.PAYMENT_PROVIDER === "local" &&
    process.env.ALLOW_LOCAL_PAYMENT_SIMULATION === "true" &&
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl)
  );
}

function localPixPayload(orderId: string, amountCents: number) {
  return [
    "PIX-LOCAL",
    `ORDER=${orderId}`,
    `AMOUNT=${(amountCents / 100).toFixed(2)}`,
    "RECEIVER=ON TENNIS TESTE LOCAL",
  ].join("|");
}

type ProductionPayer = { email: string; fullName?: string | null; cpf: string };

async function getProductionPayer(userId: string): Promise<ProductionPayer> {
  const [{ data: authUser }, { data: profile }] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin.from("profiles").select("full_name, cpf").eq("id", userId).maybeSingle(),
  ]);
  const email = authUser.user?.email;
  if (!email) throw new Error("A conta precisa ter um e-mail valido para pagar.");
  const cpfDigits = String((profile as any)?.cpf ?? "").replace(/\D/g, "");
  if (!isValidCpf(cpfDigits)) {
    throw new Error("Preencha um CPF valido em Perfil antes de pagar com Pix.");
  }
  return { email, fullName: profile?.full_name, cpf: cpfDigits };
}

export const createBookingPixCheckoutServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (data.bookingType === "teste" && process.env.ENABLE_TEST_BOOKING_TYPE !== "true") {
      throw new Error("O tipo de reserva de teste nao esta habilitado neste ambiente.");
    }

    const localSimulation = localPaymentSimulationAllowed();
    if (!localSimulation && !isMercadoPagoConfigured()) {
      throw new Error("Mercado Pago ainda nao foi configurado no servidor.");
    }

    const productionPayer = localSimulation ? null : await getProductionPayer(context.userId);

    const uniqueHours = [...new Set(data.hours)].sort((a, b) => a - b);
    for (const hour of uniqueHours) {
      assertBookingSchedule(data.bookingDate, hour);
    }
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
        sessionIds: hold.session_ids,
        amountCents: hold.amount_cents,
        pixCopyPaste,
        qrCodeDataUrl,
        expiresAt: hold.expires_at,
        status: "pending" as const,
        description: hold.description,
        kind: "booking" as const,
      };
    }

    let providerPayment: any;
    try {
      if (!productionPayer) throw new Error("Dados do pagador indisponiveis.");
      providerPayment = await createMercadoPagoPix({
        orderId: hold.order_id,
        idempotencyKey: hold.idempotency_key,
        amountCents: hold.amount_cents,
        description: hold.description,
        expiresAt: hold.expires_at,
        payer: {
          email: productionPayer.email,
          fullName: productionPayer.fullName,
          cpf: productionPayer.cpf,
        },
      });
    } catch (error) {
      console.error("[MercadoPago] Pix creation failed", {
        orderId: hold.order_id,
        error: safeMercadoPagoError(error),
      });
      await releaseFailedCheckoutHold({
        orderId: hold.order_id,
        userId: context.userId,
        reason: "pix_creation_failed",
      });
      throw new Error(
        "Nao foi possivel gerar o Pix agora. O horario foi liberado para nova tentativa.",
      );
    }

    const providerPaymentId = String(providerPayment.id ?? "");
    const transaction = providerPayment.point_of_interaction?.transaction_data;
    const qrCode = transaction?.qr_code ?? "";
    const qrCodeBase64 = transaction?.qr_code_base64 ?? "";
    if (!providerPaymentId || !qrCode || !qrCodeBase64) {
      await releaseFailedCheckoutHold({
        orderId: hold.order_id,
        userId: context.userId,
        providerPaymentId,
        reason: "incomplete_pix_payload",
      });
      throw new Error("O Mercado Pago nao retornou os dados completos do Pix.");
    }

    let paymentAttemptId = crypto.randomUUID();
    const initialPaymentStatus = mercadoPagoPaymentStatus(
      providerPayment.status,
      providerPayment.status_detail,
    );
    const paymentValidation = validateMercadoPagoPaymentForOrder(providerPayment, {
      id: hold.order_id,
      amount_cents: hold.amount_cents,
      currency: "BRL",
    });
    const { error: attemptError } = await (supabaseAdmin as any).from("payment_attempts").insert({
      id: paymentAttemptId,
      checkout_order_id: hold.order_id,
      provider: "mercado_pago",
      provider_order_id: null,
      provider_payment_id: providerPaymentId,
      payment_method: "pix",
      status: initialPaymentStatus,
      amount_cents: hold.amount_cents,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64,
      ticket_url: transaction?.ticket_url ?? null,
      expires_at: providerPayment.date_of_expiration ?? hold.expires_at,
      paid_at: providerPayment.date_approved ?? null,
      provider_payload: safeMercadoPagoPayload(providerPayment),
    });

    if (attemptError) {
      const { data: concurrentAttempt } = await (supabaseAdmin as any)
        .from("payment_attempts")
        .select("id, checkout_order_id, status")
        .eq("provider", "mercado_pago")
        .eq("provider_payment_id", providerPaymentId)
        .maybeSingle();
      if (concurrentAttempt?.checkout_order_id === hold.order_id) {
        paymentAttemptId = concurrentAttempt.id;
        if (
          paymentValidation.valid &&
          initialPaymentStatus === "paid" &&
          concurrentAttempt.status !== "paid"
        ) {
          const { data: reconciledAttempt, error: reconcileAttemptError } = await (
            supabaseAdmin as any
          )
            .from("payment_attempts")
            .update({
              status: "paid",
              paid_at: providerPayment.date_approved ?? new Date().toISOString(),
              provider_payload: safeMercadoPagoPayload(providerPayment),
            })
            .eq("id", concurrentAttempt.id)
            .eq("checkout_order_id", hold.order_id)
            .in("status", ["pending", "expired", "cancelled", "failed", "paid_needs_review"])
            .select("id")
            .maybeSingle();
          if (reconcileAttemptError || !reconciledAttempt) {
            await flagPaymentForReview(
              hold.order_id,
              "Pagamento aprovado, mas a tentativa concorrente nao pode ser conciliada.",
            );
            throw new Error(
              "Pagamento aprovado e em conciliacao. Nao faca outro pagamento; aguarde a confirmacao da reserva.",
            );
          }
        }
      } else {
        console.error("[MercadoPago] Failed to persist payment attempt", {
          orderId: hold.order_id,
          providerPaymentId,
          error: attemptError.message,
        });
        await releaseFailedCheckoutHold({
          orderId: hold.order_id,
          userId: context.userId,
          providerPaymentId,
          reason: "payment_attempt_persist_failed",
        });
        throw new Error("Pix criado, mas a confirmacao local falhou. O horario foi liberado.");
      }
    }

    if (!paymentValidation.valid) {
      const reason = "Divergencia de valor, moeda, metodo ou referencia externa.";
      console.error("[MercadoPago] Created Pix failed reconciliation", {
        orderId: hold.order_id,
        providerPaymentId,
        validationErrors: paymentValidation.errors,
      });
      if (initialPaymentStatus === "paid" || initialPaymentStatus === "paid_needs_review") {
        await flagPaymentForReview(hold.order_id, reason);
        throw new Error("Pagamento recebido e em analise. Aguarde a confirmacao da reserva.");
      }
      await releaseFailedCheckoutHold({
        orderId: hold.order_id,
        userId: context.userId,
        providerPaymentId,
        reason: "created_payment_reconciliation_failed",
      });
      throw new Error("O Pix retornou dados inconsistentes e foi cancelado com seguranca.");
    }

    if (initialPaymentStatus === "paid_needs_review") {
      await flagPaymentForReview(
        hold.order_id,
        "Pagamento criado com status que exige conferencia manual.",
      );
      throw new Error("Pagamento recebido e em analise. Nao faca outro pagamento.");
    }

    if (
      initialPaymentStatus === "cancelled" ||
      initialPaymentStatus === "failed" ||
      initialPaymentStatus === "expired" ||
      initialPaymentStatus === "refunded"
    ) {
      const terminalPatch =
        initialPaymentStatus === "refunded"
          ? { status: "refunded", refunded_at: new Date().toISOString() }
          : initialPaymentStatus === "cancelled"
            ? { status: "cancelled", cancelled_at: new Date().toISOString() }
            : { status: initialPaymentStatus };
      const { error: terminalError } = await (supabaseAdmin as any)
        .from("checkout_orders")
        .update(terminalPatch)
        .eq("id", hold.order_id)
        .eq("status", "pending");
      if (terminalError) {
        await releaseFailedCheckoutHold({
          orderId: hold.order_id,
          userId: context.userId,
          providerPaymentId,
          reason: "initial_terminal_status_persist_failed",
        });
      }
      throw new Error("O Pix nao ficou disponivel. O horario foi liberado para nova tentativa.");
    }

    if (initialPaymentStatus === "paid") {
      const { data: paidOrder, error: paidOrderError } = await (supabaseAdmin as any)
        .from("checkout_orders")
        .update({
          status: "paid",
          paid_at: providerPayment.date_approved ?? new Date().toISOString(),
        })
        .eq("id", hold.order_id)
        .eq("status", "pending")
        .select("status")
        .maybeSingle();
      if (paidOrderError || !paidOrder) {
        const { data: persistedOrder, error: persistedOrderError } = await (supabaseAdmin as any)
          .from("checkout_orders")
          .select("status")
          .eq("id", hold.order_id)
          .maybeSingle();
        if (!persistedOrderError && persistedOrder?.status === "paid") {
          // A concurrent webhook completed the same idempotent transition.
        } else {
          const reconciliationError =
            paidOrderError?.message ??
            persistedOrderError?.message ??
            `Estado atual: ${persistedOrder?.status ?? "desconhecido"}`;
          console.error("[MercadoPago] Immediate approval requires reconciliation", {
            orderId: hold.order_id,
            providerPaymentId,
            error: reconciliationError,
          });
          await flagPaymentForReview(
            hold.order_id,
            "Pagamento aprovado, mas a confirmacao atomica da reserva falhou.",
          );
          throw new Error(
            "Pagamento aprovado e em conciliacao. Nao faca outro pagamento; aguarde a confirmacao da reserva.",
          );
        }
      }
    }

    return {
      orderId: hold.order_id,
      paymentId: paymentAttemptId,
      bookingIds: hold.booking_ids,
      sessionIds: hold.session_ids,
      amountCents: hold.amount_cents,
      pixCopyPaste: qrCode,
      qrCodeDataUrl: `data:image/png;base64,${qrCodeBase64}`,
      expiresAt: providerPayment.date_of_expiration ?? hold.expires_at,
      status: initialPaymentStatus === "paid" ? ("paid" as const) : ("pending" as const),
      description: hold.description,
      kind: "booking" as const,
    };
  });

export const createClassPlanPixCheckoutServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createPlanSchema.parse(data))
  .handler(async ({ data, context }) => {
    const localSimulation = localPaymentSimulationAllowed();
    if (!localSimulation && !isMercadoPagoConfigured()) {
      throw new Error("Mercado Pago ainda nao foi configurado no servidor.");
    }
    const productionPayer = localSimulation ? null : await getProductionPayer(context.userId);

    const { data: holdData, error: holdError } = await (supabaseAdmin as any).rpc(
      "create_class_plan_checkout",
      { p_user_id: context.userId, p_plan_id: data.planId },
    );
    if (holdError || !holdData) {
      throw new Error(holdError?.message ?? "Nao foi possivel iniciar a compra do plano.");
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
          provider_payload: { simulated: true, kind: "class_plan" },
        });
      if (localAttemptError) throw new Error(localAttemptError.message);
      return {
        orderId: hold.order_id,
        paymentId: paymentAttemptId,
        bookingIds: [],
        sessionIds: [],
        amountCents: hold.amount_cents,
        pixCopyPaste,
        qrCodeDataUrl,
        expiresAt: hold.expires_at,
        status: "pending" as const,
        description: hold.description,
        kind: "class_plan" as const,
      };
    }

    let providerPayment: any;
    try {
      if (!productionPayer) throw new Error("Dados do pagador indisponiveis.");
      providerPayment = await createMercadoPagoPix({
        orderId: hold.order_id,
        idempotencyKey: hold.idempotency_key,
        amountCents: hold.amount_cents,
        description: hold.description,
        expiresAt: hold.expires_at,
        payer: productionPayer,
      });
    } catch (error) {
      console.error("[MercadoPago] Plan Pix creation failed", {
        orderId: hold.order_id,
        error: safeMercadoPagoError(error),
      });
      await releaseFailedCheckoutHold({
        orderId: hold.order_id,
        userId: context.userId,
        reason: "plan_pix_creation_failed",
      });
      throw new Error("Nao foi possivel gerar o Pix do plano agora. Tente novamente.");
    }

    const providerPaymentId = String(providerPayment.id ?? "");
    const transaction = providerPayment.point_of_interaction?.transaction_data;
    const qrCode = transaction?.qr_code ?? "";
    const qrCodeBase64 = transaction?.qr_code_base64 ?? "";
    if (!providerPaymentId || !qrCode || !qrCodeBase64) {
      await releaseFailedCheckoutHold({
        orderId: hold.order_id,
        userId: context.userId,
        providerPaymentId,
        reason: "incomplete_plan_pix_payload",
      });
      throw new Error("O Mercado Pago nao retornou os dados completos do Pix.");
    }

    let paymentAttemptId = crypto.randomUUID();
    const initialPaymentStatus = mercadoPagoPaymentStatus(
      providerPayment.status,
      providerPayment.status_detail,
    );
    const paymentValidation = validateMercadoPagoPaymentForOrder(providerPayment, {
      id: hold.order_id,
      amount_cents: hold.amount_cents,
      currency: "BRL",
    });
    const { error: attemptError } = await (supabaseAdmin as any).from("payment_attempts").insert({
      id: paymentAttemptId,
      checkout_order_id: hold.order_id,
      provider: "mercado_pago",
      provider_order_id: null,
      provider_payment_id: providerPaymentId,
      payment_method: "pix",
      status: initialPaymentStatus,
      amount_cents: hold.amount_cents,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64,
      ticket_url: transaction?.ticket_url ?? null,
      expires_at: providerPayment.date_of_expiration ?? hold.expires_at,
      paid_at: providerPayment.date_approved ?? null,
      provider_payload: safeMercadoPagoPayload(providerPayment),
    });
    if (attemptError) {
      const { data: concurrentAttempt } = await (supabaseAdmin as any)
        .from("payment_attempts")
        .select("id, checkout_order_id, status")
        .eq("provider", "mercado_pago")
        .eq("provider_payment_id", providerPaymentId)
        .maybeSingle();
      if (concurrentAttempt?.checkout_order_id === hold.order_id) {
        paymentAttemptId = concurrentAttempt.id;
        if (
          paymentValidation.valid &&
          initialPaymentStatus === "paid" &&
          concurrentAttempt.status !== "paid"
        ) {
          const { data: reconciledAttempt, error: reconcileAttemptError } = await (
            supabaseAdmin as any
          )
            .from("payment_attempts")
            .update({
              status: "paid",
              paid_at: providerPayment.date_approved ?? new Date().toISOString(),
              provider_payload: safeMercadoPagoPayload(providerPayment),
            })
            .eq("id", concurrentAttempt.id)
            .eq("checkout_order_id", hold.order_id)
            .in("status", ["pending", "expired", "cancelled", "failed", "paid_needs_review"])
            .select("id")
            .maybeSingle();
          if (reconcileAttemptError || !reconciledAttempt) {
            await flagPaymentForReview(
              hold.order_id,
              "Pagamento de plano aprovado, mas a tentativa concorrente nao pode ser conciliada.",
            );
            throw new Error("Pagamento aprovado e em conciliacao. Nao faca outro pagamento.");
          }
        }
      } else {
        console.error("[MercadoPago] Failed to persist plan payment attempt", {
          orderId: hold.order_id,
          providerPaymentId,
          error: attemptError.message,
        });
        await releaseFailedCheckoutHold({
          orderId: hold.order_id,
          userId: context.userId,
          providerPaymentId,
          reason: "plan_payment_attempt_persist_failed",
        });
        throw new Error("Pix criado, mas a confirmacao local falhou. Tente novamente.");
      }
    }

    if (!paymentValidation.valid) {
      const reason = "Divergencia de valor, moeda, metodo ou referencia externa.";
      if (initialPaymentStatus === "paid" || initialPaymentStatus === "paid_needs_review") {
        await flagPaymentForReview(hold.order_id, reason);
        throw new Error("Pagamento recebido e em analise. Nao faca outro pagamento.");
      }
      await releaseFailedCheckoutHold({
        orderId: hold.order_id,
        userId: context.userId,
        providerPaymentId,
        reason: "plan_payment_reconciliation_failed",
      });
      throw new Error("O Pix retornou dados inconsistentes e foi cancelado com seguranca.");
    }

    if (initialPaymentStatus === "paid_needs_review") {
      await flagPaymentForReview(
        hold.order_id,
        "Pagamento de plano criado com status que exige conferencia manual.",
      );
      throw new Error("Pagamento recebido e em analise. Nao faca outro pagamento.");
    }

    if (["cancelled", "failed", "expired", "refunded"].includes(initialPaymentStatus)) {
      const terminalPatch =
        initialPaymentStatus === "refunded"
          ? { status: "refunded", refunded_at: new Date().toISOString() }
          : initialPaymentStatus === "cancelled"
            ? { status: "cancelled", cancelled_at: new Date().toISOString() }
            : { status: initialPaymentStatus };
      await (supabaseAdmin as any)
        .from("checkout_orders")
        .update(terminalPatch)
        .eq("id", hold.order_id)
        .eq("status", "pending");
      throw new Error("O Pix nao ficou disponivel. Gere uma nova cobranca.");
    }

    if (initialPaymentStatus === "paid") {
      const { data: paidOrder, error: paidOrderError } = await (supabaseAdmin as any)
        .from("checkout_orders")
        .update({
          status: "paid",
          paid_at: providerPayment.date_approved ?? new Date().toISOString(),
        })
        .eq("id", hold.order_id)
        .eq("status", "pending")
        .select("status")
        .maybeSingle();
      if (paidOrderError || !paidOrder) {
        const { data: persistedOrder } = await (supabaseAdmin as any)
          .from("checkout_orders")
          .select("status")
          .eq("id", hold.order_id)
          .maybeSingle();
        if (persistedOrder?.status !== "paid") {
          await flagPaymentForReview(
            hold.order_id,
            "Pagamento aprovado, mas a liberacao atomica dos creditos falhou.",
          );
          throw new Error("Pagamento aprovado e em conciliacao. Nao faca outro pagamento.");
        }
      }
    }

    return {
      orderId: hold.order_id,
      paymentId: paymentAttemptId,
      bookingIds: [],
      sessionIds: [],
      amountCents: hold.amount_cents,
      pixCopyPaste: qrCode,
      qrCodeDataUrl: `data:image/png;base64,${qrCodeBase64}`,
      expiresAt: providerPayment.date_of_expiration ?? hold.expires_at,
      status: initialPaymentStatus === "paid" ? ("paid" as const) : ("pending" as const),
      description: hold.description,
      kind: "class_plan" as const,
    };
  });

export const syncBookingPixCheckoutServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => cancelSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (localPaymentSimulationAllowed()) return { status: "local" as const };
    if (!isMercadoPagoConfigured()) {
      throw new Error("Mercado Pago ainda nao foi configurado no servidor.");
    }

    const { data: order, error: orderError } = await (supabaseAdmin as any)
      .from("checkout_orders")
      .select("id, user_id, kind, amount_cents, currency, status, expires_at")
      .eq("id", data.orderId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order || order.user_id !== context.userId) {
      throw new Error("Cobranca nao encontrada.");
    }
    if (
      order.status === "paid" ||
      order.status === "paid_needs_review" ||
      order.status === "refunded"
    ) {
      return { status: order.status as string };
    }

    const { data: attempt, error: attemptError } = await (supabaseAdmin as any)
      .from("payment_attempts")
      .select("id, checkout_order_id, provider, provider_payment_id, updated_at")
      .eq("checkout_order_id", order.id)
      .eq("provider", "mercado_pago")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (attemptError) throw new Error(attemptError.message);
    if (!attempt?.provider_payment_id) return { status: order.status as string };

    const syncCutoff = new Date(Date.now() - PAYMENT_SYNC_MIN_INTERVAL_MS).toISOString();
    const { data: syncClaim, error: syncClaimError } = await (supabaseAdmin as any)
      .from("payment_attempts")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", attempt.id)
      .eq("checkout_order_id", order.id)
      .lt("updated_at", syncCutoff)
      .select("id")
      .maybeSingle();
    if (syncClaimError) throw new Error(syncClaimError.message);
    if (!syncClaim) return { status: order.status as string };

    const payment = await getMercadoPagoPayment(attempt.provider_payment_id);
    const mappedStatus = mercadoPagoPaymentStatus(payment.status, payment.status_detail);
    const paymentValidation = validateMercadoPagoPaymentForOrder(payment, order);

    const { error: updateAttemptError } = await (supabaseAdmin as any)
      .from("payment_attempts")
      .update({
        status: mappedStatus,
        paid_at:
          mappedStatus === "paid" ? (payment.date_approved ?? new Date().toISOString()) : null,
        provider_payload: safeMercadoPagoPayload(payment),
      })
      .eq("id", attempt.id);
    if (updateAttemptError) throw new Error(updateAttemptError.message);

    let processingError: string | null = null;
    if (!paymentValidation.valid) {
      processingError = "Divergencia de valor, moeda, metodo ou referencia externa.";
    } else if (
      mappedStatus === "paid" &&
      order.status === "pending" &&
      order.kind === "booking" &&
      !(await hasCompleteActiveBookingHold(order))
    ) {
      processingError = "Pagamento aprovado sem todas as reservas ativas; conferir manualmente.";
    }

    const decision = decidePaymentTransition(order.status as CheckoutOrderStatus, mappedStatus);
    processingError ??= decision.reviewReason;

    if (processingError) {
      const reviewStatus = await flagPaymentForReview(order.id, processingError);
      return { status: reviewStatus };
    }

    if (decision.nextOrderStatus === "paid") {
      const { error: updateOrderError } = await (supabaseAdmin as any)
        .from("checkout_orders")
        .update({ status: "paid", paid_at: payment.date_approved ?? new Date().toISOString() })
        .eq("id", order.id)
        .eq("status", "pending");
      if (updateOrderError) throw new Error(updateOrderError.message);
    } else if (decision.nextOrderStatus) {
      const orderPatch =
        decision.nextOrderStatus === "refunded"
          ? { status: "refunded", refunded_at: new Date().toISOString() }
          : decision.nextOrderStatus === "cancelled"
            ? { status: "cancelled", cancelled_at: new Date().toISOString() }
            : { status: decision.nextOrderStatus };
      const { error: updateOrderError } = await (supabaseAdmin as any)
        .from("checkout_orders")
        .update(orderPatch)
        .eq("id", order.id)
        .eq("status", order.status);
      if (updateOrderError) throw new Error(updateOrderError.message);
    }

    return { status: mappedStatus };
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

    const { error: approvalError } = await (supabaseAdmin as any).rpc("approve_local_checkout", {
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
      attempt?.provider_payment_id &&
      attempt.status === "pending" &&
      !attempt.provider_payment_id.startsWith("LOCAL-PAY-")
    ) {
      await cancelMercadoPagoPayment(attempt.provider_payment_id);
    }

    const { error: cancelError } = await (supabaseAdmin as any).rpc("cancel_booking_checkout", {
      p_order_id: data.orderId,
      p_user_id: context.userId,
    });
    if (cancelError) throw new Error(cancelError.message);

    return { ok: true };
  });
