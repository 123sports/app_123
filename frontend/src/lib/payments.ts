import QRCode from "qrcode";
import { isLocalSupabaseMode, supabase } from "@/integrations/supabase/client";
import { assertBookingSchedule } from "@/lib/booking-schedule";
import {
  approveLocalPixCheckoutServer,
  cancelBookingPixCheckoutServer,
  createBookingPixCheckoutServer,
  syncBookingPixCheckoutServer,
} from "@/lib/payments.functions";
import { effectiveCheckoutStatus } from "@/lib/payment-security";

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
  sessionIds: string[];
  amountCents: number;
  pixCopyPaste: string;
  qrCodeDataUrl: string;
  expiresAt: string;
  status:
    | "pending"
    | "paid"
    | "expired"
    | "cancelled"
    | "failed"
    | "refunded"
    | "paid_needs_review";
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

type BookingProduct = {
  booking_type: string;
  display_name: string;
  price_cents: number;
  student_capacity: number;
  requires_professor: boolean;
};

async function getBookingProduct(bookingType: string): Promise<BookingProduct> {
  const { data, error } = await (supabase as any)
    .from("pricing")
    .select("booking_type, display_name, price_cents, student_capacity, requires_professor")
    .eq("booking_type", bookingType)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) throw new Error("Preço indisponível para este tipo de reserva.");
  const product = data as BookingProduct;
  if (
    !Number.isInteger(product.price_cents) ||
    product.price_cents <= 0 ||
    !Number.isInteger(product.student_capacity) ||
    product.student_capacity < 1
  ) {
    throw new Error("O preço configurado para esta reserva é inválido.");
  }
  return product;
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

  const product = await getBookingProduct(input.bookingType);
  if (product.requires_professor && !input.professorId) {
    throw new Error("Selecione o professor antes de continuar.");
  }
  if (!product.requires_professor && input.professorId) {
    throw new Error("Este tipo de reserva não utiliza professor.");
  }
  if (product.requires_professor && hours.length !== 1) {
    throw new Error("Selecione um horário por aula.");
  }

  const [{ data: existingSessions }, { data: activeBookings }] = await Promise.all([
    (supabase as any)
      .from("reservation_sessions")
      .select("*")
      .eq("booking_date", input.bookingDate)
      .eq("status", "open")
      .in("start_hour", hours),
    (supabase as any).from("bookings_occupancy").select("id, session_id, user_id"),
  ]);

  const createdSessions: any[] = [];
  const sessionIds: string[] = [];
  const unitAmounts: number[] = [];
  for (const hour of hours) {
    const existing = (existingSessions ?? []).find((session: any) => session.start_hour === hour);
    if (existing) {
      if (existing.product_type !== input.bookingType) {
        throw new Error("Este horário já possui outro tipo de aula.");
      }
      if (existing.professor_id !== input.professorId) {
        throw new Error("Este horário está vinculado a outro professor.");
      }
      const participants = (activeBookings ?? []).filter(
        (booking: any) => booking.session_id === existing.id,
      );
      if (participants.some((booking: any) => booking.user_id === auth.user.id)) {
        throw new Error("Você já possui uma vaga neste horário.");
      }
      if (participants.length >= existing.capacity) {
        throw new Error("A última vaga deste horário já foi ocupada.");
      }
      sessionIds.push(existing.id);
      unitAmounts.push(existing.unit_price_cents);
      continue;
    }

    const id = uuid();
    sessionIds.push(id);
    unitAmounts.push(product.price_cents);
    createdSessions.push({
      id,
      booking_date: input.bookingDate,
      start_hour: hour,
      professor_id: input.professorId,
      product_type: input.bookingType,
      capacity: product.student_capacity,
      unit_price_cents: product.price_cents,
      status: "open",
    });
  }

  const amountCents = unitAmounts.reduce((total, amount) => total + amount, 0);
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
  const productLabel = product.display_name || BOOKING_TYPE_LABELS[input.bookingType] || "Reserva";
  const description = `${productLabel} em ${input.bookingDate
    .split("-")
    .reverse()
    .join("/")} · ${hours.map((hour) => `${String(hour).padStart(2, "0")}h`).join(", ")}`;

  const bookings = hours.map((hour, index) => ({
    id: bookingIds[index],
    session_id: sessionIds[index],
    user_id: auth.user.id,
    professor_id: input.professorId,
    booking_date: input.bookingDate,
    start_hour: hour,
    duration_hours: 1,
    type: input.bookingType,
    status: "pendente",
    payment_status: "pendente",
    payment_method: "pix",
    price_cents: unitAmounts[index],
    amount_cents: unitAmounts[index],
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
      session_ids: sessionIds,
      booking_date: input.bookingDate,
      hours,
      booking_type: input.bookingType,
      professor_id: input.professorId,
      quantity: hours.length,
      unit_amount_cents: hours.length === 1 ? unitAmounts[0] : null,
    },
  };

  const items = hours.map((hour, index) => ({
    checkout_order_id: orderId,
    item_type: "booking",
    reference_id: bookingIds[index],
    description: `${productLabel} · ${input.bookingDate.split("-").reverse().join("/")} às ${String(hour).padStart(2, "0")}h`,
    quantity: 1,
    unit_amount_cents: unitAmounts[index],
    total_amount_cents: unitAmounts[index],
    metadata: {
      booking_type: input.bookingType,
      booking_date: input.bookingDate,
      start_hour: hour,
      session_id: sessionIds[index],
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
    if (createdSessions.length) {
      const { error: sessionError } = await (supabase as any)
        .from("reservation_sessions")
        .insert(createdSessions);
      if (sessionError) throw sessionError;
    }
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
    if (createdSessions.length) {
      await (supabase as any)
        .from("reservation_sessions")
        .delete()
        .in(
          "id",
          createdSessions.map((session) => session.id),
        );
    }
    throw error;
  }

  return {
    orderId,
    paymentId,
    bookingIds,
    sessionIds,
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

  const knownStatuses = new Set<PixCheckout["status"]>([
    "pending",
    "paid",
    "expired",
    "cancelled",
    "failed",
    "refunded",
    "paid_needs_review",
  ]);
  const storedStatus = knownStatuses.has(order.status as PixCheckout["status"])
    ? (order.status as PixCheckout["status"])
    : "paid_needs_review";
  const status = effectiveCheckoutStatus(storedStatus, order.expires_at) as PixCheckout["status"];

  return {
    orderId: order.id,
    paymentId: payment.id,
    bookingIds: order.metadata?.booking_ids ?? [],
    sessionIds: order.metadata?.session_ids ?? [],
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
    .select("id, session_id, booking_date, start_hour, type, professor_id, status, payment_status")
    .eq("checkout_order_id", checkout.orderId);
  if (
    (linkedBookings ?? []).length !== checkout.bookingIds.length ||
    (linkedBookings ?? []).some((booking: any) => booking.status === "cancelada")
  ) {
    throw new Error("A reserva vinculada a este Pix não está mais disponível.");
  }

  const linkedSessionIds = [
    ...new Set((linkedBookings ?? []).map((booking: any) => booking.session_id).filter(Boolean)),
  ];
  const [{ data: linkedSessions }, { data: activeBookings }] = await Promise.all([
    (supabase as any).from("reservation_sessions").select("*").in("id", linkedSessionIds),
    (supabase as any).from("bookings_occupancy").select("id, session_id"),
  ]);
  const sessionMap = new Map((linkedSessions ?? []).map((session: any) => [session.id, session]));
  const invalidSession = (linkedBookings ?? []).some((booking: any) => {
    const session: any = sessionMap.get(booking.session_id);
    const occupancy = (activeBookings ?? []).filter(
      (active: any) => active.session_id === booking.session_id,
    ).length;
    return (
      !session ||
      session.status !== "open" ||
      occupancy > session.capacity ||
      session.booking_date !== booking.booking_date ||
      session.start_hour !== booking.start_hour ||
      session.product_type !== booking.type ||
      session.professor_id !== booking.professor_id
    );
  });
  if (invalidSession || sessionMap.size !== linkedSessionIds.length) {
    throw new Error("A turma vinculada a este Pix não está mais disponível.");
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
    const firstSession: any = sessionMap.get(linkedSessionIds[0]);
    await (supabase as any).from("notifications").insert({
      user_id: auth.user.id,
      title: firstSession?.capacity > 1 ? "Vaga confirmada" : "Reserva confirmada",
      body: `Tudo certo! O pagamento foi aprovado e confirmamos ${order.description}.`,
      kind: "booking_confirmed",
      related_booking_id: checkout.bookingIds[0] ?? null,
    });
  }

  return { ...checkout, status: "paid" };
}
