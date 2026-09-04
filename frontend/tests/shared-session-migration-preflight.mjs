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
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, "")];
    }),
);

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secretKey) throw new Error("Missing Supabase admin configuration.");

const db = createClient(url, secretKey, { auth: { persistSession: false } });
const [{ data: bookings, error: bookingError }, { data: pricing, error: pricingError }] =
  await Promise.all([
    db
      .from("bookings")
      .select(
        "id, booking_date, start_hour, type, professor_id, status, payment_status, hold_expires_at, amount_cents, price_cents, credit_grant_id",
      )
      .in("status", ["pendente", "confirmada"]),
    db.from("pricing").select("booking_type, price_cents"),
  ]);
if (bookingError || pricingError) throw bookingError || pricingError;

const now = Date.now();
const activeBookings = (bookings ?? []).filter(
  (booking) =>
    booking.payment_status === "pago" ||
    booking.status === "confirmada" ||
    (booking.payment_status === "pendente" &&
      booking.hold_expires_at &&
      new Date(booking.hold_expires_at).getTime() > now),
);

const classesWithoutProfessor = activeBookings.filter(
  (booking) => !["quadra_livre", "teste"].includes(booking.type) && !booking.professor_id,
);
const invalidPrices = (pricing ?? []).filter((product) => product.price_cents <= 0);
const invalidBookingAmounts = activeBookings.filter(
  (booking) =>
    !booking.credit_grant_id &&
    Math.max(booking.amount_cents ?? 0, booking.price_cents ?? 0) <= 0,
);
const slotCounts = new Map();
for (const booking of activeBookings) {
  const slot = `${booking.booking_date}:${booking.start_hour}`;
  slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
}
const duplicateSlots = [...slotCounts.entries()].filter(([, count]) => count > 1);

console.log(
  JSON.stringify(
    {
      activeBookings: activeBookings.length,
      classesWithoutProfessor: classesWithoutProfessor.length,
      invalidPrices: invalidPrices.length,
      invalidBookingAmounts: invalidBookingAmounts.length,
      duplicateActiveSlots: duplicateSlots.length,
    },
    null,
    2,
  ),
);

if (
  classesWithoutProfessor.length ||
  invalidPrices.length ||
  invalidBookingAmounts.length ||
  duplicateSlots.length
) {
  throw new Error(
    "Production data needs correction before the shared-session migration can be applied.",
  );
}
console.log("PASS: current production data is compatible with the shared-session migration.");
