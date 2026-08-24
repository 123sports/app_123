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
      const key = line.slice(0, separator).trim();
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      return [key, value];
    }),
);

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !publishableKey || !secretKey) {
  throw new Error("Missing Supabase test configuration in frontend/.env.local.");
}

const client = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error } = await client.rpc("reschedule_paid_booking", {
  p_user_id: crypto.randomUUID(),
  p_booking_id: crypto.randomUUID(),
  p_new_booking_date: "2026-08-25",
  p_new_start_hour: 15,
});

if (!error) {
  throw new Error("Security failure: anonymous RPC execution was accepted.");
}
if (error.code !== "42501" && !/permission denied/i.test(error.message)) {
  throw error;
}

console.log("PASS: anonymous direct RPC execution was denied by PostgreSQL.");

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: globalBlocks, error: globalBlocksError } = await admin
  .from("blocked_slots")
  .select("block_date, start_hour")
  .is("professor_id", null);
if (globalBlocksError) throw globalBlocksError;
const globalBlockKeys = (globalBlocks ?? []).map(
  (block) => `${block.block_date}:${block.start_hour}`,
);
if (new Set(globalBlockKeys).size !== globalBlockKeys.length) {
  throw new Error("Duplicate global blocked slots must be resolved before migration.");
}
console.log("PASS: existing global blocked slots contain no duplicates.");

const { error: missingBookingError } = await admin.rpc("reschedule_paid_booking", {
  p_user_id: crypto.randomUUID(),
  p_booking_id: crypto.randomUUID(),
  p_new_booking_date: "2026-08-25",
  p_new_start_hour: 15,
});
if (!missingBookingError || !/reserva nao encontrada/i.test(missingBookingError.message)) {
  throw missingBookingError ?? new Error("Service RPC did not enforce booking ownership.");
}
console.log("PASS: server RPC enforced booking ownership for an unknown booking.");

const { data: paidBooking, error: paidBookingError } = await admin
  .from("bookings")
  .select("id, user_id, booking_date, start_hour")
  .eq("status", "confirmada")
  .eq("payment_status", "pago")
  .not("checkout_order_id", "is", null)
  .limit(1)
  .maybeSingle();
if (paidBookingError) throw paidBookingError;

if (paidBooking) {
  const { data: idempotentResult, error: paidChainError } = await admin.rpc(
    "reschedule_paid_booking",
    {
      p_user_id: paidBooking.user_id,
      p_booking_id: paidBooking.id,
      p_new_booking_date: paidBooking.booking_date,
      p_new_start_hour: paidBooking.start_hour,
    },
  );
  if (paidChainError && !/escolha um horario diferente/i.test(paidChainError.message)) {
    throw paidChainError;
  }
  if (idempotentResult && idempotentResult.booking_id !== paidBooking.id) {
    throw new Error("Idempotent RPC returned a different booking.");
  }
  console.log("PASS: a real paid booking passed the payment ownership checks without mutation.");
} else {
  console.log(
    "SKIP: no paid production booking was available for the read-only payment-chain check.",
  );
}
