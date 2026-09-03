import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Phone, AlertTriangle, Cake, Trophy, WalletCards } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/money";
import { effectiveCheckoutStatus } from "@/lib/payment-security";
import { format } from "date-fns";

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pendente: "Aguardando Pix",
  pago: "Pix confirmado",
  expirado: "Pix expirado",
  cancelado: "Cancelado",
  estornado: "Pix estornado",
  isento: "Isento",
};

function paymentStatusLabel(status: string, method?: string | null) {
  if (status === "pago" && method === "credito_plano") return "Crédito do plano";
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

const CREDIT_MODALITY_LABELS: Record<string, string> = {
  individual: "Individual",
  dupla: "Dupla",
  grupo: "Grupo",
};

const CREDIT_HISTORY_LABELS: Record<string, string> = {
  purchase_grant: "Créditos liberados",
  booking_debit: "Aula reservada",
  cancellation_credit: "Crédito devolvido",
  late_cancellation_forfeit: "Cancelamento fora do prazo",
  refund_reversal: "Plano estornado",
};

export const Route = createFileRoute("/_authenticated/admin/aluno/$id")({
  component: AlunoDetalhe,
});

function AlunoDetalhe() {
  const { id } = Route.useParams();
  const { staffRole } = Route.useRouteContext();
  const [profile, setProfile] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [points, setPoints] = useState(0);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [revenue, setRevenue] = useState(0);
  const [pendingPayments, setPendingPayments] = useState(0);
  const [creditBalances, setCreditBalances] = useState<any[]>([]);
  const [creditHistory, setCreditHistory] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const [
        { data: p },
        { data: bs },
        { data: ev },
        { data: paidOrders },
        { data: balances },
        { data: ledger },
      ] = await Promise.all([
        (supabase as any).rpc("get_student_for_professor", { _student_id: id }),
        supabase
          .from("bookings")
          .select(
            "id, booking_date, start_hour, type, status, payment_status, payment_method, hold_expires_at, amount_cents, attended",
          )
          .eq("user_id", id)
          .order("booking_date", { ascending: false }),
        staffRole === "admin"
          ? supabase.from("gamification_events").select("points").eq("user_id", id)
          : Promise.resolve({ data: [] }),
        staffRole === "admin"
          ? supabase
              .from("checkout_orders")
              .select("status, amount_cents, expires_at")
              .eq("user_id", id)
          : Promise.resolve({ data: [] }),
        staffRole === "admin"
          ? (supabase as any)
              .from("student_credit_summary")
              .select("modality, available_credits, credits_acquired")
              .eq("user_id", id)
          : Promise.resolve({ data: [] }),
        staffRole === "admin"
          ? (supabase as any)
              .from("student_credit_ledger")
              .select("id, sequence_no, entry_type, credit_delta, reason, created_at")
              .eq("user_id", id)
              .order("sequence_no", { ascending: false })
              .limit(30)
          : Promise.resolve({ data: [] }),
      ]);
      setProfile(p);
      setBookings(
        (bs ?? []).map((booking: any) => ({
          ...booking,
          payment_status:
            booking.payment_status === "pendente"
              ? effectiveCheckoutStatus("pending", booking.hold_expires_at) === "expired"
                ? "expirado"
                : "pendente"
              : booking.payment_status,
        })),
      );
      setPoints((ev ?? []).reduce((s: number, e: any) => s + (e.points ?? 0), 0));
      setRevenue(
        (paidOrders ?? [])
          .filter((order: any) => order.status === "paid")
          .reduce((sum: number, order: any) => sum + (order.amount_cents ?? 0), 0),
      );
      setPendingPayments(
        (paidOrders ?? []).filter(
          (order: any) =>
            order.status === "pending" &&
            (!order.expires_at || new Date(order.expires_at).getTime() > Date.now()),
        ).length,
      );
      setCreditBalances(balances ?? []);
      setCreditHistory(ledger ?? []);
      if (p?.avatar_url) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(p.avatar_url, 3600);
        setAvatar(signed?.signedUrl ?? null);
      }
    };

    void load();
    const channel = supabase
      .channel(`student-detail-bookings-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "student_credit_ledger",
          filter: `user_id=eq.${id}`,
        },
        () => void load(),
      )
      .subscribe();
    const refreshInterval = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearInterval(refreshInterval);
      void supabase.removeChannel(channel);
    };
  }, [id, staffRole]);

  const total = bookings.length;
  const attended = bookings.filter((b) => b.attended === true).length;
  const missed = bookings.filter((b) => b.attended === false).length;

  return (
    <div className="space-y-4">
      <Link
        to="/admin/alunos"
        className="btn-bounce inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Alunos
      </Link>

      {!profile ? (
        <p className="text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-4 py-2">
            <div className="h-20 w-20 overflow-hidden rounded-full border-2 border-primary/40 bg-primary text-2xl font-bold text-primary-foreground flex items-center justify-center">
              {avatar ? (
                <img
                  src={avatar}
                  alt={profile.full_name ?? ""}
                  className="h-full w-full object-cover"
                />
              ) : (
                (profile.full_name ?? "?")
                  .split(" ")
                  .map((n: string) => n[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
              )}
            </div>
            <div className="flex-1">
              <h1 className="type-h2">{profile.full_name ?? "Sem nome"}</h1>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 type-small text-muted-foreground">
                {profile.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {profile.phone}
                  </span>
                )}
                {profile.birth_date && (
                  <span className="inline-flex items-center gap-1">
                    <Cake className="h-3 w-3" />{" "}
                    {format(new Date(profile.birth_date + "T00:00:00"), "dd/MM/yyyy")}
                  </span>
                )}
                {profile.skill_level && <span>· {profile.skill_level}</span>}
              </div>
            </div>
            {staffRole === "admin" && (
              <div className="text-right">
                <div className="type-eyebrow">Pontos</div>
                <div className="flex items-center justify-end gap-1 text-2xl font-bold type-data text-primary">
                  <Trophy className="h-5 w-5" /> {points}
                </div>
              </div>
            )}
          </header>

          <section
            className={`grid auto-rows-fr gap-4 sm:grid-cols-2 ${staffRole === "admin" ? "lg:grid-cols-5" : "lg:grid-cols-3"}`}
          >
            <Mini label="Reservas" value={total} />
            <Mini label="Presenças" value={attended} accent="good" />
            <Mini label="Faltas" value={missed} accent="bad" />
            {staffRole === "admin" && (
              <>
                <Mini
                  label="Pix pendentes"
                  value={pendingPayments}
                  accent={pendingPayments ? "bad" : undefined}
                />
                <Mini label="Receita Pix" value={brl(revenue)} />
              </>
            )}
          </section>

          <section className="grid auto-rows-fr gap-4 lg:grid-cols-2">
            <div className="bg-card/30 p-5 h-full">
              <h2 className="type-h3 mb-3">Emergência</h2>
              <div className="space-y-2 text-sm">
                <Row label="Contato" value={profile.emergency_contact_name ?? "—"} />
                <Row label="Telefone" value={profile.emergency_contact_phone ?? "—"} />
                <Row label="Tipo sanguíneo" value={profile.blood_type ?? "—"} />
                {profile.medical_notes && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <div className="mb-1 flex items-center gap-1 font-semibold text-destructive">
                      <AlertTriangle className="h-3 w-3" /> Observação médica
                    </div>
                    {profile.medical_notes}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-card/30 p-5 h-full">
              <h2 className="type-h3 mb-3">Histórico de reservas</h2>
              {bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma reserva ainda.</p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto pr-1 text-sm">
                  {bookings.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between bg-secondary px-3 py-2"
                    >
                      <div>
                        <div className="type-data font-medium">
                          {format(new Date(b.booking_date + "T00:00:00"), "dd/MM/yy")} ·{" "}
                          {String(b.start_hour).padStart(2, "0")}:00
                        </div>
                        <div className="type-micro text-muted-foreground">
                          {b.type.replace("_", " ")}
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge
                          color={
                            b.payment_status === "pago"
                              ? "good"
                              : b.payment_status === "pendente"
                                ? "warn"
                                : "neutral"
                          }
                        >
                          {paymentStatusLabel(b.payment_status, b.payment_method)}
                        </Badge>
                        {b.attended === true && (
                          <span className="ml-1 type-micro text-primary">presente</span>
                        )}
                        {b.attended === false && (
                          <span className="ml-1 type-micro text-destructive">faltou</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {staffRole === "admin" && (
            <section className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
              <div className="bg-card/30 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <WalletCards className="h-4 w-4 text-primary" />
                  <h2 className="type-h3">Créditos disponíveis</h2>
                </div>
                {creditBalances.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum crédito ativo.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {creditBalances.map((balance) => (
                      <li
                        key={balance.modality}
                        className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0"
                      >
                        <span>{CREDIT_MODALITY_LABELS[balance.modality] ?? balance.modality}</span>
                        <strong className="type-data">
                          {balance.available_credits} de {balance.credits_acquired}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-card/30 p-5">
                <h2 className="type-h3 mb-3">Histórico financeiro de créditos</h2>
                {creditHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
                ) : (
                  <ul className="max-h-80 divide-y divide-border overflow-y-auto pr-1 text-sm">
                    {creditHistory.map((entry) => (
                      <li key={entry.id} className="flex items-center gap-3 py-2 first:pt-0">
                        <strong
                          className={`w-8 shrink-0 text-right type-data ${entry.credit_delta > 0 ? "text-primary" : "text-foreground"}`}
                        >
                          {entry.credit_delta > 0 ? "+" : ""}
                          {entry.credit_delta}
                        </strong>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            {CREDIT_HISTORY_LABELS[entry.entry_type] ?? entry.entry_type}
                          </div>
                          <div className="type-micro text-muted-foreground">
                            {new Date(entry.created_at).toLocaleString("pt-BR")}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: any; accent?: "good" | "bad" }) {
  const c = accent === "good" ? "text-primary" : accent === "bad" ? "text-destructive" : "";
  return (
    <div className="bg-card/30 p-5 h-full">
      <div className="type-eyebrow">{label}</div>
      <div className={`mt-1 text-xl font-bold type-data ${c}`}>{value}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
function Badge({ color, children }: { color: "good" | "warn" | "neutral"; children: any }) {
  const c =
    color === "good"
      ? "bg-primary/20 text-primary"
      : color === "warn"
        ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${c}`}>{children}</span>;
}
