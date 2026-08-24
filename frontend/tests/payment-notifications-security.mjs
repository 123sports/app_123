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
const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secretKey) {
  throw new Error("Missing Supabase test configuration in frontend/.env.local.");
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [{ data: notifications, error: notificationError }, { data: paidOrders, error: orderError }] =
  await Promise.all([
    admin.from("notifications").select("user_id, title, body, kind").limit(1_000),
    admin
      .from("checkout_orders")
      .select("user_id, description")
      .eq("status", "paid")
      .limit(1_000),
  ]);
if (notificationError) throw notificationError;
if (orderError) throw orderError;

const legacyTechnicalCopy = (notifications ?? []).filter(
  (notification) =>
    notification.title === "Pagamento requer conferencia" ||
    /conferir manualmente|^Pedido [0-9a-f-]{36}:/i.test(notification.body ?? ""),
);
if (legacyTechnicalCopy.length) {
  throw new Error("Legacy technical payment notifications are still visible.");
}

const duplicateTeamCopy = (notifications ?? []).filter(
  (notification) =>
    notification.kind === "payment_paid" &&
    (paidOrders ?? []).some(
      (order) =>
        order.user_id === notification.user_id &&
        notification.body?.includes(order.description),
    ),
);
if (duplicateTeamCopy.length) {
  throw new Error("A payer who is also an admin still has duplicate payment notifications.");
}

console.log("PASS: payment notifications contain no legacy technical copy.");
console.log("PASS: admin/student accounts contain no duplicate payment confirmation.");
