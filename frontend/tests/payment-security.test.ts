import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { validateMercadoPagoWebhook } from "../src/lib/mercado-pago.server.ts";
import {
  decidePaymentTransition,
  mercadoPagoPaymentStatus,
  safeMercadoPagoPayload,
} from "../src/lib/payment-security.ts";

test("normalizes Mercado Pago terminal and review statuses", () => {
  assert.equal(mercadoPagoPaymentStatus("approved", "accredited"), "paid");
  assert.equal(mercadoPagoPaymentStatus("refunded", "refunded"), "refunded");
  assert.equal(mercadoPagoPaymentStatus("refunded", "partially_refunded"), "paid_needs_review");
  assert.equal(mercadoPagoPaymentStatus("charged_back", "in_process"), "paid_needs_review");
  assert.equal(mercadoPagoPaymentStatus("expired", "expired"), "expired");
});

test("never regresses a paid or refunded order", () => {
  assert.deepEqual(decidePaymentTransition("paid", "pending"), {
    nextOrderStatus: null,
    reviewReason: null,
  });
  assert.equal(decidePaymentTransition("paid", "failed").nextOrderStatus, null);
  assert.equal(decidePaymentTransition("refunded", "paid").nextOrderStatus, null);
});

test("allows a verified full refund from every non-refunded state", () => {
  assert.equal(decidePaymentTransition("pending", "refunded").nextOrderStatus, "refunded");
  assert.equal(decidePaymentTransition("paid", "refunded").nextOrderStatus, "refunded");
  assert.equal(decidePaymentTransition("refunded", "refunded").nextOrderStatus, null);
});

test("removes payer and QR data from the stored provider audit payload", () => {
  const sanitized = safeMercadoPagoPayload({
    id: 123,
    status: "approved",
    payer: { email: "student@example.com", identification: { number: "12345678900" } },
    point_of_interaction: { transaction_data: { qr_code: "secret-pix-code" } },
    metadata: { checkout_order_id: "order-id", unexpected: "drop-me" },
  }) as Record<string, unknown>;

  assert.equal(sanitized.id, 123);
  assert.equal("payer" in sanitized, false);
  assert.equal("point_of_interaction" in sanitized, false);
  assert.deepEqual(sanitized.metadata, { checkout_order_id: "order-id" });
});

test("accepts a current Mercado Pago signature and rejects a replay older than five minutes", () => {
  const previousSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const secret = "unit-test-webhook-secret";
  const requestId = crypto.randomUUID();
  const dataId = "123456789";
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = secret;

  const signature = (timestamp: number) => {
    const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
    const hash = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    return `ts=${timestamp},v1=${hash}`;
  };

  try {
    const now = Math.floor(Date.now() / 1000);
    assert.doesNotThrow(() =>
      validateMercadoPagoWebhook({ signature: signature(now), requestId, dataId }),
    );
    assert.throws(() =>
      validateMercadoPagoWebhook({ signature: signature(now - 301), requestId, dataId }),
    );
  } finally {
    if (previousSecret === undefined) delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    else process.env.MERCADO_PAGO_WEBHOOK_SECRET = previousSecret;
  }
});
