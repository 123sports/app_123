import QRCode from "qrcode";
import { isLocalSupabaseMode, supabase } from "@/integrations/supabase/client";
import { assertBookingSchedule } from "@/lib/booking-schedule";
import {
  approveLocalPixCheckoutServer,
  cancelBookingPixCheckoutServer,
  createBookingPixCheckoutServer,
  syncBookingPixCheckoutServer,
} from "@/lib/payments.functions";

export const LOCAL_PIX_HOLD_MINUTES = 30;

export function isLocalPaymentMode() {
  return isLocalSupabaseMode() || import.meta.env.VITE_PAYMENT_PROVIDER === "local";
}

export const BOOKING_TYPE_LABELS: Record<string, string> = {
  quadra_livre: "Quadra livre",
  aula_individual: "Aula individual",
  aula_dupla: "Aula em dupla",
  aula_trio: "Aula em trio",
  aula_quarteto: "Aula em quarteto",
  teste: "Teste",
};

export type PixCheckout = {
  orderId: string;
  paymentId: string;
  bookingIds: string[];
  amountCents: number;
  pixCopyPaste: string;
  qrCodeDataUrl: string;
  expiresAt: string;
  status: "pending" | "paid" | "expired" | "cancelled";
  description: string;
};

export type CreateBookingPixInput = {
  bookingDate: string;
  hours: number[];
  bookingType: string;
  professorId: string | null;
};

function uuid() {
  return crypto.randomUUID();
}

function fakePixPayload(orderId: string, amountCents: number) {
  return [
    "PIX-LOCAL",
    `ORDER=${orderId}`,
    `AMOUNT=${(amountCents / 100).toFixed(2)}`,
    "RECEIVER=ON TENNIS TESTE LOCAL",
  ].join("|");
}

async function getBookingPrice(bookingType: string) {
  const { data, error } = await (supabase as any)
    .from("pricing")
    .select("price_cents")
    .eq("booking_type", bookingType)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) throw new Error("Preço indisponível para este tipo de reserva.");
  const price = Number(data.price_cents);
  if (!Number.isInteger(price) || price <= 0) {
    throw new Error("O preço configurado para esta reserva é inválido.");
  }
  return price;
}

export async function createBookingPixCheckout(input: CreateBookingPixInput): Promise<PixCheckout> {
  if (!isLocalSupabaseMode()) {
    return createBookingPixCheckoutServer({ data: input });
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sessão expirada.");

  const hours = [...new Set(input.hours)].sort((a, b) => a - b);
  if (!hours.length) throw new Error("Selecione pelo menos um horário.");
  for (const hour of hours) assertBookingSchedule(input.bookingDate, hour);

  const { data: occupied } = await (supabase as any)
    .from("bookings_occupancy")
    .select("start_hour")
    .eq("booking_date", input.bookingDate)
    .in("start_hour", hours);

  if ((occupied ?? []).length) {
    throw new Error("Um dos horários selecionados não está mais disponível.");
  }

  const unitAmountCents = await getBookingPrice(input.bookingType);
  const amountCents = unitAmountCents * hours.length;
  const orderId = uuid();
  const paymentId = uuid();
  const bookingIds = hours.map(() => uuid());
  const expiresAt = new Date(Date.now() + LOCAL_PIX_HOLD_MINUTES * 60 * 1000).toISOString();
  const pixCopyPaste = fakePixPayload(orderId, amountCents);
  const qrCodeDataUrl = await QRCode.toDataURL(pixCopyPaste, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#0b1712", light: "#ffffff" },
  });
  const productLabel = BOOKING_TYPE_LABELS[input.bookingType] ?? "Reserva";
  const description = `${productLabel} em ${input.bookingDate
    .split("-")
    .reverse()
    .join("/")} · ${hours.map((hour) => `${String(hour).padStart(2, "0")}h`).join(", ")}`;

  const bookings = hours.map((hour, index) => ({
    id: bookingIds[index],
    user_id: auth.user.id,
    professor_id: input.professorId,
    booking_date: input.bookingDate,
    start_hour: hour,
    duration_hours: 1,
    type: input.bookingType,
    status: "pendente",
    payment_status: "pendente",
    payment_method: "pix",
    price_cents: unitAmountCents,
    amount_cents: unitAmountCents,
    checkout_order_id: orderId,
    hold_expires_at: expiresAt,
    confirmed_at: null,
    attended: false,
  }));

  const order = {
    id: orderId,
    user_id: auth.user.id,
    kind: "booking",
    status: "pending",
    currency: "BRL",
    amount_cents: amountCents,
    description,
    expires_at: expiresAt,
    paid_at: null,
    provider: "local",
    metadata: {
      booking_ids: bookingIds,
      booking_date: input.bookingDate,
      hours,
      booking_type: input.bookingType,
      professor_id: input.professorId,
      quantity: hours.length,
      unit_amount_cents: unitAmountCents,
    },
  };

  const items = hours.map((hour, index) => ({
    checkout_order_id: orderId,
    item_type: "booking",
    reference_id: bookingIds[index],
    description: `${productLabel} · ${input.bookingDate.split("-").reverse().join("/")} às ${String(hour).padStart(2, "0")}h`,
    quantity: 1,
    unit_amount_cents: unitAmountCents,
    total_amount_cents: unitAmountCents,
    metadata: {
      booking_type: input.bookingType,
      booking_date: input.bookingDate,
      start_hour: hour,
    },
  }));

  const payment = {
    id: paymentId,
    checkout_order_id: orderId,
    provider: "local",
    provider_order_id: `LOCAL-${orderId}`,
    provider_payment_id: `LOCAL-PAY-${paymentId}`,
    payment_method: "pix",
    status: "pending",
    amount_cents: amountCents,
    qr_code: pixCopyPaste,
    qr_code_base64: qrCodeDataUrl,
    ticket_url: null,
    expires_at: expiresAt,
    paid_at: null,
  };

  try {
    const { error: orderError } = await (supabase as any).from("checkout_orders").insert(order);
    if (orderError) throw orderError;
    const { error: bookingError } = await (supabase as any).from("bookings").insert(bookings);
    if (bookingError) throw bookingError;
    const { error: itemError } = await (supabase as any).from("checkout_items").insert(items);
    if (itemError) throw itemError;
    const { error: paymentError } = await (supabase as any)
      .from("payment_attempts")
      .insert(payment);
    if (paymentError) throw paymentError;
  } catch (error) {
    await (supabase as any).from("payment_attempts").delete().eq("checkout_order_id", orderId);
    await (supabase as any).from("checkout_items").delete().eq("checkout_order_id", orderId);
    await (supabase as any).from("bookings").delete().eq("checkout_order_id", orderId);
    await (supabase as any).from("checkout_orders").delete().eq("id", orderId);
    throw error;
  }

  return {
    orderId,
    paymentId,
    bookingIds,
    amountCents,
    pixCopyPaste,
    qrCodeDataUrl,
    expiresAt,
    status: "pending",
    description,
  };
}

async function readLocalOrder(orderId: string) {
  const { data, error } = await (supabase as any)
    .from("checkout_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) throw new Error("Cobrança local não encontrada.");
  return data as any;
}

export async function getPixCheckout(orderId: string): Promise<PixCheckout> {
  if (!isLocalSupabaseMode()) {
    try {
      await syncBookingPixCheckoutServer({ data: { orderId } });
    } catch (error) {
      console.warn("[Payments] Pix reconciliation failed", error);
    }
  }

  const { data: order, error: orderError } = await (supabase as any)
    .from("checkout_orders")
    .select("id, status, amount_cents, description, expires_at, metadata")
    .eq("id", orderId)
    .maybeSingle();
  const { data: payment, error: paymentError } = await (supabase as any)
    .from("payment_attempts")
    .select("id, checkout_order_id, status, qr_code, qr_code_base64, expires_at")
    .eq("checkout_order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderError || paymentError || !order || !payment) {
    throw new Error("Cobrança Pix não encontrada.");
  }

  const status =
    order.status === "paid"
      ? "paid"
      : order.status === "cancelled"
        ? "cancelled"
        : order.status === "expired" || new Date(order.expires_at).getTime() <= Date.now()
          ? "expired"
          : "pending";

  return {
    orderId: order.id,
    paymentId: payment.id,
    bookingIds: order.metadata?.booking_ids ?? [],
    amountCents: order.amount_cents,
    pixCopyPaste: payment.qr_code ?? "",
    qrCodeDataUrl: payment.qr_code_base64
      ? payment.qr_code_base64.startsWith("data:")
        ? payment.qr_code_base64
        : `data:image/png;base64,${payment.qr_code_base64}`
      : "",
    expiresAt: order.expires_at,
    status,
    description: order.description,
  };
}

export async function expireLocalPixCheckout(checkout: PixCheckout) {
  if (!isLocalSupabaseMode()) return;
  const order = await readLocalOrder(checkout.orderId);
  if (order.status !== "pending") return;

  await (supabase as any)
    .from("checkout_orders")
    .update({ status: "expired" })
    .eq("id", checkout.orderId);
  await (supabase as any)
    .from("payment_attempts")
    .update({ status: "expired" })
    .eq("id", checkout.paymentId);
  await (supabase as any)
    .from("bookings")
    .update({ status: "cancelada", payment_status: "expirado" })
    .in("id", checkout.bookingIds);
}

export async function cleanupExpiredLocalPixCheckouts() {
  if (!isLocalSupabaseMode()) return;
  const { data: orders } = await (supabase as any)
    .from("checkout_orders")
    .select("id, expires_at")
    .eq("status", "pending");

  for (const order of orders ?? []) {
    if (order.expires_at && new Date(order.expires_at).getTime() <= Date.now()) {
      const checkout = await getPixCheckout(order.id);
      await expireLocalPixCheckout(checkout);
    }
  }
}

export async function cancelLocalPixCheckout(orderId: string) {
  if (!isLocalSupabaseMode()) {
    await cancelBookingPixCheckoutServer({ data: { orderId } });
    return;
  }
  const checkout = await getPixCheckout(orderId);
  const order = await readLocalOrder(orderId);
  if (order.status === "paid") {
    throw new Error("Uma reserva paga não pode ser cancelada sem tratar o estorno.");
  }
  if (order.status !== "pending") return;

  await (supabase as any)
    .from("checkout_orders")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", orderId);
  await (supabase as any)
    .from("payment_attempts")
    .update({ status: "cancelled" })
    .eq("id", checkout.paymentId);
  await (supabase as any)
    .from("bookings")
    .update({ status: "cancelada", payment_status: "cancelado" })
    .in("id", checkout.bookingIds);
}

export async function approveLocalPixCheckout(checkout: PixCheckout): Promise<PixCheckout> {
  if (!isLocalPaymentMode()) {
    throw new Error("A aprovação manual só existe no ambiente local.");
  }
  if (!isLocalSupabaseMode()) {
    await approveLocalPixCheckoutServer({ data: { orderId: checkout.orderId } });
    return { ...checkout, status: "paid" };
  }

  const order = await readLocalOrder(checkout.orderId);
  if (order.status === "paid") return { ...checkout, status: "paid" };
  if (order.status !== "pending") {
    throw new Error("Esta cobrança não está mais disponível para pagamento.");
  }
  if (new Date(order.expires_at).getTime() <= Date.now()) {
    await expireLocalPixCheckout(checkout);
    throw new Error("Este Pix expirou. Gere uma nova cobrança.");
  }

  const { data: linkedBookings } = await (supabase as any)
    .from("bookings")
    .select("id, status, payment_status")
    .eq("checkout_order_id", checkout.orderId);
  if (
    (linkedBookings ?? []).length !== checkout.bookingIds.length ||
    (linkedBookings ?? []).some((booking: any) => booking.status === "cancelada")
  ) {
    throw new Error("A reserva vinculada a este Pix não está mais disponível.");
  }

  const paidAt = new Date().toISOString();
  await (supabase as any)
    .from("checkout_orders")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", checkout.orderId);
  await (supabase as any)
    .from("payment_attempts")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", checkout.paymentId);
  await (supabase as any)
    .from("bookings")
    .update({
      status: "confirmada",
      payment_status: "pago",
      payment_method: "pix",
      hold_expires_at: null,
      confirmed_at: paidAt,
    })
    .in("id", checkout.bookingIds);

  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) {
    await (supabase as any).from("notifications").insert({
      user_id: auth.user.id,
      title: "Reserva confirmada",
      body: `Tudo certo! O pagamento foi aprovado e sua reserva está confirmada: ${order.description}.`,
      kind: "booking_confirmed",
      related_booking_id: checkout.bookingIds[0] ?? null,
    });
  }

  return { ...checkout, status: "paid" };
}
