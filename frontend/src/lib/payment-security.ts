export type CheckoutOrderStatus =
  | "pending"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed"
  | "refunded"
  | "paid_needs_review";

export type ReconciledPaymentStatus =
  | "pending"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed"
  | "refunded"
  | "paid_needs_review";

export type PaymentTransitionDecision = {
  nextOrderStatus: CheckoutOrderStatus | null;
  reviewReason: string | null;
};

export function effectiveCheckoutStatus(
  status: CheckoutOrderStatus | string,
  expiresAt?: string | null,
  nowMs = Date.now(),
) {
  if (status === "pending" && expiresAt && new Date(expiresAt).getTime() <= nowMs) {
    return "expired";
  }
  return status;
}

type MercadoPagoPaymentIdentity = {
  transaction_amount?: number | null;
  currency_id?: string | null;
  payment_method_id?: string | null;
  external_reference?: string | null;
  metadata?: { checkout_order_id?: unknown } | null;
};

type CheckoutOrderIdentity = {
  id: string;
  amount_cents: number;
  currency: string;
};

export type MercadoPagoPaymentValidation = {
  valid: boolean;
  errors: string[];
  amountCents: number | null;
};

export function validateMercadoPagoPaymentForOrder(
  payment: MercadoPagoPaymentIdentity,
  order: CheckoutOrderIdentity,
): MercadoPagoPaymentValidation {
  const amount = Number(payment.transaction_amount);
  const amountCents = Number.isFinite(amount) ? Math.round(amount * 100) : null;
  const metadataOrderId = String(payment.metadata?.checkout_order_id ?? "");
  const errors: string[] = [];

  if (amountCents !== order.amount_cents) errors.push("amount_mismatch");
  if (payment.currency_id !== order.currency) errors.push("currency_mismatch");
  if (payment.payment_method_id !== "pix") errors.push("payment_method_mismatch");
  if (String(payment.external_reference ?? "") !== order.id) {
    errors.push("external_reference_mismatch");
  }
  if (metadataOrderId && metadataOrderId !== order.id) {
    errors.push("metadata_reference_mismatch");
  }

  return { valid: errors.length === 0, errors, amountCents };
}

export function mercadoPagoPaymentStatus(
  status?: string | null,
  statusDetail?: string | null,
): ReconciledPaymentStatus {
  if (status === "charged_back") {
    return "refunded";
  }

  if (statusDetail === "partially_refunded") {
    return "paid_needs_review";
  }

  switch (status) {
    case "approved":
      return "paid";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "rejected":
      return "failed";
    case "expired":
      return "expired";
    case "refunded":
      return "refunded";
    default:
      return "pending";
  }
}

export function decidePaymentTransition(
  orderStatus: CheckoutOrderStatus,
  paymentStatus: ReconciledPaymentStatus,
): PaymentTransitionDecision {
  if (paymentStatus === "paid_needs_review") {
    if (orderStatus === "paid_needs_review") {
      return { nextOrderStatus: null, reviewReason: null };
    }
    return {
      nextOrderStatus: "paid_needs_review",
      reviewReason: "Pagamento com estorno parcial ou contestacao; conferir manualmente.",
    };
  }

  if (paymentStatus === "paid") {
    if (orderStatus === "paid") return { nextOrderStatus: null, reviewReason: null };
    if (orderStatus === "pending") return { nextOrderStatus: "paid", reviewReason: null };
    return {
      nextOrderStatus: null,
      reviewReason: "Pagamento aprovado sem reserva ativa; conferir manualmente.",
    };
  }

  if (paymentStatus === "refunded") {
    return orderStatus === "refunded"
      ? { nextOrderStatus: null, reviewReason: null }
      : { nextOrderStatus: "refunded", reviewReason: null };
  }

  if (paymentStatus === "pending") {
    return { nextOrderStatus: null, reviewReason: null };
  }

  if (orderStatus === "pending") {
    return { nextOrderStatus: paymentStatus, reviewReason: null };
  }

  if (orderStatus === paymentStatus) {
    return { nextOrderStatus: null, reviewReason: null };
  }

  if (orderStatus === "paid" || orderStatus === "paid_needs_review") {
    return {
      nextOrderStatus: null,
      reviewReason: "Status do provedor diverge de um pagamento ja confirmado.",
    };
  }

  return { nextOrderStatus: null, reviewReason: null };
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null),
  );
}

export function safeMercadoPagoPayload(payment: unknown) {
  if (!payment || typeof payment !== "object") return {};
  const source = payment as Record<string, unknown>;
  const metadata =
    source.metadata && typeof source.metadata === "object"
      ? (source.metadata as Record<string, unknown>)
      : {};

  return compactRecord({
    id: source.id,
    status: source.status,
    status_detail: source.status_detail,
    payment_method_id: source.payment_method_id,
    payment_type_id: source.payment_type_id,
    external_reference: source.external_reference,
    transaction_amount: source.transaction_amount,
    currency_id: source.currency_id,
    live_mode: source.live_mode,
    date_created: source.date_created,
    date_approved: source.date_approved,
    date_last_updated: source.date_last_updated,
    date_of_expiration: source.date_of_expiration,
    metadata: compactRecord({ checkout_order_id: metadata.checkout_order_id }),
  });
}
