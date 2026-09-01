import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hasCompleteActiveBookingHold } from "@/lib/booking-checkout-validation.server";
import {
  getMercadoPagoPayment,
  InvalidWebhookSignatureError,
  validateMercadoPagoWebhook,
} from "@/lib/mercado-pago.server";
import { flagPaymentForReview } from "@/lib/payment-review.server";
import {
  decidePaymentTransition,
  mercadoPagoPaymentStatus,
  safeMercadoPagoPayload,
  validateMercadoPagoPaymentForOrder,
  type CheckoutOrderStatus,
  type ReconciledPaymentStatus,
} from "@/lib/payment-security";

type WebhookBody = {
  action?: string;
  type?: string;
  data?: { id?: string | number };
};

const MAX_WEBHOOK_BYTES = 65_536;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signatureAgeSeconds(signature: string | null) {
  const timestamp = signature
    ?.split(",")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === "ts")?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp)) return null;
  return Math.round(Date.now() / 1000) - Number(timestamp);
}

async function readLimitedBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      throw new RangeError("Payload too large");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function orderPatch(status: CheckoutOrderStatus, paidAt?: string | null) {
  switch (status) {
    case "paid":
      return { status, paid_at: paidAt ?? new Date().toISOString() };
    case "refunded":
      return { status, refunded_at: new Date().toISOString() };
    case "cancelled":
      return { status, cancelled_at: new Date().toISOString() };
    default:
      return { status };
  }
}

async function applyVerifiedOrderTransition(input: {
  orderId: string;
  observedStatus: CheckoutOrderStatus;
  paymentStatus: ReconciledPaymentStatus;
  paidAt?: string | null;
}) {
  let currentStatus = input.observedStatus;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const decision = decidePaymentTransition(currentStatus, input.paymentStatus);
    if (decision.reviewReason || !decision.nextOrderStatus) return decision.reviewReason;

    const { data: updated, error: updateError } = await (supabaseAdmin as any)
      .from("checkout_orders")
      .update(orderPatch(decision.nextOrderStatus, input.paidAt))
      .eq("id", input.orderId)
      .eq("status", currentStatus)
      .select("status")
      .maybeSingle();
    if (updateError) throw updateError;
    if (updated) return null;

    const { data: current, error: currentError } = await (supabaseAdmin as any)
      .from("checkout_orders")
      .select("status")
      .eq("id", input.orderId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return "Pedido deixou de existir durante a conciliacao.";
    currentStatus = current.status as CheckoutOrderStatus;
  }

  throw new Error("Concurrent payment reconciliation did not converge.");
}

export async function handleMercadoPagoWebhook(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_WEBHOOK_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  const url = new URL(request.url);
  let body: WebhookBody;
  try {
    body = JSON.parse(await readLimitedBody(request)) as WebhookBody;
  } catch (error) {
    if (error instanceof RangeError) {
      return new Response("Payload too large", { status: 413 });
    }
    return new Response("Invalid JSON", { status: 400 });
  }

  const dataId = String(
    url.searchParams.get("data.id") ?? url.searchParams.get("data_id") ?? body.data?.id ?? "",
  ).trim();
  const requestId = request.headers.get("x-request-id")?.trim() ?? null;

  if (
    !requestId ||
    requestId.length > 200 ||
    !dataId ||
    dataId.length > 32 ||
    !/^\d+$/.test(dataId)
  ) {
    return new Response("Invalid webhook identifiers", { status: 400 });
  }

  try {
    validateMercadoPagoWebhook({
      signature: request.headers.get("x-signature"),
      requestId,
      dataId,
    });
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      console.warn("[MercadoPago] Rejected webhook signature", {
        requestId,
        dataId: dataId || null,
        eventType: body.type ?? body.action ?? null,
        signatureAgeSeconds: signatureAgeSeconds(request.headers.get("x-signature")),
        reason: error.reason,
      });
      return new Response("Invalid signature", { status: 401 });
    }
    throw error;
  }

  if (body.type && body.type !== "payment") {
    return new Response(null, { status: 200 });
  }

  const { data: existingEvent } = await (supabaseAdmin as any)
    .from("payment_events")
    .select("id, processed_at")
    .eq("provider", "mercado_pago")
    .eq("provider_event_id", requestId)
    .maybeSingle();
  if (existingEvent?.processed_at) {
    return new Response(null, { status: 200 });
  }

  const payment = await getMercadoPagoPayment(dataId);
  const providerPaymentId = String(payment.id ?? dataId);
  const externalReference = String(payment.external_reference ?? "");
  const orderId = externalReference || String(payment.metadata?.checkout_order_id ?? "");

  const { data: event, error: eventError } = await (supabaseAdmin as any)
    .from("payment_events")
    .upsert(
      {
        provider: "mercado_pago",
        provider_event_id: requestId,
        event_type: body.action ?? "payment.updated",
        signature_valid: true,
        payload: body,
      },
      {
        onConflict: "provider,provider_event_id",
      },
    )
    .select("id")
    .single();
  if (eventError) throw eventError;

  if (!UUID_PATTERN.test(orderId)) {
    await (supabaseAdmin as any)
      .from("payment_events")
      .update({
        processed_at: new Date().toISOString(),
        processing_error: "Pagamento sem referencia local valida.",
      })
      .eq("id", event.id);
    console.warn("[MercadoPago] Verified payment has no valid local order reference", {
      requestId,
      providerPaymentId,
    });
    return new Response(null, { status: 200 });
  }

  const { data: order, error: orderError } = await (supabaseAdmin as any)
    .from("checkout_orders")
    .select("id, kind, amount_cents, currency, status, expires_at")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) {
    await (supabaseAdmin as any)
      .from("payment_events")
      .update({
        processed_at: new Date().toISOString(),
        processing_error: "Pedido local nao encontrado.",
      })
      .eq("id", event.id);
    console.warn("[MercadoPago] Verified payment references an unknown order", {
      requestId,
      providerPaymentId,
      orderId,
    });
    return new Response(null, { status: 200 });
  }

  const mappedStatus = mercadoPagoPaymentStatus(payment.status, payment.status_detail);
  const paymentValidation = validateMercadoPagoPaymentForOrder(payment, order);

  let { data: attempt } = await (supabaseAdmin as any)
    .from("payment_attempts")
    .select("id, checkout_order_id")
    .eq("provider", "mercado_pago")
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle();

  if (!attempt) {
    const transaction = payment.point_of_interaction?.transaction_data;
    const { data: inserted, error: insertError } = await (supabaseAdmin as any)
      .from("payment_attempts")
      .insert({
        checkout_order_id: order.id,
        provider: "mercado_pago",
        provider_payment_id: providerPaymentId,
        payment_method: "pix",
        status: mappedStatus,
        amount_cents: order.amount_cents,
        qr_code: transaction?.qr_code ?? null,
        qr_code_base64: transaction?.qr_code_base64 ?? null,
        ticket_url: transaction?.ticket_url ?? null,
        expires_at: payment.date_of_expiration ?? order.expires_at,
        paid_at: payment.date_approved ?? null,
        provider_payload: safeMercadoPagoPayload(payment),
      })
      .select("id, checkout_order_id")
      .single();
    if (insertError) throw insertError;
    attempt = inserted;
  } else if (attempt.checkout_order_id === order.id) {
    const { error: updateAttemptError } = await (supabaseAdmin as any)
      .from("payment_attempts")
      .update({
        status: mappedStatus,
        paid_at:
          mappedStatus === "paid" ? (payment.date_approved ?? new Date().toISOString()) : null,
        provider_payload: safeMercadoPagoPayload(payment),
      })
      .eq("id", attempt.id);
    if (updateAttemptError) throw updateAttemptError;
  }

  let processingError: string | null = null;
  if (attempt.checkout_order_id !== order.id) {
    processingError = "Pagamento ja vinculado a outro pedido local.";
    await flagPaymentForReview(attempt.checkout_order_id, processingError);
  } else if (!paymentValidation.valid) {
    processingError = "Divergencia de valor, moeda, metodo ou referencia externa.";
  } else if (
    mappedStatus === "paid" &&
    order.status === "pending" &&
    !(await hasCompleteActiveBookingHold(order))
  ) {
    processingError = "Pagamento aprovado sem todas as reservas ativas; conferir manualmente.";
  }

  if (!processingError) {
    processingError = await applyVerifiedOrderTransition({
      orderId: order.id,
      observedStatus: order.status as CheckoutOrderStatus,
      paymentStatus: mappedStatus,
      paidAt: payment.date_approved,
    });
  }

  if (processingError) {
    await flagPaymentForReview(order.id, processingError);
  }

  await (supabaseAdmin as any)
    .from("payment_events")
    .update({
      payment_attempt_id: attempt.id,
      processed_at: new Date().toISOString(),
      processing_error: processingError,
    })
    .eq("id", event.id);

  return new Response(null, { status: 200 });
}
