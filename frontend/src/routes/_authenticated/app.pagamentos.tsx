import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, QrCode, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/money";
import {
  cleanupExpiredLocalPixCheckouts,
  getPixCheckout,
  type PixCheckout,
} from "@/lib/payments";
import { PageHeader } from "@/components/PageHeader";
import { PixCheckoutDialog } from "@/components/PixCheckoutDialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/pagamentos")({
  component: StudentPayments,
});

type Order = {
  id: string;
  status: string;
  amount_cents: number;
  description: string;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
};

function StudentPayments() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<PixCheckout | null>(null);

  const load = async () => {
    await cleanupExpiredLocalPixCheckouts();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data } = await (supabase as any)
      .from("checkout_orders")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setOrders((data ?? []) as Order[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const handleLocalChange = () => void load();
    window.addEventListener("on-tennis-local-data-change", handleLocalChange);
    return () => window.removeEventListener("on-tennis-local-data-change", handleLocalChange);
  }, []);

  const openCheckout = async (orderId: string) => {
    setOpening(orderId);
    try {
      setCheckout(await getPixCheckout(orderId));
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível abrir esta cobrança.");
    } finally {
      setOpening(null);
    }
  };

  const counts = useMemo(() => ({
    paid: orders.filter((order) => order.status === "paid").length,
    pending: orders.filter((order) => (
      order.status === "pending"
      && (!order.expires_at || new Date(order.expires_at).getTime() > Date.now())
    )).length,
  }), [orders]);

  return (
    <div className="stack-app animate-float-in">
      <PageHeader
        eyebrow="Minha conta"
        title="Meus pagamentos"
        subtitle="Consulte cobranças e retome pagamentos Pix pendentes."
      />

      <section className="grid auto-rows-fr gap-4 sm:grid-cols-2">
        <Metric icon={CheckCircle2} label="Pagamentos confirmados" value={counts.paid} />
        <Metric icon={Clock3} label="Aguardando pagamento" value={counts.pending} />
      </section>

      <section className="plane p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando pagamentos...
          </div>
        ) : orders.length === 0 ? (
          <div className="py-12 text-center">
            <ReceiptText className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Nenhuma cobrança gerada.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {orders.map((order) => {
              const expired = order.status === "expired"
                || (order.status === "pending" && order.expires_at && new Date(order.expires_at).getTime() <= Date.now());
              const status = expired ? "expired" : order.status;
              return (
                <li key={order.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{order.description}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(order.created_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <strong className="type-data">{brl(order.amount_cents)}</strong>
                    <Status status={status} />
                    {status === "pending" && (
                      <Button size="sm" onClick={() => void openCheckout(order.id)} disabled={opening === order.id}>
                        {opening === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                        Pagar
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
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

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
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
  };
  const labels: Record<string, string> = {
    paid: "Pago",
    pending: "Aguardando",
    expired: "Expirado",
    cancelled: "Cancelado",
    failed: "Falhou",
    refunded: "Estornado",
  };
  return (
    <span className={`px-2 py-1 text-xs font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}>
      {labels[status] ?? status}
    </span>
  );
}
