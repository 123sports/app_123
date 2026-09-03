import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, History, Loader2, QrCode, TicketCheck, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { PixCheckoutDialog } from "@/components/PixCheckoutDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { CreditModality } from "@/lib/credits";
import { brl } from "@/lib/money";
import { createClassPlanPixCheckout, type PixCheckout } from "@/lib/payments";

export const Route = createFileRoute("/_authenticated/app/aulas")({
  component: MinhasAulas,
});

type Plan = {
  id: string;
  title: string;
  description: string | null;
  duration_months: number;
  frequency_per_week: number;
  class_duration_min: number;
  price_cents: number;
  credit_modality: CreditModality;
  credit_quantity: number;
};

type CreditSummary = {
  modality: CreditModality;
  available_credits: number;
  credits_acquired: number;
};

type LedgerEntry = {
  id: string;
  sequence_no: number;
  entry_type:
    | "purchase_grant"
    | "booking_debit"
    | "cancellation_credit"
    | "late_cancellation_forfeit"
    | "refund_reversal";
  credit_delta: number;
  reason: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const modalityMeta: Record<CreditModality, { label: string; detail: string }> = {
  individual: { label: "Individual", detail: "Aula exclusiva com o professor" },
  dupla: { label: "Dupla", detail: "Uma vaga em aula para 2 alunos" },
  grupo: { label: "Grupo", detail: "Uma vaga em aula para 3 ou 4 alunos" },
};

const periodLabel: Record<number, string> = {
  1: "Mensal",
  3: "Trimestral",
  6: "Semestral",
  12: "Anual",
};

const historyLabel: Record<LedgerEntry["entry_type"], string> = {
  purchase_grant: "Créditos liberados",
  booking_debit: "Aula reservada",
  cancellation_credit: "Crédito devolvido",
  late_cancellation_forfeit: "Cancelamento fora do prazo",
  refund_reversal: "Saldo cancelado após estorno",
};

function MinhasAulas() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [summaries, setSummaries] = useState<CreditSummary[]>([]);
  const [history, setHistory] = useState<LedgerEntry[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<PixCheckout | null>(null);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    setUserId(auth.user.id);
    const [planResult, summaryResult, historyResult] = await Promise.all([
      (supabase as any)
        .from("class_plans")
        .select(
          "id, title, description, duration_months, frequency_per_week, class_duration_min, price_cents, credit_modality, credit_quantity",
        )
        .eq("active", true)
        .order("credit_modality")
        .order("duration_months"),
      (supabase as any)
        .from("student_credit_summary")
        .select("modality, available_credits, credits_acquired")
        .eq("user_id", auth.user.id),
      (supabase as any)
        .from("student_credit_ledger")
        .select("id, sequence_no, entry_type, credit_delta, reason, metadata, created_at")
        .eq("user_id", auth.user.id)
        .order("sequence_no", { ascending: false })
        .limit(30),
    ]);
    if (planResult.error || summaryResult.error || historyResult.error) {
      toast.error("Não foi possível atualizar seus planos e créditos.");
    } else {
      setPlans((planResult.data ?? []) as Plan[]);
      setSummaries((summaryResult.data ?? []) as CreditSummary[]);
      setHistory((historyResult.data ?? []) as LedgerEntry[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const refresh = () => void load();
    const channel = supabase
      .channel(`student-credits-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "checkout_orders",
          filter: `user_id=eq.${userId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "student_credit_ledger",
          filter: `user_id=eq.${userId}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, userId]);

  const balanceByModality = useMemo(
    () =>
      new Map(
        summaries.map((summary) => [summary.modality, Math.max(0, summary.available_credits)]),
      ),
    [summaries],
  );

  const buyPlan = async (plan: Plan) => {
    setBuyingId(plan.id);
    try {
      setCheckout(await createClassPlanPixCheckout({ planId: plan.id }));
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível gerar o Pix deste plano.");
    } finally {
      setBuyingId(null);
    }
  };

  return (
    <div className="stack-app animate-float-in">
      <PageHeader
        eyebrow="Minhas aulas"
        title="Planos e créditos"
        subtitle="Compre créditos por Pix e use cada um para reservar uma aula compatível."
        actions={
          <Button asChild variant="outline">
            <Link to="/app/agenda">
              <CalendarDays className="h-4 w-4" /> Abrir agenda
            </Link>
          </Button>
        }
      />

      <section className="grid auto-rows-fr gap-3 sm:grid-cols-3">
        {(Object.keys(modalityMeta) as CreditModality[]).map((modality) => (
          <div key={modality} className="plane h-full">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="type-eyebrow text-muted-foreground">
                  {modalityMeta[modality].label}
                </div>
                <div className="mt-2 type-data text-3xl font-bold">
                  {balanceByModality.get(modality) ?? 0}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {(balanceByModality.get(modality) ?? 0) === 1
                    ? "crédito disponível"
                    : "créditos disponíveis"}
                </div>
              </div>
              <WalletCards className="h-5 w-5 text-primary" />
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="type-h2">Comprar plano</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Os créditos não expiram e ficam disponíveis assim que o Pix for confirmado.
          </p>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando planos...
          </div>
        ) : plans.length === 0 ? (
          <div className="plane py-8 text-center text-sm text-muted-foreground">
            Nenhum plano disponível no momento.
          </div>
        ) : (
          <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <Card key={plan.id} className="flex h-full flex-col">
                <CardHeader className="pb-2">
                  <div className="type-eyebrow text-muted-foreground">
                    {modalityMeta[plan.credit_modality]?.label ?? "Aulas"} ·{" "}
                    {plan.credit_quantity === 1
                      ? "Avulsa"
                      : (periodLabel[plan.duration_months] ?? `${plan.duration_months} meses`)}
                  </div>
                  <CardTitle className="type-h3">{plan.title}</CardTitle>
                </CardHeader>
                <CardContent className="mt-auto space-y-4">
                  <div>
                    <div className="type-data text-2xl font-bold">{brl(plan.price_cents)}</div>
                    <div className="mt-1 text-sm font-medium">
                      {plan.credit_quantity} {plan.credit_quantity === 1 ? "aula" : "aulas"}
                    </div>
                    <div className="mt-1 type-micro text-muted-foreground">
                      {modalityMeta[plan.credit_modality]?.detail} · {plan.class_duration_min} min
                    </div>
                  </div>
                  {plan.description && (
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                  )}
                  <Button
                    className="w-full"
                    onClick={() => void buyPlan(plan)}
                    disabled={buyingId !== null}
                  >
                    {buyingId === plan.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <QrCode className="h-4 w-4" />
                    )}
                    Comprar com Pix
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="plane p-0">
        <div className="flex items-center gap-2 border-b border-border p-4">
          <History className="h-4 w-4 text-primary" />
          <div>
            <h2 className="type-h3">Histórico de créditos</h2>
            <p className="type-micro text-muted-foreground">
              Compras, reservas e devoluções registradas pelo sistema.
            </p>
          </div>
        </div>
        {history.length === 0 ? (
          <div className="py-10 text-center">
            <TicketCheck className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">Nenhum crédito movimentado.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 p-4">
                <span
                  className={`type-data text-lg font-bold ${entry.credit_delta > 0 ? "text-primary" : "text-foreground"}`}
                >
                  {entry.credit_delta > 0 ? "+" : ""}
                  {entry.credit_delta}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{historyLabel[entry.entry_type]}</div>
                  <div className="mt-0.5 type-micro text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString("pt-BR")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {checkout && (
        <PixCheckoutDialog
          checkout={checkout}
          onClose={() => setCheckout(null)}
          onPaid={() => void load()}
        />
      )}
    </div>
  );
}
