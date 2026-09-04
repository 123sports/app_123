import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260904010000_plan_checkout_initial_booking.sql",
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
const paymentAdmin = fs.readFileSync(
  new URL("../src/lib/payments-admin.functions.ts", import.meta.url),
  "utf8",
);
const holdValidation = fs.readFileSync(
  new URL("../src/lib/booking-checkout-validation.server.ts", import.meta.url),
  "utf8",
);
const agenda = fs.readFileSync(
  new URL("../src/routes/_authenticated/app.agenda.tsx", import.meta.url),
  "utf8",
);
const studentPlans = fs.readFileSync(
  new URL("../src/routes/_authenticated/app.aulas.tsx", import.meta.url),
  "utf8",
);
const checkoutDialog = fs.readFileSync(
  new URL("../src/components/PixCheckoutDialog.tsx", import.meta.url),
  "utf8",
);

test("agenda plan checkout creates a server-only expiring seat hold", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_class_plan_booking_checkout/i);
  assert.match(migration, /COALESCE\(auth\.jwt\(\)->>'role', ''\) <> 'service_role'/i);
  assert.match(migration, /cleanup_expired_booking_holds\(\)/i);
  assert.match(migration, /hashtextextended\('class-plan-checkout:' \|\| p_user_id::text/i);
  assert.match(
    migration,
    /hashtextextended\(p_booking_date::text \|\| ':' \|\| p_start_hour::text/i,
  );
  assert.match(migration, /public\.is_credit_modality_compatible\(v_plan\.credit_modality/i);
  assert.match(migration, /v_occupied >= v_session\.capacity/i);
  assert.match(
    migration,
    /INSERT INTO public\.bookings[\s\S]*'pendente',[\s\S]*'pendente', 'pix'[\s\S]*v_expires_at/i,
  );
  assert.match(
    migration,
    /REVOKE EXECUTE ON FUNCTION public\.create_class_plan_booking_checkout[\s\S]*PUBLIC, anon, authenticated/i,
  );
});

test("paid plan atomically grants credits and consumes one for the held lesson", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.finalize_paid_plan_initial_booking/i);
  assert.match(migration, /checkout_orders_25_finalize_plan_initial_booking/i);
  assert.match(migration, /student_credit_grants[\s\S]*checkout_order_id = NEW\.id/i);
  assert.match(
    migration,
    /attempt\.status = 'paid'[\s\S]*attempt\.payment_method = 'pix'[\s\S]*attempt\.amount_cents = NEW\.amount_cents/i,
  );
  assert.match(
    migration,
    /SET status = 'confirmada',[\s\S]*payment_status = 'pago',[\s\S]*payment_method = 'credito_plano'[\s\S]*credit_grant_id = v_grant\.id/i,
  );
  assert.match(migration, /INSERT INTO public\.student_credit_allocations/i);
  assert.match(
    migration,
    /public\.append_credit_ledger_entry\([\s\S]*'booking_debit',[\s\S]*-1,[\s\S]*'booking-debit:' \|\| v_booking\.id::text/i,
  );
  assert.match(migration, /Primeira aula reservada junto com a compra do plano/i);
  assert.match(migration, /v_booking\.duration_hours <> 1/i);
  assert.match(migration, /v_booking\.price_cents IS DISTINCT FROM v_session\.unit_price_cents/i);
  assert.match(
    migration,
    /v_intent->>'professor_id' IS DISTINCT FROM v_booking\.professor_id::text/i,
  );
  assert.match(
    migration,
    /NEW\.metadata->'booking_ids' IS DISTINCT FROM jsonb_build_array\(v_booking\.id\)/i,
  );
  assert.match(
    migration,
    /UPDATE public\.notifications[\s\S]*Plano e aula confirmados[\s\S]*Um credito foi usado na reserva inicial[\s\S]*v_balance::text/i,
  );
  assert.match(migration, /'fulfilled_initial_booking', v_intent/i);
});

test("webhook and polling validate plan booking intent before marking it paid", () => {
  assert.match(
    webhook,
    /select\("id, kind, amount_cents, currency, status, expires_at, metadata"\)/,
  );
  assert.match(
    paymentFunctions,
    /select\("id, user_id, kind, amount_cents, currency, status, expires_at, metadata"\)/,
  );
  assert.match(holdValidation, /order\.kind === "class_plan" && Boolean\(initialBooking\)/);
  assert.match(holdValidation, /bookingRows\.length !== 1/);
  assert.match(holdValidation, /initialBooking\.booking_id[\s\S]*booking\.id/);
  assert.match(holdValidation, /initialBooking\.session_id[\s\S]*booking\.session_id/);
  assert.match(holdValidation, /initialBooking\.booking_date[\s\S]*booking\.booking_date/);
});

test("late reviewed Pix grants the plan without stealing an expired seat", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.settle_reviewed_plan_checkout_without_booking/i,
  );
  assert.match(migration, /v_order\.metadata - 'initial_booking' - 'booking_ids' - 'session_ids'/i);
  assert.match(migration, /'unfulfilled_initial_booking', v_intent/i);
  assert.match(migration, /'Escolha um novo horario'/i);
  assert.match(
    migration,
    /REVOKE EXECUTE ON FUNCTION public\.settle_reviewed_plan_checkout_without_booking[\s\S]*PUBLIC, anon, authenticated/i,
  );
  assert.match(
    paymentAdmin,
    /select\("id, user_id, kind, status, amount_cents, currency, metadata"\)/,
  );
  assert.match(paymentAdmin, /order\.metadata\?\.initial_booking[\s\S]*!hasActiveBookingHold/);
  assert.match(paymentAdmin, /settle_reviewed_plan_checkout_without_booking/);
});

test("agenda submits the selected lesson while Minhas Aulas stays credit-only", () => {
  assert.match(
    agenda,
    /initialBooking:[\s\S]*bookingDate: selectedDate,[\s\S]*startHour,[\s\S]*bookingType:[\s\S]*professorId: bookingProfessor/,
  );
  assert.match(agenda, /Comprar plano e reservar/);
  assert.match(agenda, /Esta vaga fica protegida enquanto o Pix estiver pendente/);
  assert.match(studentPlans, /createClassPlanPixCheckout\(\{ planId: plan\.id \}\)/);
  assert.doesNotMatch(studentPlans, /initialBooking/);
  assert.match(checkoutDialog, /plano ativado e aula reservada/i);
  assert.match(checkoutDialog, /a aula escolhida está confirmada/i);
  assert.match(checkoutDialog, /reportedPaidOrder\.current === checkout\.orderId/);
  assert.match(
    checkoutDialog,
    /reportedPaidOrder\.current = checkout\.orderId;[\s\S]*onPaid\(checkout\)/,
  );
});
