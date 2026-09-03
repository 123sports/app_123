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
if (!url || !secretKey) throw new Error("Missing Supabase admin configuration.");

const db = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: plans, error } = await db
  .from("class_plans")
  .select("id, title, frequency_per_week, duration_months, price_cents, active, modality")
  .order("created_at");
if (error) throw error;

const seedIds = new Set([
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
]);
const collisions = (plans ?? []).filter((plan) => seedIds.has(plan.id));
if (collisions.length) {
  throw new Error("A seeded plan ID is already used by production data.");
}

console.log(
  JSON.stringify(
    {
      existingPlans: plans?.length ?? 0,
      activePlans: (plans ?? []).filter((plan) => plan.active).map((plan) => ({
        id: plan.id,
        title: plan.title,
        price_cents: plan.price_cents,
        modality: plan.modality,
        legacy_credit_backfill: Math.min(
          100,
          Math.max(1, plan.frequency_per_week * plan.duration_months * 4),
        ),
      })),
      seededIdCollisions: collisions.length,
    },
    null,
    2,
  ),
);
console.log("PASS: current class-plan data is compatible with the credit-ledger migration.");

