import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getMercadoPagoPayment,
  InvalidWebhookSignatureError,
  validateMercadoPagoWebhook,
} from "@/lib/mercado-pago.server";

type WebhookBody = {
  action?: string;
  type?: string;
  data?: { id?: string | number };
};

const MAX_WEBHOOK_BYTES = 65_536;

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

function paymentStatus(status?: string) {
  switch (status) {
    case "approved":
      return "paid";
    case "cancelled":
      return "cancelled";
    case "rejected":
      return "failed";
    case "refunded":
    case "charged_back":
      return "refunded";
    default:
      return "pending";
  }
}

function cents(value?: number) {
  return Math.round(Number(value ?? 0) * 100);
}

async function notifyPaymentReview(orderId: string, reason: string) {
  const { data: admins } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");

  if (!admins?.length) return;
  await (supabaseAdmin as any).from("notifications").insert(
    admins.map((admin: { user_id: string }) => ({
      user_id: admin.user_id,
      title: "Pagamento requer conferencia",
      body: `Pedido ${orderId}: ${reason}`,
      kind: "payment_review",
    })),
  );
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
    url.searchParams.get("data.id")
    ?? url.searchParams.get("data_id")
    ?? body.data?.id
    ?? "",
  ).trim();
  const requestId = request.headers.get("x-request-id");

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

  if (!requestId || !dataId) {
    return new Response("Missing webhook identifiers", { status: 400 });
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
  if (!orderId) {
    return new Response(null, { status: 200 });
  }

  const { data: order, error: orderError } = await (supabaseAdmin as any)
    .from("checkout_orders")
    .select("id, amount_cents, currency, status, expires_at")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) {
    return new Response(null, { status: 200 });
  }

  const { data: event, error: eventError } = await (supabaseAdmin as any)
    .from("payment_events")
    .upsert({
      provider: "mercado_pago",
      provider_event_id: requestId,
      event_type: body.action ?? "payment.updated",
      signature_valid: true,
      payload: body,
    }, {
      onConflict: "provider,provider_event_id",
    })
    .select("id")
    .single();
  if (eventError) throw eventError;

  const mappedStatus = paymentStatus(payment.status);
  const amountMatches = cents(payment.transaction_amount) === order.amount_cents;
  const currencyMatches = payment.currency_id === order.currency;
  const referenceMatches = externalReference === order.id;

  let { data: attempt } = await (supabaseAdmin as any)
    .from("payment_attempts")
    .select("id")
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
        amount_cents: cents(payment.transaction_amount),
        qr_code: transaction?.qr_code ?? null,
        qr_code_base64: transaction?.qr_code_base64 ?? null,
        ticket_url: transaction?.ticket_url ?? null,
        expires_at: payment.date_of_expiration ?? order.expires_at,
        paid_at: payment.date_approved ?? null,
        provider_payload: payment,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    attempt = inserted;
  } else {
    const { error: updateAttemptError } = await (supabaseAdmin as any)
      .from("payment_attempts")
      .update({
        status: mappedStatus,
        paid_at: mappedStatus === "paid" ? payment.date_approved ?? new Date().toISOString() : null,
        provider_payload: payment,
      })
      .eq("id", attempt.id);
    if (updateAttemptError) throw updateAttemptError;
  }

  let processingError: string | null = null;
  if (!amountMatches || !currencyMatches || !referenceMatches) {
    processingError = "Divergencia de valor, moeda ou referencia externa.";
  } else if (mappedStatus === "paid") {
    const { count: activeBookings } = await (supabaseAdmin as any)
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("checkout_order_id", order.id)
      .eq("status", "pendente")
      .eq("payment_status", "pendente")
      .gt("hold_expires_at", new Date().toISOString());

    if (order.status !== "pending" || !activeBookings) {
      processingError = "Pagamento aprovado sem reserva ativa; conferir manualmente.";
    }
  }

  if (processingError) {
    await (supabaseAdmin as any)
      .from("checkout_orders")
      .update({ status: "paid_needs_review" })
      .eq("id", order.id)
      .neq("status", "paid");
    await notifyPaymentReview(order.id, processingError);
  } else {
    const orderPatch = mappedStatus === "paid"
      ? { status: "paid", paid_at: payment.date_approved ?? new Date().toISOString() }
      : mappedStatus === "refunded"
        ? { status: "refunded", refunded_at: new Date().toISOString() }
        : mappedStatus === "cancelled"
          ? { status: "cancelled", cancelled_at: new Date().toISOString() }
          : mappedStatus === "failed"
            ? { status: "failed" }
            : { status: "pending" };

    const { error: updateOrderError } = await (supabaseAdmin as any)
      .from("checkout_orders")
      .update(orderPatch)
      .eq("id", order.id);
    if (updateOrderError) throw updateOrderError;

    if (mappedStatus === "cancelled" || mappedStatus === "failed") {
      await (supabaseAdmin as any)
        .from("bookings")
        .update({
          status: "cancelada",
          payment_status: mappedStatus === "cancelled" ? "cancelado" : "falhou",
        })
        .eq("checkout_order_id", order.id)
        .eq("payment_status", "pendente");
    }
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
