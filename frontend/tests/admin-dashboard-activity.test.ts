import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260904030000_admin_dashboard_activity.sql",
    import.meta.url,
  ),
  "utf8",
);
const dashboard = readFileSync(
  new URL("../src/routes/_authenticated/admin.index.tsx", import.meta.url),
  "utf8",
);
const adminPayments = readFileSync(
  new URL("../src/lib/payments-admin.functions.ts", import.meta.url),
  "utf8",
);
const notificationBell = readFileSync(
  new URL("../src/components/NotificationsBell.tsx", import.meta.url),
  "utf8",
);

test("checkout lifecycle notifications are generated on the backend without blocking payment", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.notify_staff_checkout_activity\(\)/i);
  assert.match(migration, /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public/i);
  assert.match(migration, /AFTER INSERT OR UPDATE OF status ON public\.checkout_orders/i);
  assert.match(migration, /EXCEPTION WHEN OTHERS[\s\S]*RAISE WARNING/i);
  assert.match(migration, /ON CONFLICT DO NOTHING/i);
  assert.match(
    migration,
    /REVOKE EXECUTE ON FUNCTION public\.notify_staff_checkout_activity\(\)[\s\S]*PUBLIC, anon, authenticated, service_role/i,
  );
});

test("staff activity reaches only administrators and the assigned professor", () => {
  assert.match(
    migration,
    /FROM public\.user_roles role_row[\s\S]*role_row\.role = 'admin'[\s\S]*SELECT v_professor_id/i,
  );
  assert.match(migration, /WHERE recipient\.user_id <> NEW\.user_id/i);
  assert.match(
    migration,
    /notifications_checkout_activity_recipient_uidx[\s\S]*user_id, kind, related_checkout_order_id/i,
  );
});

test("every non-paid Pix outcome needed by the operational feed has friendly copy", () => {
  for (const kind of [
    "payment_pending",
    "payment_expired",
    "payment_cancelled",
    "payment_failed",
    "payment_refunded",
  ]) {
    assert.match(migration, new RegExp(`'${kind}'`));
  }
  assert.match(migration, /horário liberado/i);
  assert.match(migration, /vaga está disponível novamente/i);
  assert.match(migration, /Pagamento estornado/i);
});

test("terminal plan checkout states release their provisional booking immediately", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.apply_terminal_checkout_to_bookings\(\)[\s\S]*NEW\.kind IN \('booking', 'class_plan'\)/i,
  );
  assert.match(
    migration,
    /NEW\.status IN \('expired', 'cancelled', 'failed'\)[\s\S]*SET status = 'cancelada'[\s\S]*hold_expires_at = NULL/i,
  );
  assert.doesNotMatch(
    migration,
    /INSERT INTO public\.notifications[\s\S]*FROM public\.user_roles[\s\S]*'payment_refunded'/i,
  );
});

test("activity extraction supports plan and direct-booking checkout metadata", () => {
  assert.match(migration, /\{initial_booking,booking_date\}[\s\S]*metadata->>'booking_date'/i);
  assert.match(migration, /\{initial_booking,start_hour\}[\s\S]*metadata->'hours'->>0/i);
});

test("dashboard feed is scoped to the logged-in staff member", () => {
  assert.match(
    dashboard,
    /\.from\("notifications"\)[\s\S]*?\.eq\("user_id", userId\)[\s\S]*?\.in\("kind", ACTIVITY_KINDS\)/,
  );
  assert.match(dashboard, /filter: `user_id=eq\.\$\{userId\}`/);
  assert.match(dashboard, /Movimentações recentes/);
  assert.match(dashboard, /Agenda de hoje/);
  assert.match(dashboard, /Pix em andamento/);
});

test("dashboard does not silently replace query failures with empty financial data", () => {
  assert.match(dashboard, /results\.find\(\(result\) => result\.error\)\?\.error/);
  assert.match(dashboard, /requestId !== latestRequest/);
  assert.match(dashboard, /Os dados exibidos podem estar desatualizados/);
});

test("opening the dashboard materializes expired Pix events through an admin-only server call", () => {
  assert.match(
    adminPayments,
    /refreshAdminPaymentActivityServer[\s\S]*middleware\(\[requireSupabaseAuth\]\)[\s\S]*await requireAdmin\(context\.userId\)/,
  );
  assert.match(adminPayments, /\.rpc\("cleanup_expired_booking_holds"\)/);
  assert.match(dashboard, /await refreshAdminPaymentActivityServer\(\)/);
  assert.match(dashboard, /window\.setInterval\(\(\) => void refresh\(\), 60_000\)/);
});

test("financial totals and agenda are read from authoritative domain tables", () => {
  assert.match(
    dashboard,
    /\.from\("checkout_orders"\)[\s\S]*?\.eq\("status", "paid"\)[\s\S]*?\.gte\("paid_at", paidFrom\)/,
  );
  assert.match(
    dashboard,
    /\.from\("bookings"\)[\s\S]*?\.in\("status", \["confirmada", "concluida"\]\)[\s\S]*?\.eq\("payment_status", "pago"\)/,
  );
  assert.doesNotMatch(dashboard, /pixRevenue\s*=\s*activities/);
});

test("terminal Pix problems use the platform warning notification", () => {
  for (const kind of [
    "payment_review",
    "payment_expired",
    "payment_cancelled",
    "payment_failed",
    "payment_refunded",
  ]) {
    assert.match(notificationBell, new RegExp(`n\\.kind === "${kind}"`));
  }
  assert.match(notificationBell, /toast\.warning\(n\.title/);
});
