import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const raw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [
        line.slice(0, separator).trim(),
        line
          .slice(separator + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ""),
      ];
    }),
);

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !publishableKey || !secretKey) {
  throw new Error("Missing Supabase test configuration in frontend/.env.local.");
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const createdUserIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createTemporaryUser(label) {
  const suffix = crypto.randomUUID();
  const email = `security-${label}-${suffix}@example.com`;
  const password = `Audit-${crypto.randomBytes(16).toString("hex")}!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Security ${label}` },
  });
  if (error || !data.user) throw error ?? new Error("Temporary user was not created.");
  createdUserIds.push(data.user.id);

  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

async function removeTemporaryUser(userId) {
  const ownedRows = [
    ["notifications", "user_id"],
    ["booking_reschedules", "user_id"],
    ["bookings", "user_id"],
    ["checkout_orders", "user_id"],
  ];
  for (const [table, column] of ownedRows) {
    const { error } = await admin.from(table).delete().eq(column, userId);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
}

function isoDateFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function findFreeHours(count) {
  for (let days = 7; days <= 30; days += 1) {
    const date = isoDateFromNow(days);
    const [{ data: bookings }, { data: blocks }] = await Promise.all([
      admin
        .from("bookings")
        .select("start_hour")
        .eq("booking_date", date)
        .neq("status", "cancelada"),
      admin.from("blocked_slots").select("start_hour").eq("block_date", date),
    ]);
    const unavailable = new Set([
      ...(bookings ?? []).map((row) => row.start_hour),
      ...(blocks ?? []).map((row) => row.start_hour),
    ]);
    const hours = Array.from({ length: 17 }, (_, index) => index + 6).filter(
      (hour) => !unavailable.has(hour),
    );
    if (hours.length >= count) return { date, hours: hours.slice(0, count) };
  }
  throw new Error("No free schedule found for the security test.");
}

async function createHold(userId, count) {
  const slot = await findFreeHours(count);
  const { data, error } = await admin.rpc("create_booking_checkout_hold", {
    p_user_id: userId,
    p_booking_date: slot.date,
    p_hours: slot.hours,
    p_booking_type: "teste",
    p_professor_id: null,
  });
  if (error) throw error;
  return data;
}

try {
  const { data: storedAttempts, error: storedAttemptsError } = await admin
    .from("payment_attempts")
    .select("provider, provider_payload")
    .eq("provider", "mercado_pago")
    .limit(1_000);
  if (storedAttemptsError) throw storedAttemptsError;
  for (const attempt of storedAttempts ?? []) {
    const payload = attempt.provider_payload ?? {};
    assert(!payload.payer, "A stored Mercado Pago payload still contains payer PII.");
    assert(!payload.point_of_interaction, "A stored provider payload duplicates Pix credentials.");
    assert(
      !payload.additional_info,
      "A stored provider payload contains unnecessary customer data.",
    );
  }

  const { data: existingPaidOrders, error: existingPaidOrdersError } = await admin
    .from("checkout_orders")
    .select("id, amount_cents")
    .eq("kind", "booking")
    .eq("status", "paid")
    .limit(1_000);
  if (existingPaidOrdersError) throw existingPaidOrdersError;
  for (const order of existingPaidOrders ?? []) {
    const [{ data: items }, { data: bookings }, { data: attempts }] = await Promise.all([
      admin.from("checkout_items").select("total_amount_cents").eq("checkout_order_id", order.id),
      admin
        .from("bookings")
        .select("amount_cents, status, payment_status")
        .eq("checkout_order_id", order.id),
      admin
        .from("payment_attempts")
        .select("status, amount_cents")
        .eq("checkout_order_id", order.id),
    ]);
    assert(
      (items ?? []).reduce((sum, item) => sum + Number(item.total_amount_cents ?? 0), 0) ===
        order.amount_cents,
      `Paid order ${order.id} has inconsistent item totals.`,
    );
    assert(
      (bookings ?? []).reduce((sum, booking) => sum + Number(booking.amount_cents ?? 0), 0) ===
        order.amount_cents &&
        (bookings ?? []).every(
          (booking) =>
            booking.payment_status === "pago" &&
            ["confirmada", "concluida"].includes(booking.status),
        ),
      `Paid order ${order.id} has inconsistent bookings.`,
    );
    assert(
      (attempts ?? []).some(
        (attempt) => attempt.status === "paid" && attempt.amount_cents === order.amount_cents,
      ),
      `Paid order ${order.id} has no matching paid attempt.`,
    );
  }

  const owner = await createTemporaryUser("owner");
  const outsider = await createTemporaryUser("outsider");

  const forgedSlot = await findFreeHours(1);
  const { error: forgedBookingError } = await owner.client.from("bookings").insert({
    user_id: owner.id,
    booking_date: forgedSlot.date,
    start_hour: forgedSlot.hours[0],
    duration_hours: 1,
    type: "quadra_livre",
    status: "confirmada",
    payment_status: "pago",
    payment_method: "pix",
    price_cents: 100,
    amount_cents: 100,
    attended: false,
  });
  assert(forgedBookingError, "A student can insert a paid booking without checkout.");

  const { error: forgedOrderError } = await owner.client.from("checkout_orders").insert({
    user_id: owner.id,
    kind: "booking",
    status: "paid",
    currency: "BRL",
    amount_cents: 100,
    description: "Forged browser order",
    provider: "mercado_pago",
  });
  assert(forgedOrderError, "A student can insert a forged paid checkout order.");

  const { data: leakedProfile, error: profileError } = await owner.client
    .from("profiles")
    .select("id, cpf, phone, address")
    .eq("id", outsider.id)
    .maybeSingle();
  if (profileError) throw profileError;
  assert(!leakedProfile, "A student can read another student's private profile.");

  const paidHold = await createHold(owner.id, 1);
  const paymentId = `AUDIT-${crypto.randomUUID()}`;
  const { error: paidAttemptError } = await admin.from("payment_attempts").insert({
    checkout_order_id: paidHold.order_id,
    provider: "local",
    provider_payment_id: paymentId,
    payment_method: "pix",
    status: "paid",
    amount_cents: paidHold.amount_cents,
    provider_payload: {
      id: paymentId,
      payer: { email: "must-not-leak@example.com", identification: { number: "00000000000" } },
    },
  });
  if (paidAttemptError) throw paidAttemptError;

  const { error: forgedAttemptError } = await owner.client.from("payment_attempts").insert({
    checkout_order_id: paidHold.order_id,
    provider: "mercado_pago",
    provider_payment_id: `FORGED-${crypto.randomUUID()}`,
    payment_method: "pix",
    status: "paid",
    amount_cents: paidHold.amount_cents,
  });
  assert(forgedAttemptError, "A student can insert a forged paid payment attempt.");

  const { error: rawPayloadError } = await owner.client
    .from("payment_attempts")
    .select("provider_payload")
    .eq("checkout_order_id", paidHold.order_id);
  assert(rawPayloadError, "An authenticated browser can select the raw provider payload.");

  const { data: ownerAttempt, error: ownerAttemptError } = await owner.client
    .from("payment_attempts")
    .select("id, checkout_order_id, status, amount_cents")
    .eq("checkout_order_id", paidHold.order_id)
    .maybeSingle();
  if (ownerAttemptError) throw ownerAttemptError;
  assert(ownerAttempt?.status === "paid", "The owner cannot read the sanitized payment attempt.");

  const { data: outsiderAttempt, error: outsiderAttemptError } = await outsider.client
    .from("payment_attempts")
    .select("id, checkout_order_id, status, amount_cents")
    .eq("checkout_order_id", paidHold.order_id);
  if (outsiderAttemptError) throw outsiderAttemptError;
  assert(outsiderAttempt.length === 0, "Another student can read a payment attempt.");

  const { error: payOrderError } = await admin
    .from("checkout_orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", paidHold.order_id);
  if (payOrderError) throw payOrderError;

  const { error: regressionError } = await admin
    .from("checkout_orders")
    .update({ status: "pending" })
    .eq("id", paidHold.order_id);
  assert(regressionError, "A paid order can regress to pending.");

  const { error: refundError } = await admin
    .from("checkout_orders")
    .update({ status: "refunded", refunded_at: new Date().toISOString() })
    .eq("id", paidHold.order_id);
  if (refundError) throw refundError;
  const { data: refundedBooking, error: refundedBookingError } = await admin
    .from("bookings")
    .select("status, payment_status")
    .eq("checkout_order_id", paidHold.order_id)
    .single();
  if (refundedBookingError) throw refundedBookingError;
  assert(
    refundedBooking.status === "cancelada" && refundedBooking.payment_status === "estornado",
    "A refunded payment leaves the future booking active.",
  );

  const partialHold = await createHold(owner.id, 2);
  const { error: partialAttemptError } = await admin.from("payment_attempts").insert({
    checkout_order_id: partialHold.order_id,
    provider: "local",
    provider_payment_id: `AUDIT-${crypto.randomUUID()}`,
    payment_method: "pix",
    status: "paid",
    amount_cents: partialHold.amount_cents,
  });
  if (partialAttemptError) throw partialAttemptError;
  const { error: partialCancelError } = await admin
    .from("bookings")
    .update({ status: "cancelada" })
    .eq("id", partialHold.booking_ids[0]);
  if (partialCancelError) throw partialCancelError;
  const { error: incompletePaymentError } = await admin
    .from("checkout_orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", partialHold.order_id);
  assert(incompletePaymentError, "An incomplete multi-slot checkout can be confirmed as paid.");

  const linkedBookingId = partialHold.booking_ids[1];
  const { error: browserCancelError } = await owner.client
    .from("bookings")
    .update({ status: "cancelada" })
    .eq("id", linkedBookingId);
  assert(browserCancelError, "A student can cancel only one slot from a pending checkout.");

  for (let index = 0; index < 10; index += 1) {
    const { error } = await admin.from("checkout_orders").insert({
      user_id: outsider.id,
      kind: "class_plan",
      status: "pending",
      currency: "BRL",
      amount_cents: 100,
      description: `Rate limit audit ${index}`,
      provider: "local",
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    if (error) throw error;
  }
  const { error: rateLimitError } = await admin.from("checkout_orders").insert({
    user_id: outsider.id,
    kind: "class_plan",
    status: "pending",
    currency: "BRL",
    amount_cents: 100,
    description: "Rate limit audit blocked",
    provider: "local",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  assert(rateLimitError, "The checkout creation rate limit was not enforced.");

  console.log("PASS: private profiles and raw provider payloads are not exposed.");
  console.log("PASS: browser clients cannot forge bookings, orders or payment attempts.");
  console.log("PASS: existing provider payloads and paid orders are internally consistent.");
  console.log("PASS: payment attempts remain isolated by owner.");
  console.log("PASS: paid states cannot regress and refunds release future bookings.");
  console.log("PASS: incomplete multi-slot payments cannot be finalized.");
  console.log("PASS: partial browser cancellation and checkout flooding are blocked.");
} finally {
  for (const userId of createdUserIds.reverse()) {
    try {
      await removeTemporaryUser(userId);
    } catch (error) {
      console.error(
        `WARN: failed to remove temporary user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
