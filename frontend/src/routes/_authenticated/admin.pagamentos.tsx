import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, QrCode, ReceiptText, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/money";
import { effectiveCheckoutStatus } from "@/lib/payment-security";
import { reconcileReviewedPaymentServer } from "@/lib/payments-admin.functions";
import { cleanupExpiredLocalPixCheckouts } from "@/lib/payments";
import { PageHeader } from "@/components/PageHeader";
import { addMonths, startOfMonth } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/pagamentos")({
  component: AdminPayments,
});

type CheckoutOrder = {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  amount_cents: number;
  description: string;
  provider: string;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
};

function effectiveStatus(order: CheckoutOrder) {
  return effectiveCheckoutStatus(order.status, order.expires_at);
}

function AdminPayments() {
  const [orders, setOrders] = useState<CheckoutOrder[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [metrics, setMetrics] = useState({ revenueMonth: 0, pending: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<
    | "all"
    | "pending"
    | "paid"
    | "expired"
    | "cancelled"
    | "failed"
    | "refunded"
    | "paid_needs_review"
  >("all");

  const load = async () => {
    await cleanupExpiredLocalPixCheckouts();
    const now = new Date();
    const paidFrom = startOfMonth(now).toISOString();
    const paidUntil = startOfMonth(addMonths(now, 1)).toISOString();
    const activePendingFilter = `expires_at.is.null,expires_at.gt.${now.toISOString()}`;
    const [
      { data: orderRows },
      { data: paidRows },
      { count: pendingCount },
      { count: totalCount },
    ] = await Promise.all([
      (supabase as any)
        .from("checkout_orders")
        .select(
          "id, user_id, kind, status, amount_cents, description, provider, expires_at, paid_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(300),
      (supabase as any)
        .from("checkout_orders")
        .select("amount_cents")
        .eq("status", "paid")
        .gte("paid_at", paidFrom)
        .lt("paid_at", paidUntil),
      (supabase as any)
        .from("checkout_orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .or(activePendingFilter),
      (supabase as any).from("checkout_orders").select("id", { count: "exact", head: true }),
    ]);
    const nextOrders = (orderRows ?? []) as CheckoutOrder[];
    setOrders(nextOrders);
    setMetrics({
      revenueMonth: (paidRows ?? []).reduce(
        (sum: number, order: { amount_cents: number }) => sum + order.amount_cents,
        0,
      ),
      pending: pendingCount ?? 0,
      total: totalCount ?? 0,
    });

    const ids = [...new Set(nextOrders.map((order) => order.user_id))];
    if (ids.length) {
      const { data: profiles } = await (supabase as any)
        .from("profiles_public")
        .select("id, full_name")
        .in("id", ids);
      setNames(
        Object.fromEntries(
          (profiles ?? []).map((profile: any) => [profile.id, profile.full_name ?? "Aluno"]),
        ),
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const handleLocalChange = () => void load();
    window.addEventListener("on-tennis-local-data-change", handleLocalChange);
    const channel = supabase
      .channel("admin-payments")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "checkout_orders" },
        () => void load(),
      )
      .subscribe();
    const refreshInterval = window.setInterval(() => void load(), 60_000);
    return () => {
      window.removeEventListener("on-tennis-local-data-change", handleLocalChange);
      window.clearInterval(refreshInterval);
      void supabase.removeChannel(channel);
    };
  }, []);

  const visible = useMemo(
    () => orders.filter((order) => filter === "all" || effectiveStatus(order) === filter),
    [filter, orders],
  );

  const reconcile = async (orderId: string) => {
    setReconcilingId(orderId);
    try {
      const result = await reconcileReviewedPaymentServer({ data: { orderId } });
      if (result.resolved) toast.success("Pagamento conferido", { description: result.message });
      else toast.warning("Pagamento continua em análise", { description: result.message });
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível conferir o pagamento agora.");
    } finally {
      setReconcilingId(null);
    }
  };

  return (
    <div className="stack-app animate-float-in">
      <PageHeader
        eyebrow="Admin · Pagamentos"
        title="Pagamentos"
        subtitle="Acompanhe cobranças Pix, confirmações e expirações."
        actions={
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
            className="border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="all">Todos</option>
            <option value="pending">Aguardando</option>
            <option value="paid">Pagos</option>
            <option value="expired">Expirados</option>
            <option value="cancelled">Cancelados</option>
            <option value="failed">Falharam</option>
            <option value="refunded">Estornados</option>
            <option value="paid_needs_review">Precisam de atenção</option>
          </select>
        }
      />

      <section className="grid auto-rows-fr gap-4 md:grid-cols-3">
        <Metric icon={CheckCircle2} label="Pix recebido no mês" value={brl(metrics.revenueMonth)} />
        <Metric icon={Clock3} label="Aguardando Pix" value={metrics.pending} />
        <Metric icon={ReceiptText} label="Cobranças Pix" value={metrics.total} />
      </section>

      <section className="plane p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando pagamentos...
          </div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum pagamento neste filtro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left type-eyebrow text-muted-foreground">
                  <th className="p-3">Criado</th>
                  <th className="p-3">Aluno</th>
                  <th className="p-3">Descrição</th>
                  <th className="p-3">Método</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Valor</th>
                  <th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => {
                  return (
                    <tr key={order.id} className="border-b border-border/60">
                      <td className="whitespace-nowrap p-3 type-data">
                        {new Date(order.created_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-3 font-medium">{names[order.user_id] ?? "Aluno"}</td>
                      <td className="min-w-[280px] p-3 text-muted-foreground">
                        <div>{order.description}</div>
                        <div className="mt-1 type-micro type-data">
                          Ref. {order.id.slice(0, 8).toUpperCase()}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="inline-flex items-center gap-1.5">
                          <QrCode className="h-4 w-4" /> Pix
                        </span>
                      </td>
                      <td className="p-3">
                        <Status status={effectiveStatus(order)} />
                      </td>
                      <td className="p-3 text-right type-data font-semibold">
                        {brl(order.amount_cents)}
                      </td>
                      <td className="p-3 text-right">
                        {order.status === "paid_needs_review" ? (
                          <button
                            type="button"
                            onClick={() => void reconcile(order.id)}
                            disabled={reconcilingId !== null}
                            className="btn-bounce inline-flex items-center gap-2 whitespace-nowrap border border-input bg-background px-3 py-2 text-xs font-semibold disabled:opacity-50"
                            title="Consultar o Mercado Pago e tentar confirmar com segurança"
                          >
                            {reconcilingId === order.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            Conferir Pix
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string | number;
}) {
  return (
    <div className="plane h-full">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-2 type-data text-2xl font-bold">{value}</div>
    </div>
  );
}

function Status({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: "bg-primary/15 text-primary",
    pending: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    expired: "bg-muted text-muted-foreground",
    cancelled: "bg-muted text-muted-foreground",
    failed: "bg-destructive/15 text-destructive",
    refunded: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    paid_needs_review: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  };
  const labels: Record<string, string> = {
    paid: "Pago",
    pending: "Aguardando",
    expired: "Expirado",
    cancelled: "Cancelado",
    failed: "Falhou",
    refunded: "Estornado",
    paid_needs_review: "Precisa de atenção",
  };
  return (
    <span
      className={`inline-flex px-2 py-1 text-xs font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
