import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildCoachSnapshot,
  buildPlanMeta,
  buildProfileSnapshot,
  buildSettingsSnapshot,
  computeDocumentHash,
  type ContractSnapshot,
} from "@/lib/contracts";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}, "Data invalida.");

const createInputSchema = z.object({
  planId: z.string().uuid(),
  templateId: z.string().uuid(),
  startsOn: isoDateSchema,
  agreedPriceCents: z.number().int().min(100).max(10_000_000),
  mode: z.enum(["aceitar", "negociar"]),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

function addMonthsToIsoDate(isoDate: string, monthsToAdd: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + monthsToAdd, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export const createClassContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const [{ data: plan, error: planErr }, { data: tpl, error: tplErr }, { data: prof, error: profErr }, { data: coachRow }, { data: cfg }, { data: authUser }] =
      await Promise.all([
        supabaseAdmin.from("class_plans").select("*").eq("id", data.planId).eq("active", true).maybeSingle(),
        supabaseAdmin.from("contract_templates").select("*").eq("id", data.templateId).eq("active", true).maybeSingle(),
        supabaseAdmin.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabaseAdmin
          .from("coach_profiles")
          .select("*")
          .eq("active", true)
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin.from("contract_settings").select("*").maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(userId),
      ]);

    if (planErr || !plan) throw new Error("Plano indisponível.");
    if (tplErr || !tpl) throw new Error("Template de contrato indisponível.");
    if (profErr || !prof) throw new Error("Perfil não encontrado.");

    if (plan.price_cents == null) throw new Error("Plano sem preço configurado.");
    const listCents = Number(plan.price_cents);
    const agreedCents = data.mode === "aceitar" ? listCents : Math.max(0, Math.floor(data.agreedPriceCents));
    if (agreedCents <= 0) throw new Error("Valor inválido.");

    const durationMonths = Number(plan.duration_months);
    if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 24) {
      throw new Error("Duracao do plano invalida.");
    }

    const today = new Date().toISOString().slice(0, 10);
    const latestStart = addMonthsToIsoDate(today, 12);
    if (data.startsOn < today || data.startsOn > latestStart) {
      throw new Error("A data de inicio deve estar entre hoje e os proximos 12 meses.");
    }
    const endsOn = addMonthsToIsoDate(data.startsOn, durationMonths);

    const email = authUser?.user?.email ?? null;

    const snapshot: ContractSnapshot = {
      aluno: buildProfileSnapshot(prof, email),
      coach: buildCoachSnapshot(coachRow ?? null),
      settings: buildSettingsSnapshot(cfg ?? {}),
      plan_meta: buildPlanMeta(plan),
    };

    const hash = await computeDocumentHash({
      templateId: tpl.id,
      templateVersion: tpl.version,
      planId: plan.id,
      agreedPriceCents: agreedCents,
      startsOn: data.startsOn,
      endsOn,
      snapshot,
    });

    const status = data.mode === "aceitar" ? "aguardando_aluno" : "proposta_aluno";

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("class_contracts")
      .insert({
        student_id: userId,
        plan_id: plan.id,
        template_id: tpl.id,
        list_price_cents: listCents,
        agreed_price_cents: agreedCents,
        starts_on: data.startsOn,
        ends_on: endsOn,
        snapshot: snapshot as any,
        document_hash: hash,
        status,
        notes: data.mode === "negociar" ? (data.note ?? null) : null,
      })
      .select("id")
      .single();

    if (insErr || !inserted) throw new Error(insErr?.message ?? "Falha ao criar contrato.");

    if (data.mode === "negociar") {
      await supabaseAdmin.from("contract_negotiations").insert({
        contract_id: inserted.id,
        proposed_by: "aluno",
        proposer_id: userId,
        price_cents: agreedCents,
        note: data.note ?? null,
      });
    }

    return { id: inserted.id, status };
  });
