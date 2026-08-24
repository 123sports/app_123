import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, QrCode, ReceiptText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/money";
import { cleanupExpiredLocalPixCheckouts } from "@/lib/payments";
import { PageHeader } from "@/components/PageHeader";

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

type PaymentAttempt = {
  id: string;
  checkout_order_id: string;
  payment_method: string;
  status: string;
  provider_order_id: string | null;
};

function AdminPayments() {
  const [orders, setOrders] = useState<CheckoutOrder[]>([]);
  const [attempts, setAttempts] = useState<PaymentAttempt[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "paid" | "expired" | "cancelled">("all");

  const load = async () => {
    await cleanupExpiredLocalPixCheckouts();
    const [{ data: orderRows }, { data: attemptRows }] = await Promise.all([
      (supabase as any).from("checkout_orders").select("*").order("created_at", { ascending: false }).limit(300),
      (supabase as any).from("payment_attempts").select("*").order("created_at", { ascending: false }).limit(300),
    ]);
    const nextOrders = (orderRows ?? []) as CheckoutOrder[];
    setOrders(nextOrders);
    setAttempts((attemptRows ?? []) as PaymentAttempt[]);

    const ids = [...new Set(nextOrders.map((order) => order.user_id))];
    if (ids.length) {
      const { data: profiles } = await (supabase as any)
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      setNames(Object.fromEntries((profiles ?? []).map((profile: any) => [profile.id, profile.full_name ?? "Aluno"])));
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const handleLocalChange = () => void load();
    window.addEventListener("on-tennis-local-data-change", handleLocalChange);
    const channel = supabase
      .channel("admin-payments")
      .on("postgres_changes", { event: "*", schema: "public", table: "checkout_orders" }, () => void load())
      .subscribe();
    return () => {
      window.removeEventListener("on-tennis-local-data-change", handleLocalChange);
      void supabase.removeChannel(channel);
    };
  }, []);

  const visible = useMemo(
    () => orders.filter((order) => filter === "all" || order.status === filter),
    [filter, orders],
  );
  const paid = orders.filter((order) => order.status === "paid");
  const pending = orders.filter((order) => order.status === "pending");
  const revenue = paid.reduce((sum, order) => sum + order.amount_cents, 0);
  const attemptByOrder = Object.fromEntries(attempts.map((attempt) => [attempt.checkout_order_id, attempt]));

  return (
    <div className="stack-app animate-float-in">
      <PageHeader
        eyebrow="Admin · Financeiro"
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
          </select>
        }
      />

      <section className="grid auto-rows-fr gap-4 md:grid-cols-3">
        <Metric icon={CheckCircle2} label="Recebido" value={brl(revenue)} />
        <Metric icon={Clock3} label="Aguardando Pix" value={pending.length} />
        <Metric icon={ReceiptText} label="Pedidos" value={orders.length} />
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
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => {
                  const attempt = attemptByOrder[order.id];
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
                      <td className="min-w-[280px] p-3 text-muted-foreground">{order.description}</td>
                      <td className="p-3">
                        <span className="inline-flex items-center gap-1.5">
                          <QrCode className="h-4 w-4" /> {attempt?.payment_method === "pix" ? "Pix" : "—"}
                        </span>
                      </td>
                      <td className="p-3"><Status status={order.status} /></td>
                      <td className="p-3 text-right type-data font-semibold">{brl(order.amount_cents)}</td>
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

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
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
    paid_needs_review: "Verificar",
  };
  return (
    <span className={`inline-flex px-2 py-1 text-xs font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}>
      {labels[status] ?? status}
    </span>
  );
}
