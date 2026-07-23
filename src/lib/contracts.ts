import { brl } from "@/lib/money";

export type ProfileSnapshot = {
  nome: string;
  cpf: string | null;
  email: string | null;
  telefone: string | null;
  endereco: string | null;
  nascimento: string | null;
  emergencia_nome: string | null;
  emergencia_telefone: string | null;
  responsavel_nome: string | null;
  responsavel_cpf: string | null;
  responsavel_email: string | null;
  responsavel_telefone: string | null;
};

export type CoachSnapshot = {
  nome: string;
  cpf_cnpj: string | null;
  email: string | null;
  telefone: string | null;
  endereco: string | null;
  venue_nome: string | null;
  venue_endereco: string | null;
};

export type ContractSettingsSnapshot = {
  prazo_cancelamento: string;
  prazo_reposicao: string;
  multa_pct: string;
  juros_pct: string;
  dias_suspensao: number;
  forma_pagamento: string;
  dia_vencimento: string;
  foro_cidade: string;
  foro_estado: string;
};

export type PlanMeta = {
  title: string;
  modality: string;
  class_duration_min: number;
  frequency_per_week: number;
  duration_months: number;
};

export type ContractSnapshot = {
  aluno: ProfileSnapshot;
  coach: CoachSnapshot;
  settings: ContractSettingsSnapshot;
  plan_meta: PlanMeta;
};

export const EMPTY_COACH: CoachSnapshot = {
  nome: "",
  cpf_cnpj: null,
  email: null,
  telefone: null,
  endereco: null,
  venue_nome: null,
  venue_endereco: null,
};

export function buildProfileSnapshot(p: any, email?: string | null): ProfileSnapshot {
  return {
    nome: p?.full_name ?? "",
    cpf: p?.cpf ?? null,
    email: email ?? null,
    telefone: p?.phone ?? null,
    endereco: p?.address ?? null,
    nascimento: p?.birth_date ?? null,
    emergencia_nome: p?.emergency_contact_name ?? null,
    emergencia_telefone: p?.emergency_contact_phone ?? null,
    responsavel_nome: p?.guardian_name ?? null,
    responsavel_cpf: p?.guardian_cpf ?? null,
    responsavel_email: p?.guardian_email ?? null,
    responsavel_telefone: p?.guardian_phone ?? null,
  };
}

// Backwards-compat alias
export const buildSnapshot = buildProfileSnapshot;

export function buildCoachSnapshot(c: any): CoachSnapshot {
  if (!c) return EMPTY_COACH;
  return {
    nome: c?.display_name ?? "",
    cpf_cnpj: c?.cpf_cnpj ?? null,
    email: c?.email ?? null,
    telefone: c?.phone ?? null,
    endereco: c?.address ?? null,
    venue_nome: c?.venue_name ?? null,
    venue_endereco: c?.venue_address ?? null,
  };
}

export function buildSettingsSnapshot(s: any): ContractSettingsSnapshot {
  return {
    prazo_cancelamento: s?.cancel_window ?? "12 horas",
    prazo_reposicao: s?.reposition_window ?? "30 dias",
    multa_pct: String(s?.late_fee_pct ?? "2"),
    juros_pct: String(s?.late_interest_pct ?? "1"),
    dias_suspensao: Number(s?.suspension_days ?? 10),
    forma_pagamento: s?.payment_method ?? "Pix / cartão / boleto",
    dia_vencimento: s?.day_due ?? "dia 5",
    foro_cidade: s?.foro_city ?? "São Paulo",
    foro_estado: s?.foro_state ?? "SP",
  };
}

export function buildPlanMeta(plan: any): PlanMeta {
  return {
    title: plan?.title ?? "",
    modality: plan?.modality ?? "individual",
    class_duration_min: Number(plan?.class_duration_min ?? 60),
    frequency_per_week: Number(plan?.frequency_per_week ?? 0),
    duration_months: Number(plan?.duration_months ?? 0),
  };
}

/** Reads a contract snapshot in legacy or new format. */
export function readContractSnapshot(raw: any, fallbackPlan?: any): ContractSnapshot {
  if (raw && typeof raw === "object" && raw.aluno) {
    return {
      aluno: raw.aluno as ProfileSnapshot,
      coach: raw.coach ?? EMPTY_COACH,
      settings: buildSettingsSnapshot(raw.settings ?? {}),
      plan_meta: raw.plan_meta ?? buildPlanMeta(fallbackPlan),
    };
  }
  return {
    aluno: (raw ?? {}) as ProfileSnapshot,
    coach: EMPTY_COACH,
    settings: buildSettingsSnapshot({}),
    plan_meta: buildPlanMeta(fallbackPlan),
  };
}

const dash = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : "—");

const dateBR = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export type RenderContext = {
  snapshot: ContractSnapshot;
  agreedPriceCents: number;
  startsOn: string;
  endsOn: string;
  contractVersion?: number;
  generatedAt?: Date;
};

export function renderTemplate(body: string, ctx: RenderContext): string {
  const aluno = ctx.snapshot.aluno;
  const coach = ctx.snapshot.coach;
  const settings = ctx.snapshot.settings;
  const plan = ctx.snapshot.plan_meta;
  const aulasIncluidas = plan.frequency_per_week && plan.duration_months
    ? `${plan.frequency_per_week * 4 * plan.duration_months} aulas (aproximado)`
    : "—";
  const periodo = plan.duration_months === 1 ? "Mensal" :
    plan.duration_months === 3 ? "Trimestral" :
    plan.duration_months === 6 ? "Semestral" :
    plan.duration_months === 12 ? "Anual" :
    plan.duration_months ? `${plan.duration_months} meses` : "—";
  const map: Record<string, string> = {
    "aluno.nome": dash(aluno.nome),
    "aluno.cpf": dash(aluno.cpf),
    "aluno.email": dash(aluno.email),
    "aluno.telefone": dash(aluno.telefone),
    "aluno.endereco": dash(aluno.endereco),
    "aluno.nascimento": aluno.nascimento ? dateBR(aluno.nascimento) : "—",
    "aluno.emergencia_nome": dash(aluno.emergencia_nome),
    "aluno.emergencia_telefone": dash(aluno.emergencia_telefone),
    "responsavel.nome": dash(aluno.responsavel_nome),
    "responsavel.cpf": dash(aluno.responsavel_cpf),
    "responsavel.email": dash(aluno.responsavel_email),
    "responsavel.telefone": dash(aluno.responsavel_telefone),
    "coach.nome": dash(coach.nome),
    "coach.cpf_cnpj": dash(coach.cpf_cnpj),
    "coach.email": dash(coach.email),
    "coach.telefone": dash(coach.telefone),
    "coach.endereco": dash(coach.endereco),
    "espaco.nome": dash(coach.venue_nome),
    "espaco.endereco": dash(coach.venue_endereco),
    "plano.titulo": dash(plan.title),
    "plano.modalidade": dash(plan.modality),
    "plano.frequencia": String(plan.frequency_per_week),
    "plano.duracao": String(plan.duration_months),
    "plano.duracao_aula": String(plan.class_duration_min),
    "plano.quantidade_aulas": aulasIncluidas,
    "plano.periodo": periodo,
    "vigencia.inicio": dateBR(ctx.startsOn),
    "vigencia.fim": dateBR(ctx.endsOn),
    "valor.formatado": brl(ctx.agreedPriceCents),
    "config.prazo_cancelamento": settings.prazo_cancelamento,
    "config.prazo_reposicao": settings.prazo_reposicao,
    "config.multa_pct": settings.multa_pct,
    "config.juros_pct": settings.juros_pct,
    "config.dias_suspensao": String(settings.dias_suspensao),
    "config.forma_pagamento": settings.forma_pagamento,
    "config.dia_vencimento": settings.dia_vencimento,
    "config.foro_cidade": settings.foro_cidade,
    "config.foro_estado": settings.foro_estado,
    "contrato.versao": String(ctx.contractVersion ?? 2),
    "contrato.gerado_em": (ctx.generatedAt ?? new Date()).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => map[key] ?? `{{${key}}}`);
}

// Canonical stringify for deterministic hashing
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

export async function computeDocumentHash(input: {
  templateId: string;
  templateVersion: number;
  planId: string;
  agreedPriceCents: number;
  startsOn: string;
  endsOn: string;
  snapshot: ContractSnapshot;
}): Promise<string> {
  const data = new TextEncoder().encode(canonical(input));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export function statusLabel(s: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    rascunho: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
    proposta_aluno: { label: "Proposta do aluno", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300" },
    proposta_admin: { label: "Proposta do admin", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300" },
    aguardando_aluno: { label: "Aguardando aluno", color: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
    aguardando_admin: { label: "Aguardando admin", color: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
    vigente: { label: "Vigente", color: "bg-green-500/20 text-green-700 dark:text-green-300" },
    recusado: { label: "Recusado", color: "bg-red-500/20 text-red-700 dark:text-red-300" },
    encerrado: { label: "Encerrado", color: "bg-muted text-muted-foreground" },
  };
  return map[s] ?? { label: s, color: "bg-muted text-muted-foreground" };
}
