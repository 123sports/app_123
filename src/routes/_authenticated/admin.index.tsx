import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CalendarCheck, DollarSign, Users, AlertCircle, Cake, TrendingUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/money";
import {
  format, startOfMonth, endOfMonth, startOfDay, addDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

type BookingRow = {
  id: string;
  user_id: string;
  booking_date: string;
  start_hour: number;
  type: string;
  status: string;
  payment_status: string;
  amount_cents: number | null;
  payment_method: string | null;
};

function AdminDashboard() {
  const [bookingsMonth, setBookingsMonth] = useState<BookingRow[]>([]);
  const [costsMonthCents, setCostsMonthCents] = useState(0);
  const [students, setStudents] = useState(0);
  const [pending, setPending] = useState<BookingRow[]>([]);
  const [birthdays, setBirthdays] = useState<{ id: string; full_name: string | null; birth_date: string | null }[]>([]);
  const [today] = useState(new Date());

  useEffect(() => {
    (async () => {
      const from = format(startOfMonth(today), "yyyy-MM-dd");
      const to = format(endOfMonth(today), "yyyy-MM-dd");

      const [{ data: bs }, { data: cs }, { count: stCount }, { data: pend }, { data: profs }] =
        await Promise.all([
          supabase.from("bookings").select("id, user_id, booking_date, start_hour, type, status, payment_status, amount_cents, payment_method")
            .gte("booking_date", from).lte("booking_date", to),
          supabase.from("costs").select("amount_cents, incurred_on, recurrence")
            .or(`recurrence.eq.mensal,and(recurrence.eq.avulso,incurred_on.gte.${from},incurred_on.lte.${to})`),
          supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "aluno"),
          supabase.from("bookings").select("id, user_id, booking_date, start_hour, type, status, payment_status, amount_cents, payment_method")
            .eq("payment_status", "pendente").order("booking_date").limit(10),
          supabase.from("profiles").select("id, full_name, birth_date"),
        ]);

      setBookingsMonth(bs ?? []);
      setCostsMonthCents((cs ?? []).reduce((s, c: any) => s + (c.amount_cents ?? 0), 0));
      setStudents(stCount ?? 0);
      setPending(pend ?? []);

      const md = (d: string | null) => d?.slice(5, 10);
      const now = md(format(today, "yyyy-MM-dd"))!;
      const in15 = md(format(addDays(today, 15), "yyyy-MM-dd"))!;
      setBirthdays(
        (profs ?? [])
          .filter((p: any) => p.birth_date)
          .filter((p: any) => {
            const m = md(p.birth_date)!;
            return now <= in15 ? m >= now && m <= in15 : m >= now || m <= in15;
          })
          .slice(0, 8),
      );
    })();
  }, []);

  const revenue = bookingsMonth
    .filter((b) => b.payment_status === "pago")
    .reduce((s, b) => s + (b.amount_cents ?? 0), 0);
  const cash = bookingsMonth
    .filter((b) => b.payment_status === "pago" && b.payment_method === "dinheiro")
    .reduce((s, b) => s + (b.amount_cents ?? 0), 0);
  const card = bookingsMonth
    .filter((b) => b.payment_status === "pago" && b.payment_method === "cartao")
    .reduce((s, b) => s + (b.amount_cents ?? 0), 0);
  const result = revenue - costsMonthCents;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Painel administrativo</h1>
        <p className="text-muted-foreground">
          {format(today, "MMMM 'de' yyyy", { locale: ptBR })}
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/admin/reservas"><Stat icon={CalendarCheck} label="Reservas no mês" value={bookingsMonth.length} hint="Ver todas →" /></Link>
        <Link to="/admin/financeiro" search={{ tab: "receitas" } as any}><Stat icon={DollarSign} label="Receita do mês" value={brl(revenue)} hint="Detalhar →" /></Link>
        <Link to="/admin/financeiro" search={{ tab: "visao" } as any}><Stat icon={TrendingUp} label="Resultado" value={brl(result)} accent={result >= 0 ? "good" : "bad"} hint="Ver saúde →" /></Link>
        <Link to="/admin/alunos"><Stat icon={Users} label="Alunos" value={students} hint="Ver lista →" /></Link>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link to="/admin/financeiro" search={{ tab: "receitas" } as any}><Stat icon={DollarSign} label="Dinheiro" value={brl(cash)} small /></Link>
        <Link to="/admin/financeiro" search={{ tab: "receitas" } as any}><Stat icon={DollarSign} label="Cartão" value={brl(card)} small /></Link>
        <Link to="/admin/financeiro" search={{ tab: "custos" } as any}><Stat icon={DollarSign} label="Custos do mês" value={brl(costsMonthCents)} small accent="bad" hint="Gerenciar →" /></Link>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-primary" /> Pagamentos pendentes
            </h2>
            <Link to="/admin/reservas" className="text-xs text-primary hover:underline">Ver todas</Link>
          </div>
          {pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum pagamento pendente.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {pending.map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-lg bg-background/60 px-3 py-2">
                  <div>
                    <div className="font-medium">
                      {format(new Date(b.booking_date + "T00:00:00"), "dd/MM")} · {String(b.start_hour).padStart(2, "0")}:00
                    </div>
                    <div className="text-xs text-muted-foreground">{b.type.replace("_", " ")}</div>
                  </div>
                  <Link to="/admin/aluno/$id" params={{ id: b.user_id }} className="text-xs text-primary hover:underline">
                    abrir aluno
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <Cake className="h-4 w-4 text-primary" /> Aniversariantes (15 dias)
          </h2>
          {birthdays.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Ninguém por enquanto.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {birthdays.map((b) => (
                <li key={b.id} className="flex items-center justify-between">
                  <Link to="/admin/aluno/$id" params={{ id: b.id }} className="hover:underline">
                    {b.full_name ?? "Aluno"}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {b.birth_date ? format(new Date(b.birth_date + "T00:00:00"), "dd/MM") : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({
  icon: Icon, label, value, accent, small, hint,
}: { icon: any; label: string; value: any; accent?: "good" | "bad"; small?: boolean; hint?: string }) {
  const c = accent === "good" ? "text-primary" : accent === "bad" ? "text-destructive" : "";
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft transition hover:border-primary/40 hover:shadow-md">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className={`mt-2 font-bold ${small ? "text-xl" : "text-2xl"} ${c}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-primary/70">{hint}</div>}
    </div>
  );
}

const _ = startOfDay; // keep import used
