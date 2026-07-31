import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Copy, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  approveLocalPixCheckout,
  expireLocalPixCheckout,
  getPixCheckout,
  isLocalPaymentMode,
  type PixCheckout,
} from "@/lib/payments";
import { brl } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  checkout: PixCheckout;
  onClose: () => void;
  onPaid: (checkout: PixCheckout) => void;
};

function remainingSeconds(expiresAt: string) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export function PixCheckoutDialog({ checkout: initialCheckout, onClose, onPaid }: Props) {
  const isLocal = isLocalPaymentMode();
  const [checkout, setCheckout] = useState(initialCheckout);
  const [remaining, setRemaining] = useState(() => remainingSeconds(initialCheckout.expiresAt));
  const [approving, setApproving] = useState(false);
  const [expired, setExpired] = useState(
    () => initialCheckout.status !== "pending" && initialCheckout.status !== "paid"
      || remainingSeconds(initialCheckout.expiresAt) === 0,
  );

  useEffect(() => {
    if (checkout.status !== "pending") return;
    const timer = window.setInterval(() => {
      const next = remainingSeconds(checkout.expiresAt);
      setRemaining(next);
      if (next === 0) {
        window.clearInterval(timer);
        setExpired(true);
        void expireLocalPixCheckout(checkout);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [checkout]);

  useEffect(() => {
    if (isLocal || checkout.status !== "pending") return;
    const poll = window.setInterval(async () => {
      try {
        const current = await getPixCheckout(checkout.orderId);
        setCheckout(current);
        if (current.status === "paid") {
          window.clearInterval(poll);
          toast.success("Pagamento confirmado e reserva liberada");
          onPaid(current);
        }
      } catch {
        // Webhook is authoritative; a transient status read is retried.
      }
    }, 5_000);
    return () => window.clearInterval(poll);
  }, [checkout.orderId, checkout.status, isLocal, onPaid]);

  const countdown = useMemo(() => {
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [remaining]);

  const copy = async () => {
    await navigator.clipboard.writeText(checkout.pixCopyPaste);
    toast.success("Código Pix copiado");
  };

  const approve = async () => {
    setApproving(true);
    try {
      const paid = await approveLocalPixCheckout(checkout);
      setCheckout(paid);
      toast.success("Pagamento aprovado e reserva confirmada");
      onPaid(paid);
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível aprovar o pagamento.");
    } finally {
      setApproving(false);
    }
  };

  const paid = checkout.status === "paid";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{paid ? "Pagamento confirmado" : expired ? "Cobrança indisponível" : "Pagar com Pix"}</DialogTitle>
          <DialogDescription>{checkout.description}</DialogDescription>
        </DialogHeader>

        {paid ? (
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 className="h-14 w-14 text-primary" />
            <div className="mt-4 text-xl font-bold">{brl(checkout.amountCents)}</div>
            <p className="mt-2 text-sm text-muted-foreground">
              A reserva está confirmada e o professor foi avisado na plataforma.
            </p>
          </div>
        ) : expired ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Clock3 className="h-12 w-12 text-muted-foreground" />
            <p className="mt-4 font-medium">Este Pix expirou ou foi cancelado.</p>
            <p className="mt-1 text-sm text-muted-foreground">Volte à agenda para gerar uma nova cobrança.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-y border-border py-3">
              <span className="text-sm text-muted-foreground">Total</span>
              <strong className="type-data text-2xl">{brl(checkout.amountCents)}</strong>
            </div>

            <div className="flex justify-center">
              <div className="h-[220px] w-[220px] overflow-hidden border border-border bg-white p-2">
                <img
                  src={checkout.qrCodeDataUrl}
                  alt="QR Code para pagamento via Pix"
                  className="h-full w-full object-contain"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Pix Copia e Cola</div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={checkout.pixCopyPaste}
                  className="min-w-0 flex-1 border border-input bg-secondary px-3 py-2 text-xs"
                />
                <Button variant="outline" size="icon" onClick={copy} title="Copiar código Pix">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                {isLocal ? "Ambiente local" : "Pagamento seguro via Mercado Pago"}
              </span>
              <span className={`inline-flex items-center gap-1 type-data ${expired ? "text-destructive" : ""}`}>
                <Clock3 className="h-4 w-4" /> {expired ? "Expirado" : countdown}
              </span>
            </div>
          </div>
        )}

        <DialogFooter>
          {paid ? (
            <Button onClick={onClose}>Concluir</Button>
          ) : expired ? (
            <Button onClick={onClose}>Fechar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Fechar</Button>
              {isLocal && (
                <Button onClick={approve} disabled={approving || expired}>
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Simular pagamento aprovado
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
