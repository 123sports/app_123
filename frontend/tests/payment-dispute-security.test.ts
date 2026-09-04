import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260904020000_payment_and_signup_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);
const reviewServer = readFileSync(
  new URL("../src/lib/payment-review.server.ts", import.meta.url),
  "utf8",
);
const adminServer = readFileSync(
  new URL("../src/lib/payments-admin.functions.ts", import.meta.url),
  "utf8",
);
const csp = readFileSync(new URL("../src/lib/security-headers.server.ts", import.meta.url), "utf8");

test("verified disputes freeze plan credits and a full chargeback revokes them", () => {
  assert.match(migration, /status IN \('active', 'under_review', 'refunded'\)/);
  assert.match(migration, /OLD\.status = 'paid'[\s\S]*NEW\.status = 'paid_needs_review'/);
  assert.match(migration, /SET status = 'under_review'/);
  assert.match(migration, /checkout_orders_18_restore_plan_credits/);
  assert.match(migration, /credit_payment_review/);
  assert.match(migration, /status IN \('active', 'under_review'\)/);
  assert.match(reviewServer, /"pending", "paid", "expired", "cancelled", "failed"/);
  assert.match(adminServer, /mappedStatus === "refunded"/);
  assert.match(adminServer, /status: "refunded"/);
});

test("refund keeps past lesson history and releases only future lessons", () => {
  assert.match(
    migration,
    /booking\.booking_date \+ make_time\(booking\.start_hour, 0, 0\)[\s\S]*AT TIME ZONE 'America\/Sao_Paulo' > now\(\)/,
  );
  assert.match(migration, /SET status = 'revoked', resolved_at = now\(\)/);
});

test("Turnstile resources are permitted by the response CSP", () => {
  assert.match(csp, /script-src[^\n]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com/);
});
