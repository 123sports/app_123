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
  .select(
    "id, title, frequency_per_week, duration_months, price_cents, active, modality, credit_modality, credit_quantity",
  )
  .order("created_at");
if (error) throw error;

const seededPlans = new Map([
  ["10000000-0000-4000-8000-000000000001", ["Grupo mensal", 29000, "grupo", 4]],
  ["10000000-0000-4000-8000-000000000002", ["Grupo trimestral", 78000, "grupo", 12]],
  ["10000000-0000-4000-8000-000000000003", ["Grupo semestral", 138000, "grupo", 24]],
  ["20000000-0000-4000-8000-000000000001", ["Individual avulsa", 25000, "individual", 1]],
  ["20000000-0000-4000-8000-000000000002", ["Individual mensal", 90000, "individual", 4]],
  ["20000000-0000-4000-8000-000000000003", ["Individual trimestral", 240000, "individual", 12]],
  ["20000000-0000-4000-8000-000000000004", ["Individual semestral", 450000, "individual", 24]],
  ["30000000-0000-4000-8000-000000000001", ["Dupla mensal", 50000, "dupla", 4]],
  ["30000000-0000-4000-8000-000000000002", ["Dupla trimestral", 135000, "dupla", 12]],
]);
const collisions = (plans ?? []).filter((plan) => {
  const expected = seededPlans.get(plan.id);
  if (!expected) return false;
  return (
    plan.title !== expected[0] ||
    plan.price_cents !== expected[1] ||
    plan.credit_modality !== expected[2] ||
    plan.credit_quantity !== expected[3]
  );
});
if (collisions.length) {
  throw new Error("A seeded plan ID is used by data that does not match the expected catalog.");
}

console.log(
  JSON.stringify(
    {
      existingPlans: plans?.length ?? 0,
      activePlans: (plans ?? [])
        .filter((plan) => plan.active)
        .map((plan) => ({
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
      installedSeedPlans: (plans ?? []).filter((plan) => seededPlans.has(plan.id)).length,
    },
    null,
    2,
  ),
);
console.log("PASS: current class-plan data is compatible with the credit-ledger migration.");
