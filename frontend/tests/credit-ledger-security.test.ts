import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260903010000_secure_class_credit_ledger.sql",
    import.meta.url,
  ),
  "utf8",
);
const paymentFunctions = fs.readFileSync(
  new URL("../src/lib/payments.functions.ts", import.meta.url),
  "utf8",
);
const webhook = fs.readFileSync(
  new URL("../src/lib/payments.webhook.server.ts", import.meta.url),
  "utf8",
);
const adminPlans = fs.readFileSync(
  new URL("../src/routes/_authenticated/admin.aulas-planos.tsx", import.meta.url),
  "utf8",
);

function contains(pattern: RegExp, message: string) {
  assert.match(migration, pattern, message);
}

test("credit ledger is append-only, owner-scoped and hash chained", () => {
  contains(/ALTER TABLE public\.student_credit_ledger ENABLE ROW LEVEL SECURITY/i, "RLS missing");
  contains(
    /REVOKE ALL ON public\.student_credit_ledger FROM PUBLIC, anon, authenticated, service_role/i,
    "ledger writes are not fully revoked",
  );
  contains(
    /BEFORE UPDATE OR DELETE ON public\.student_credit_ledger/i,
    "immutability trigger missing",
  );
  contains(/sequence_no bigint NOT NULL DEFAULT 0/i, "stable sequence missing");
  contains(/UNIQUE \(user_id, sequence_no\)/i, "per-user sequence uniqueness missing");
  contains(
    /NEW\.sequence_no := COALESCE\(v_previous_sequence, 0\) \+ 1/i,
    "sequence is not assigned under the ledger lock",
  );
  contains(
    /digest\(NEW\.previous_hash \|\| '\|' \|\| v_payload, 'sha256'\)/i,
    "hash chain missing",
  );
  contains(/verify_student_credit_ledger\(p_user_id uuid\)/i, "integrity verifier missing");
});

test("ledger rejects invalid balances and mismatched idempotent entries", () => {
  contains(
    /v_current_balance \+ NEW\.credit_delta < 0[\s\S]*v_current_balance \+ NEW\.credit_delta > v_max_balance/i,
    "balance bounds are not enforced",
  );
  contains(
    /A chave idempotente ja foi usada em outro lancamento/i,
    "idempotency mismatch is not rejected",
  );
  contains(/booking\.credit_grant_id = p_grant_id/i, "booking entries are not tied to their grant");
});

test("plan credits require a reconciled paid Pix and immutable snapshot", () => {
  contains(/NEW\.kind <> 'class_plan'[\s\S]*NEW\.status <> 'paid'/i, "paid plan gate missing");
  contains(
    /attempt\.status = 'paid'[\s\S]*attempt\.payment_method = 'pix'[\s\S]*attempt\.amount_cents = NEW\.amount_cents/i,
    "paid Pix reconciliation missing",
  );
  contains(/plan_snapshot/i, "plan snapshot missing");
  contains(
    /class_plans_modality_credit_consistency_check[\s\S]*lower\(trim\(modality\)\) = credit_modality/i,
    "commercial and credit modalities can diverge",
  );
  contains(
    /GRANT INSERT, UPDATE ON public\.class_plans TO authenticated/i,
    "admin plan writes lack table privileges",
  );
  contains(
    /REVOKE DELETE ON public\.class_plans FROM authenticated/i,
    "financial plans remain deletable",
  );
  contains(
    /UNIQUE[\s\S]*REFERENCES public\.checkout_orders\(id\) ON DELETE RESTRICT/i,
    "grant/order uniqueness missing",
  );
  contains(
    /entry_type = 'refund_reversal' AND credit_delta <= 0/i,
    "zero-balance refunds are absent from the immutable ledger",
  );
  contains(
    /revoke_refunded_plan_credits\(\)[\s\S]*pg_advisory_xact_lock\([\s\S]*NEW\.user_id[\s\S]*SELECT \* INTO v_grant/i,
    "refund and booking flows acquire financial locks in different order",
  );
  assert.match(
    adminPlans,
    /value: "grupo", label: "Grupo \(3 ou 4 alunos\)", databaseValue: "Grupo"/,
    "the group display label is being persisted as the canonical database modality",
  );
  assert.match(
    adminPlans,
    /Number\.isInteger\(creditQuantity\)/,
    "fractional credits are accepted",
  );
});

test("credit booking and cancellation are server-only and atomic", () => {
  contains(/CREATE OR REPLACE FUNCTION public\.create_credit_booking/i, "booking RPC missing");
  contains(/CREATE OR REPLACE FUNCTION public\.cancel_credit_booking/i, "cancellation RPC missing");
  contains(/Operacao exclusiva do servidor/i, "server role gate missing");
  contains(/bookings_credit_financial_shape CHECK/i, "credit booking financial shape missing");
  contains(/booking-debit:/i, "booking debit is not idempotent");
  contains(/booking-cancellation:/i, "cancellation is not idempotent");
  contains(/cancellation_notice_hours/i, "configurable cancellation notice missing");
  contains(/late_cancellation_forfeit/i, "late cancellation audit entry missing");
  contains(
    /NEW\.credit_grant_id IS NOT NULL[\s\S]*NEW\.payment_method = 'credito_plano'/i,
    "browser updates can attach a credit to an existing booking",
  );
});

test("payment notification references cannot be changed by the browser", () => {
  contains(
    /NEW\.related_checkout_order_id IS DISTINCT FROM OLD\.related_checkout_order_id/i,
    "checkout notification reference is not protected",
  );
  contains(/Somente o estado de leitura pode ser alterado/i, "notification guard missing");
});

test("staff receives a single notification when admin and professor are the same user", () => {
  contains(
    /CREATE OR REPLACE FUNCTION public\.notify_on_booking_insert\(\)[\s\S]*SELECT role_row\.user_id[\s\S]*UNION[\s\S]*SELECT NEW\.professor_id/i,
    "staff recipients are not consolidated",
  );
  contains(
    /NEW\.checkout_order_id IS NOT NULL[\s\S]*NEW\.payment_status = 'pendente'/i,
    "unpaid checkout holds can notify staff",
  );
});

test("plan payments bypass booking-hold validation only by explicit kind", () => {
  assert.match(
    paymentFunctions,
    /mappedStatus === "paid"[\s\S]*order\.kind === "booking"[\s\S]*hasCompleteActiveBookingHold/,
  );
  assert.match(
    webhook,
    /mappedStatus === "paid"[\s\S]*order\.kind === "booking"[\s\S]*hasCompleteActiveBookingHold/,
  );
});

test("concurrent Mercado Pago attempts reconcile paid Pix for bookings and plans", () => {
  assert.equal(
    paymentFunctions.match(/\.select\("id, checkout_order_id, status"\)/g)?.length,
    2,
    "booking and plan flows must both inspect the concurrent attempt status",
  );
  assert.equal(
    paymentFunctions.match(
      /paymentValidation\.valid\s*&&\s*initialPaymentStatus === "paid"\s*&&\s*concurrentAttempt\.status !== "paid"/g,
    )?.length,
    2,
    "booking and plan flows must both recognize an approved concurrent attempt",
  );
  assert.equal(
    paymentFunctions.match(
      /\.in\("status", \["pending", "expired", "cancelled", "failed", "paid_needs_review"\]\)/g,
    )?.length,
    2,
    "booking and plan reconciliation must not overwrite a refunded attempt",
  );
});
