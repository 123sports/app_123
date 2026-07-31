import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CalendarCheck, DollarSign, Users, AlertCircle, Cake, TrendingUp, CreditCard, Wallet, Banknote,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/money";
import { PageHeader } from "@/components/PageHeader";
import { PersonList, PersonRow } from "@/components/PersonList";
import { format, startOfMonth, endOfMonth, addDays } from "date-fns";
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
    <>
      <PageHeader
        eyebrow="Admin · Painel"
        title="Painel administrativo"
        subtitle={format(today, "MMMM 'de' yyyy", { locale: ptBR })}
      />

      {/* Blocos padronizados: mesma dimensão, mesmo espaçamento em todos os lados */}
      <div className="stack-app">
        <section className="grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat to="/admin/reservas" icon={CalendarCheck} label="Reservas no mês" value={bookingsMonth.length} hint="Ver todas" />
          <Stat to="/admin/financeiro" search={{ tab: "receitas" }} icon={DollarSign} label="Receita do mês" value={brl(revenue)} hint="Detalhar" />
          <Stat to="/admin/financeiro" search={{ tab: "visao" }} icon={TrendingUp} label="Resultado" value={brl(result)} accent={result >= 0 ? "good" : "bad"} hint="Ver saúde" />
          <Stat to="/admin/alunos" icon={Users} label="Alunos" value={students} hint="Ver lista" />
          <Stat to="/admin/financeiro" search={{ tab: "receitas" }} icon={Banknote} label="Dinheiro" value={brl(cash)} />
          <Stat to="/admin/financeiro" search={{ tab: "receitas" }} icon={CreditCard} label="Cartão" value={brl(card)} />
          <Stat to="/admin/financeiro" search={{ tab: "custos" }} icon={Wallet} label="Custos do mês" value={brl(costsMonthCents)} accent="bad" hint="Gerenciar" />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="plane">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="type-h3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-foreground" /> Pagamentos pendentes
              </h2>
              <Link to="/admin/reservas" className="type-small font-bold hover:underline">Ver todas</Link>
            </div>
            {pending.length === 0 ? (
              <p className="py-6 text-center type-small text-muted-foreground">Nenhum pagamento pendente.</p>
            ) : (
              <ul className="flex flex-col">
                {pending.map((b) => (
                  <li
                    key={b.id}
                    className="border-t border-border first:border-t-0 [&:has(a:hover)]:border-transparent [&:has(a:hover)+li]:border-transparent"
                  >
                    <Link
                      to="/admin/aluno/$id"
                      params={{ id: b.user_id }}
                      className="group -mx-5 flex items-center justify-between px-5 py-3 transition-colors hover:bg-accent"
                    >
                      <span>
                        <span className="block type-small font-bold">
                          {format(new Date(b.booking_date + "T00:00:00"), "dd/MM")} · {String(b.start_hour).padStart(2, "0")}:00
                        </span>
                        <span className="block type-micro text-muted-foreground">{b.type.replace("_", " ")}</span>
                      </span>
                      <span className="flex items-center whitespace-nowrap type-small font-bold opacity-40 transition-opacity duration-300 ease-[cubic-bezier(.625,.05,0,1)] group-hover:opacity-100">
                        abrir aluno
                        <span className="inline-block w-0 overflow-hidden opacity-0 transition-all duration-300 ease-[cubic-bezier(.625,.05,0,1)] group-hover:ml-1 group-hover:w-4 group-hover:opacity-100">→</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="plane">
            <h2 className="type-h3 mb-4 flex items-center gap-2">
              <Cake className="h-4 w-4 text-foreground" /> Aniversariantes (15 dias)
            </h2>
            {birthdays.length === 0 ? (
              <p className="py-4 text-center type-small text-muted-foreground">Ninguém por enquanto.</p>
            ) : (
              <PersonList>
                {birthdays.map((b) => (
                  <PersonRow
                    key={b.id}
                    to="/admin/aluno/$id"
                    params={{ id: b.id }}
                    name={b.full_name ?? "Aluno"}
                    trailing={
                      <span className="type-data text-muted-foreground">
                        {b.birth_date ? format(new Date(b.birth_date + "T00:00:00"), "dd/MM") : "—"}
                      </span>
                    }
                  />
                ))}
              </PersonList>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({
  to, search, icon: Icon, label, value, accent, hint,
}: {
  to: string;
  search?: Record<string, string>;
  icon: any;
  label: string;
  value: any;
  accent?: "good" | "bad";
  hint?: string;
}) {
  const valueColor = accent === "bad" ? "text-destructive" : "text-foreground";
  return (
    <Link
      to={to}
      search={search as any}
      className="group btn-bounce flex h-full flex-col bg-card/30 p-5 transition-colors duration-300 ease-[cubic-bezier(.625,.05,0,1)] hover:bg-card"
    >
      <div className="flex items-center justify-between">
        <span className="type-eyebrow">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <span className={`type-data text-3xl ${valueColor}`}>{value}</span>
        {hint ? (
          <span className="flex items-center whitespace-nowrap type-micro text-muted-foreground">
            {hint}
            <span className="inline-block w-0 overflow-hidden opacity-0 transition-all duration-300 ease-[cubic-bezier(.625,.05,0,1)] group-hover:ml-1 group-hover:w-4 group-hover:opacity-100">
              →
            </span>
          </span>
        ) : null}
      </div>
    </Link>
  );
}
