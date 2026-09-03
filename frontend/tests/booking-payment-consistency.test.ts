import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const consistencyMigration = fs.readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260903020000_booking_payment_consistency_fixes.sql",
    import.meta.url,
  ),
  "utf8",
);
const vacancyRefreshMigration = fs.readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260903030000_refresh_group_vacancy_notifications.sql",
    import.meta.url,
  ),
  "utf8",
);
const vacancyConcurrencyMigration = fs.readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260903040000_serialize_group_vacancy_refresh.sql",
    import.meta.url,
  ),
  "utf8",
);
const migration = `${consistencyMigration}\n${vacancyRefreshMigration}\n${vacancyConcurrencyMigration}`;
const paymentAdmin = fs.readFileSync(
  new URL("../src/lib/payments-admin.functions.ts", import.meta.url),
  "utf8",
);
const paymentServer = fs.readFileSync(
  new URL("../src/lib/payments.functions.ts", import.meta.url),
  "utf8",
);
const paymentClient = fs.readFileSync(new URL("../src/lib/payments.ts", import.meta.url), "utf8");
const adminBookings = fs.readFileSync(
  new URL("../src/routes/_authenticated/admin.reservas.tsx", import.meta.url),
  "utf8",
);
const studentAgenda = fs.readFileSync(
  new URL("../src/routes/_authenticated/app.agenda.tsx", import.meta.url),
  "utf8",
);
const studentPlans = fs.readFileSync(
  new URL("../src/routes/_authenticated/app.aulas.tsx", import.meta.url),
  "utf8",
);
const studentDashboard = fs.readFileSync(
  new URL("../src/routes/_authenticated/app.index.tsx", import.meta.url),
  "utf8",
);
const adminSettings = fs.readFileSync(
  new URL("../src/routes/_authenticated/admin.configuracoes.tsx", import.meta.url),
  "utf8",
);

test("future bookings are not treated as absences and attendance is time-gated", () => {
  assert.match(
    migration,
    /SET attended = NULL[\s\S]*booking_date \+ make_time\(start_hour, 0, 0\)[\s\S]*> now\(\)/i,
  );
  assert.match(migration, /CREATE TRIGGER booking_attendance_time_guard/i);
  assert.match(migration, /A presenca so pode ser registrada depois do inicio da aula/i);
  assert.match(migration, /Registre a presenca ou a falta antes de concluir a aula/i);
  assert.match(adminBookings, /bookingHasStarted\(row\)[\s\S]*row\.payment_status === "pago"/);
  assert.match(adminBookings, /canConcludeBooking\(row\)[\s\S]*row\.attended !== null/);
});

test("administrative reconciliation cannot confirm a forged payment", () => {
  assert.match(paymentAdmin, /await requireAdmin\(context\.userId\)/);
  assert.match(paymentAdmin, /getMercadoPagoPayment\(attempt\.provider_payment_id\)/);
  assert.match(paymentAdmin, /validateMercadoPagoPaymentForOrder\(payment, order\)/);
  assert.match(paymentAdmin, /mappedStatus !== "paid"/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.restore_review_booking_checkout/i);
  assert.match(migration, /COALESCE\(auth\.jwt\(\)->>'role', ''\) <> 'service_role'/i);
  assert.match(
    migration,
    /attempt\.status = 'paid'[\s\S]*attempt\.payment_method = 'pix'[\s\S]*attempt\.amount_cents = v_order\.amount_cents/i,
  );
  assert.match(migration, /O horario original nao possui mais vagas suficientes/i);
  assert.match(migration, /O horario original ja foi ocupado por outra turma/i);
});

test("group vacancy suggestions are compatible, private and idempotent", () => {
  assert.match(migration, /notifications_group_vacancy_recipient_uidx/i);
  assert.match(migration, /kind = 'group_vacancy_suggestion'/i);
  assert.match(migration, /grant_row\.modality = 'grupo'/i);
  assert.match(migration, /COALESCE\(SUM\(ledger\.credit_delta\), 0\)[\s\S]*> 0/i);
  assert.match(vacancyRefreshMigration, /booking\.status = 'confirmada'/i);
  assert.match(vacancyRefreshMigration, /booking\.payment_status = 'pago'/i);
  assert.match(vacancyConcurrencyMigration, /pg_advisory_xact_lock/i);
  assert.match(
    vacancyRefreshMigration,
    /DELETE FROM public\.notifications[\s\S]*group_vacancy_suggestion/i,
  );
  assert.match(migration, /v_occupied[\s\S]*v_session\.capacity[\s\S]*vagas ocupadas/i);
  assert.doesNotMatch(
    vacancyRefreshMigration.match(
      /CREATE OR REPLACE FUNCTION public\.refresh_group_vacancy_notifications\([\s\S]*?\$\$;/i,
    )?.[0] ?? "",
    /full_name|email|phone|cpf/i,
  );
});

test("open catalogs refresh after administrator changes", () => {
  assert.match(migration, /ADD TABLE public\.pricing/i);
  assert.match(migration, /ADD TABLE public\.class_plans/i);
  assert.match(studentAgenda, /table: "pricing"[\s\S]*loadCatalog/);
  assert.match(studentPlans, /table: "class_plans"/);
});

test("student booking uses only active class plans and keeps legacy pricing hidden", () => {
  assert.match(studentAgenda, /from\("class_plans"\)[\s\S]*eq\("active", true\)/);
  assert.match(studentAgenda, /id="booking-plan"[\s\S]*plans\.map/);
  assert.match(studentAgenda, /createClassPlanPixCheckout\(\{ planId: activePlan\.id \}\)/);
  assert.doesNotMatch(studentAgenda, /createBookingPixCheckout/);
  assert.match(studentAgenda, /\[3, 4\][\s\S]*bookingTypeForPlan\(activePlan, size\)/);
  assert.match(paymentServer, /ENABLE_DIRECT_BOOKING_PIX !== "true"/);
  assert.match(paymentClient, /VITE_ENABLE_DIRECT_BOOKING_PIX !== "true"/);
  assert.match(adminSettings, /SHOW_LEGACY_PRICING_SETTINGS = false/);
  assert.match(adminSettings, /SHOW_LEGACY_PRICING_SETTINGS && \(\s*<section/);
});

test("student views expose shared occupancy without participant identities", () => {
  assert.match(studentAgenda, /session\.occupied_seats\}\/\{session\.capacity\} ocupadas/);
  assert.match(studentAgenda, /session\.available_seats[\s\S]*restante/);
  assert.match(studentDashboard, /reservation_session_availability/);
  assert.match(studentDashboard, /b\.occupied_seats\}\/\{b\.session_capacity\} ocupadas/);
  assert.match(studentDashboard, /table: "reservation_sessions"[\s\S]*refresh/);
});

test("plan creation and later changes are audited", () => {
  assert.match(migration, /AFTER INSERT OR UPDATE ON public\.class_plans/i);
  assert.match(migration, /v_old_values jsonb := '\{\}'::jsonb/i);
  assert.match(migration, /INSERT INTO public\.class_plan_change_history/i);
});
