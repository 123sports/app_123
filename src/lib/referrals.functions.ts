import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const codeSchema = z.object({
  code: z.string().trim().min(4).max(16).regex(/^[A-Z0-9]+$/i),
});

export const getReferralInfo = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => codeSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.toUpperCase();

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .eq("referral_code", code)
      .maybeSingle();

    if (!profile) {
      return { valid: false as const };
    }

    const [{ data: rewards }, { data: settings }] = await Promise.all([
      supabaseAdmin
        .from("referral_rewards")
        .select("min_referrals, discount_percent, label")
        .eq("active", true)
        .order("min_referrals"),
      supabaseAdmin
        .from("site_settings")
        .select("key, value")
        .in("key", ["referral_welcome_title", "referral_welcome_bonus"]),
    ]);

    const settingsMap = Object.fromEntries((settings ?? []).map((s: any) => [s.key, s.value]));

    return {
      valid: true as const,
      code,
      inviter_name: profile.full_name ?? "Um amigo",
      welcome_title: settingsMap["referral_welcome_title"] ?? null,
      welcome_bonus: settingsMap["referral_welcome_bonus"] ?? null,
      rewards: rewards ?? [],
    };
  });
