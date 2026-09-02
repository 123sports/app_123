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
const createdOrderIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function deleteWhereIn(table, column, values) {
  if (!values.length) return;
  const { error } = await admin.from(table).delete().in(column, values);
  if (error) throw error;
}

async function cleanupTemporaryUsers(userIds) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;

  const [{ data: bookings, error: bookingsError }, { data: orders, error: ordersError }] =
    await Promise.all([
      admin.from("bookings").select("id, session_id").in("user_id", ids),
      admin.from("checkout_orders").select("id").in("user_id", ids),
    ]);
  if (bookingsError || ordersError) throw bookingsError || ordersError;

  const bookingIds = (bookings ?? []).map((booking) => booking.id);
  const sessionIds = [
    ...new Set((bookings ?? []).map((booking) => booking.session_id).filter(Boolean)),
  ];
  const orderIds = (orders ?? []).map((order) => order.id);

  // Payment notifications can belong to a real admin, so remove them by test
  // booking/order reference before deleting the temporary financial chain.
  await deleteWhereIn("notifications", "related_booking_id", bookingIds);
  await deleteWhereIn("notifications", "related_checkout_order_id", orderIds);
  await deleteWhereIn("notifications", "user_id", ids);
  await deleteWhereIn("booking_reschedules", "booking_id", bookingIds);
  await deleteWhereIn("bookings", "id", bookingIds);
  await deleteWhereIn("checkout_orders", "id", orderIds);
  await deleteWhereIn("reservation_sessions", "id", sessionIds);

  for (const userId of ids) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
  }
}

async function cleanupStaleTemporaryUsers() {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (error) throw error;
  const staleIds = (data.users ?? [])
    .filter((user) => user.email?.startsWith("shared-session-"))
    .map((user) => user.id);
  await cleanupTemporaryUsers(staleIds);
}

async function createUser(label) {
  const email = `shared-session-${label}-${crypto.randomUUID()}@example.com`;
  const password = `Test-${crypto.randomBytes(18).toString("hex")}!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Session ${label}` },
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

function isoDateFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function findFreeSlots(count) {
  for (let days = 7; days <= 30; days += 1) {
    const date = isoDateFromNow(days);
    const [{ data: sessions }, { data: blocks }] = await Promise.all([
      admin
        .from("reservation_sessions")
        .select("start_hour")
        .eq("booking_date", date)
        .eq("status", "open"),
      admin.from("blocked_slots").select("start_hour").eq("block_date", date),
    ]);
    const unavailable = new Set([
      ...(sessions ?? []).map((row) => row.start_hour),
      ...(blocks ?? []).map((row) => row.start_hour),
    ]);
    const hours = Array.from({ length: 17 }, (_, index) => index + 6).filter(
      (hour) => !unavailable.has(hour),
    );
    if (hours.length >= count) return { date, hours: hours.slice(0, count) };
  }
  throw new Error("No free schedule found for the shared-session test.");
}

async function createHold(userId, date, hour, bookingType, professorId) {
  const result = await admin.rpc("create_booking_checkout_hold", {
    p_user_id: userId,
    p_booking_date: date,
    p_hours: [hour],
    p_booking_type: bookingType,
    p_professor_id: professorId,
  });
  if (!result.error && result.data?.order_id) createdOrderIds.push(result.data.order_id);
  return result;
}

await cleanupStaleTemporaryUsers();

try {
  const professor = await createUser("professor");
  const adminUser = await createUser("admin");
  const students = await Promise.all([
    createUser("student-a"),
    createUser("student-b"),
    createUser("student-c"),
    createUser("student-d"),
  ]);
  const { error: roleError } = await admin
    .from("user_roles")
    .update({ role: "professor" })
    .eq("user_id", professor.id);
  if (roleError) throw roleError;
  const { error: adminRoleError } = await admin
    .from("user_roles")
    .update({ role: "admin" })
    .eq("user_id", adminUser.id);
  if (adminRoleError) throw adminRoleError;

  const { data: trioPrice, error: priceError } = await admin
    .from("pricing")
    .select("id, price_cents")
    .eq("booking_type", "aula_trio")
    .single();
  if (priceError) throw priceError;

  const { error: legitimatePriceUpdateError } = await adminUser.client
    .from("pricing")
    .update({ price_cents: trioPrice.price_cents })
    .eq("id", trioPrice.id);
  if (legitimatePriceUpdateError) {
    throw new Error(`Admin price update was rejected: ${legitimatePriceUpdateError.message}`);
  }

  const groupSlot = await findFreeSlots(2);
  const first = await createHold(
    students[0].id,
    groupSlot.date,
    groupSlot.hours[0],
    "aula_trio",
    professor.id,
  );
  const second = await createHold(
    students[1].id,
    groupSlot.date,
    groupSlot.hours[0],
    "aula_trio",
    professor.id,
  );
  const third = await createHold(
    students[2].id,
    groupSlot.date,
    groupSlot.hours[0],
    "aula_trio",
    professor.id,
  );
  if (first.error || second.error || third.error) throw first.error || second.error || third.error;

  const sessionId = first.data.session_ids[0];
  assert(
    second.data.session_ids[0] === sessionId && third.data.session_ids[0] === sessionId,
    "Students were not assigned to the same session.",
  );
  assert(
    first.data.amount_cents === trioPrice.price_cents,
    "The server did not use the configured per-student price.",
  );

  const pendingBookingIds = [
    first.data.booking_ids[0],
    second.data.booking_ids[0],
    third.data.booking_ids[0],
  ];
  const { data: prematureNotifications, error: prematureNotificationError } = await admin
    .from("notifications")
    .select("id")
    .in("related_booking_id", pendingBookingIds);
  if (prematureNotificationError) throw prematureNotificationError;
  assert(
    prematureNotifications.length === 0,
    "An unpaid Pix hold generated a reservation notification.",
  );

  const paidAttemptId = `SHARED-${crypto.randomUUID()}`;
  const { error: paidAttemptError } = await admin.from("payment_attempts").insert({
    checkout_order_id: first.data.order_id,
    provider: "local",
    provider_payment_id: paidAttemptId,
    payment_method: "pix",
    status: "paid",
    amount_cents: first.data.amount_cents,
  });
  if (paidAttemptError) throw paidAttemptError;
  const { error: paidOrderError } = await admin
    .from("checkout_orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", first.data.order_id);
  if (paidOrderError) throw paidOrderError;

  const { data: paidBooking, error: paidBookingError } = await admin
    .from("bookings")
    .select("status, payment_status, session_id")
    .eq("id", first.data.booking_ids[0])
    .single();
  if (paidBookingError) throw paidBookingError;
  assert(
    paidBooking.status === "confirmada" &&
      paidBooking.payment_status === "pago" &&
      paidBooking.session_id === sessionId,
    "A paid group seat was not confirmed in its session.",
  );

  const [studentNotificationResult, adminNotificationResult] = await Promise.all([
    admin
      .from("notifications")
      .select("title, body, kind")
      .eq("user_id", students[0].id)
      .eq("related_booking_id", first.data.booking_ids[0]),
    admin
      .from("notifications")
      .select("title, body, kind")
      .eq("user_id", adminUser.id)
      .eq("related_booking_id", first.data.booking_ids[0]),
  ]);
  if (studentNotificationResult.error || adminNotificationResult.error) {
    throw studentNotificationResult.error || adminNotificationResult.error;
  }
  const studentNotifications = studentNotificationResult.data;
  const adminNotifications = adminNotificationResult.data;
  assert(
    studentNotifications?.filter((notification) => notification.kind === "booking_confirmed")
      .length === 1,
    "The student did not receive exactly one friendly payment confirmation.",
  );
  assert(
    adminNotifications?.filter((notification) => notification.kind === "payment_paid").length === 1,
    "The admin did not receive exactly one payment confirmation.",
  );

  const fullAttempt = await createHold(
    students[3].id,
    groupSlot.date,
    groupSlot.hours[0],
    "aula_trio",
    professor.id,
  );
  assert(fullAttempt.error, "A fourth student entered a three-seat session.");
  const duplicateAttempt = await createHold(
    students[0].id,
    groupSlot.date,
    groupSlot.hours[0],
    "aula_trio",
    professor.id,
  );
  assert(duplicateAttempt.error, "A student reserved the same session twice.");
  const conflictingProduct = await createHold(
    students[3].id,
    groupSlot.date,
    groupSlot.hours[0],
    "aula_individual",
    professor.id,
  );
  assert(conflictingProduct.error, "A different product was accepted in an occupied slot.");

  const { data: studentView, error: viewError } = await students[0].client
    .from("reservation_session_availability")
    .select("*")
    .eq("session_id", sessionId)
    .single();
  if (viewError) throw viewError;
  assert(
    studentView.occupied_seats === 3 && studentView.available_seats === 0,
    "The safe availability view reports the wrong capacity.",
  );
  assert(
    studentView.my_booking_id === first.data.booking_ids[0],
    "The view did not expose the caller's own booking.",
  );
  assert(
    !Object.hasOwn(studentView, "user_id"),
    "The availability view exposes participant identity.",
  );

  const { data: visibleBookings, error: bookingReadError } = await students[0].client
    .from("bookings")
    .select("id, user_id")
    .eq("session_id", sessionId);
  if (bookingReadError) throw bookingReadError;
  assert(
    visibleBookings.length === 1 && visibleBookings[0].user_id === students[0].id,
    "A student can read another participant's booking.",
  );

  const { error: forgedSessionError } = await students[0].client
    .from("reservation_sessions")
    .insert({
      booking_date: groupSlot.date,
      start_hour: groupSlot.hours[1],
      professor_id: professor.id,
      product_type: "aula_trio",
      capacity: 99,
      unit_price_cents: 1,
    });
  assert(forgedSessionError, "A browser client can create a forged session.");

  const { error: productDefinitionError } = await adminUser.client
    .from("pricing")
    .update({ student_capacity: 4 })
    .eq("id", trioPrice.id);
  assert(productDefinitionError, "An admin browser can change a fixed product capacity.");

  const { error: linkedBookingDeleteError } = await adminUser.client
    .from("bookings")
    .delete()
    .eq("id", first.data.booking_ids[0]);
  assert(linkedBookingDeleteError, "An admin browser can delete a provider-linked booking.");

  const { error: forgedBookingAmountError } = await students[0].client
    .from("bookings")
    .update({ amount_cents: 1, payment_status: "pago" })
    .eq("id", first.data.booking_ids[0]);
  assert(forgedBookingAmountError, "A student browser can forge a paid booking amount.");

  const { data: changedPrice, error: changedPriceError } = await students[0].client
    .from("pricing")
    .update({ price_cents: 1 })
    .eq("id", trioPrice.id)
    .select("id");
  const { data: unchangedPrice } = await admin
    .from("pricing")
    .select("price_cents")
    .eq("id", trioPrice.id)
    .single();
  assert(changedPriceError || changedPrice.length === 0, "A student can update product pricing.");
  assert(
    unchangedPrice.price_cents === trioPrice.price_cents,
    "A browser price-tampering attempt changed the server price.",
  );

  const { error: cancelError } = await admin.rpc("cancel_booking_checkout", {
    p_order_id: second.data.order_id,
    p_user_id: students[1].id,
  });
  if (cancelError) throw cancelError;
  const replacement = await createHold(
    students[3].id,
    groupSlot.date,
    groupSlot.hours[0],
    "aula_trio",
    professor.id,
  );
  if (replacement.error) throw replacement.error;
  assert(
    replacement.data.session_ids[0] === sessionId,
    "A released seat did not return to the same session.",
  );

  const concurrentSlot = groupSlot.hours[1];
  const initialDouble = await createHold(
    students[0].id,
    groupSlot.date,
    concurrentSlot,
    "aula_dupla",
    professor.id,
  );
  if (initialDouble.error) throw initialDouble.error;
  const concurrent = await Promise.all([
    createHold(students[1].id, groupSlot.date, concurrentSlot, "aula_dupla", professor.id),
    createHold(students[2].id, groupSlot.date, concurrentSlot, "aula_dupla", professor.id),
  ]);
  assert(
    concurrent.filter((result) => !result.error).length === 1,
    "Concurrent requests oversold the final seat.",
  );

  console.log("PASS: shared sessions enforce product, professor and capacity.");
  console.log("PASS: prices are server-owned and snapshotted per session.");
  console.log("PASS: a paid seat is finalized once and notifies student and admin once.");
  console.log("PASS: fixed product definitions and payment history resist browser changes.");
  console.log("PASS: participant identities remain isolated by RLS.");
  console.log("PASS: cancellation releases one seat and concurrent checkout cannot oversell.");
} finally {
  for (const orderId of [...new Set(createdOrderIds)].reverse()) {
    const { data: order } = await admin
      .from("checkout_orders")
      .select("user_id, status")
      .eq("id", orderId)
      .maybeSingle();
    if (order?.status === "pending") {
      await admin.rpc("cancel_booking_checkout", { p_order_id: orderId, p_user_id: order.user_id });
    }
  }
  await cleanupTemporaryUsers(createdUserIds);
}
