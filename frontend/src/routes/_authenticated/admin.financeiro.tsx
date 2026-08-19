import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Activity, Wallet, Filter } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl, cents } from "@/lib/money";
import { format, startOfMonth, endOfMonth, addMonths, parse } from "date-fns";
import { ptBR } from "date-fns/locale";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { PageHeader } from "@/components/PageHeader";
import { ViewTabs } from "@/components/ViewTabs";

const searchSchema = z.object({
  tab: fallback(z.enum(["visao", "receitas", "custos"]), "visao").default("visao"),
  ym: fallback(z.string().regex(/^\d{4}-\d{2}$/), format(new Date(), "yyyy-MM")).default(format(new Date(), "yyyy-MM")),
});

export const Route = createFileRoute("/_authenticated/admin/financeiro")({
  validateSearch: zodValidator(searchSchema),
  component: AdminFinanceiro,
});

const TYPE_LABEL: Record<string, string> = {
  quadra_livre: "Quadra livre", aula_individual: "Aula individual",
  aula_dupla: "Aula em dupla", aula_trio: "Aula em trio", aula_quarteto: "Aula em quarteto",
  teste: "Teste",
};
const PAY_LABEL: Record<string, string> = { dinheiro: "Dinheiro", pix: "Pix", cartao: "Cartão" };

function AdminFinanceiro() {
  const { tab, ym } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/financeiro" });
  const monthDate = useMemo(() => parse(ym + "-01", "yyyy-MM-dd", new Date()), [ym]);

  const [pricing, setPricing] = useState<any[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { full_name: string | null }>>({});
  const [operators, setOperators] = useState<Record<string, string>>({});
  const [newCost, setNewCost] = useState({ description: "", category: "", amount: "", recurrence: "mensal" });

  // Filtros (receitas)
  const [fType, setFType] = useState("all");
  const [fPay, setFPay] = useState("all");
  const [fStatus, setFStatus] = useState<"all" | "pago" | "pendente">("all");
  const [fDay, setFDay] = useState<string>("");

  const load = useCallback(async () => {
    const from = format(startOfMonth(monthDate), "yyyy-MM-dd");
    const to = format(endOfMonth(monthDate), "yyyy-MM-dd");
    const [{ data: pr }, { data: cs }, { data: bs }, { data: ops }] = await Promise.all([
      supabase.from("pricing").select("*").order("booking_type"),
      supabase.from("costs").select("*").order("incurred_on", { ascending: false }),
      supabase.from("bookings")
        .select("id, user_id, booking_date, start_hour, type, status, payment_status, payment_method, card_operator_id, amount_cents")
        .gte("booking_date", from).lte("booking_date", to)
        .order("booking_date", { ascending: false }).order("start_hour", { ascending: false }),
      supabase.from("card_operators").select("id, name"),
    ]);
    setPricing(pr ?? []);
    setCosts(cs ?? []);
    setBookings(bs ?? []);
    setOperators(Object.fromEntries((ops ?? []).map((o: any) => [o.id, o.name])));
    const ids = [...new Set((bs ?? []).map((b: any) => b.user_id))];
    if (ids.length) {
      const { data: pf } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      setProfiles(Object.fromEntries((pf ?? []).map((p: any) => [p.id, p])));
    } else setProfiles({});
  }, [monthDate]);
  useEffect(() => { void load(); }, [load]);

  const savePrice = async (id: string, price_cents: number) => {
    const { error } = await supabase.from("pricing").update({ price_cents }).eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível atualizar o preço. Tente de novo.");
    toast.success("Preço atualizado");
  };

  const addCost = async () => {
    if (!newCost.description || !newCost.amount) return toast.error("Descrição e valor obrigatórios");
    const { error } = await supabase.from("costs").insert({
      description: newCost.description,
      category: newCost.category || null,
      amount_cents: cents(newCost.amount),
      recurrence: newCost.recurrence,
      incurred_on: format(monthDate, "yyyy-MM-dd"),
    });
    if (error) return toast.error(error?.message ?? "Não foi possível adicionar o custo. Tente de novo.");
    setNewCost({ description: "", category: "", amount: "", recurrence: "mensal" });
    toast.success("Custo adicionado");
    load();
  };

  const delCost = async (id: string) => {
    const { error } = await supabase.from("costs").delete().eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível excluir o custo. Tente de novo.");
    setCosts((c) => c.filter((x) => x.id !== id));
  };

  // ---------- métricas ----------
  const paid = bookings.filter((b) => b.payment_status === "pago");
  const pending = bookings.filter((b) => b.payment_status === "pendente");
  const revenue = paid.reduce((s, b) => s + (b.amount_cents ?? 0), 0);
  const aReceber = pending.reduce((s, b) => s + (b.amount_cents ?? 0), 0);
  const cash = paid.filter((b) => b.payment_method === "dinheiro").reduce((s, b) => s + (b.amount_cents ?? 0), 0);
  const card = paid.filter((b) => b.payment_method === "cartao").reduce((s, b) => s + (b.amount_cents ?? 0), 0);
  const pix = paid.filter((b) => b.payment_method === "pix").reduce((s, b) => s + (b.amount_cents ?? 0), 0);

  const ymStr = format(monthDate, "yyyy-MM");
  const fixedMonth = costs.filter((c) => c.recurrence === "mensal").reduce((s, c) => s + (c.amount_cents ?? 0), 0);
  const oneOffMonth = costs.filter((c) => c.recurrence === "avulso" && c.incurred_on?.slice(0, 7) === ymStr)
    .reduce((s, c) => s + (c.amount_cents ?? 0), 0);
  const totalCost = fixedMonth + oneOffMonth;
  const result = revenue - totalCost;
  const margin = revenue > 0 ? Math.round((result / revenue) * 100) : 0;
  const ticket = paid.length > 0 ? Math.round(revenue / paid.length) : 0;
  const breakeven = totalCost;
  const breakevenPct = breakeven > 0 ? Math.min(100, Math.round((revenue / breakeven) * 100)) : 100;

  // receita por tipo
  const byType = paid.reduce<Record<string, number>>((acc, b) => {
    acc[b.type] = (acc[b.type] ?? 0) + (b.amount_cents ?? 0);
    return acc;
  }, {});
  const byTypeArr = Object.entries(byType).sort((a, b) => b[1] - a[1]);

  // saúde
  let health: { label: string; color: string; tip: string };
  if (revenue === 0 && totalCost === 0) health = { label: "Sem dados", color: "text-muted-foreground", tip: "Cadastre custos e receitas para acompanhar." };
  else if (result < 0) health = { label: "Atenção", color: "text-destructive", tip: "Operação no vermelho neste mês." };
  else if (margin < 15) health = { label: "Apertado", color: "text-yellow-500", tip: "Margem baixa. Avalie preços ou volume." };
  else if (margin < 35) health = { label: "Saudável", color: "text-primary", tip: "Operação equilibrada." };
  else health = { label: "Excelente", color: "text-primary", tip: "Ótima margem de operação." };

  // filtros receitas
  const filteredPaid = useMemo(() => bookings.filter((b) => {
    if (fStatus !== "all" && b.payment_status !== fStatus) return false;
    if (fStatus === "all" && !(b.payment_status === "pago" || b.payment_status === "pendente")) return false;
    if (fType !== "all" && b.type !== fType) return false;
    if (fPay !== "all" && b.payment_method !== fPay) return false;
    if (fDay && b.booking_date !== fDay) return false;
    return true;
  }), [bookings, fStatus, fType, fPay, fDay]);

  const goTab = (t: "visao" | "receitas" | "custos") => navigate({ search: (p: any) => ({ ...p, tab: t }) });
  const shiftMonth = (delta: number) => navigate({ search: (p: any) => ({ ...p, ym: format(addMonths(monthDate, delta), "yyyy-MM") }) });

  return (
    <div className="stack-app">
      <PageHeader
        eyebrow="Admin · Financeiro"
        title="Financeiro"
        subtitle="Acompanhe a saúde da sua quadra mês a mês."
        actions={
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1.5">
            <button onClick={() => shiftMonth(-1)} className="btn-bounce rounded-full p-1 hover:bg-accent"><ChevronLeft className="h-4 w-4" /></button>
            <div className="min-w-[150px] text-center type-data text-sm capitalize">
              {format(monthDate, "MMMM 'de' yyyy", { locale: ptBR })}
            </div>
            <button onClick={() => shiftMonth(1)} className="btn-bounce rounded-full p-1 hover:bg-accent"><ChevronRight className="h-4 w-4" /></button>
          </div>
        }
      />

      {/* Abas */}
      <ViewTabs
        tabs={[
          { key: "visao", label: "Visão geral" },
          { key: "receitas", label: "Receitas" },
          { key: "custos", label: "Custos" },
        ]}
        value={tab}
        onChange={goTab}
      />

      {/* ============ VISÃO ============ */}
      {tab === "visao" && (
        <div className="stack-app">
          <section className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Wallet} label="Receita" value={brl(revenue)} sub={`${paid.length} reservas pagas`} />
            <Kpi icon={TrendingDown} label="Custos" value={brl(totalCost)} accent="bad" sub={`${brl(fixedMonth)} fixos · ${brl(oneOffMonth)} avulsos`} />
            <Kpi icon={TrendingUp} label="Resultado" value={brl(result)} accent={result >= 0 ? "good" : "bad"} sub={`Margem ${margin}%`} />
            <Kpi icon={Activity} label="Saúde" value={<span className={health.color}>{health.label}</span>} sub={health.tip} />
          </section>

          <section className="grid auto-rows-fr gap-4 md:grid-cols-2">
            <div className="plane h-full">
              <h3 className="mb-3 type-h3">Ponto de equilíbrio</h3>
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Receita / Custos</span>
                <span className="font-semibold">{brl(revenue)} / {brl(breakeven)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-muted">
                <div className={`h-full transition-all ${revenue >= breakeven ? "bg-primary" : "bg-yellow-500"}`} style={{ width: `${breakevenPct}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {revenue >= breakeven
                  ? `Você já cobriu os custos e está ${brl(result)} no positivo.`
                  : `Faltam ${brl(breakeven - revenue)} para cobrir os custos.`}
              </p>
            </div>

            <div className="plane h-full">
              <h3 className="mb-3 type-h3">Recebimentos por forma</h3>
              <div className="space-y-2 text-sm">
                <Bar label="Dinheiro" value={cash} total={revenue} />
                <Bar label="Pix" value={pix} total={revenue} />
                <Bar label="Cartão" value={card} total={revenue} />
              </div>
              <div className="mt-3 flex items-center justify-between type-small text-muted-foreground">
                <span>Ticket médio</span><span className="type-data font-semibold text-foreground">{brl(ticket)}</span>
              </div>
              <div className="flex items-center justify-between type-small text-muted-foreground">
                <span>A receber (pendente)</span><span className="type-data font-semibold text-foreground">{brl(aReceber)}</span>
              </div>
            </div>
          </section>

          <section className="plane">
            <h3 className="mb-3 type-h3">Receita por tipo de reserva</h3>
            {byTypeArr.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma receita registrada neste mês.</p>
            ) : (
              <div className="space-y-2 text-sm">
                {byTypeArr.map(([t, v]) => (
                  <Bar key={t} label={TYPE_LABEL[t] ?? t} value={v} total={revenue} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ============ RECEITAS ============ */}
      {tab === "receitas" && (
        <div className="stack-app">
          <section className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi small label="Recebido" value={brl(revenue)} />
            <Kpi small label="A receber" value={brl(aReceber)} accent="bad" />
            <Kpi small label="Dinheiro" value={brl(cash)} />
            <Kpi small label="Cartão + Pix" value={brl(card + pix)} />
          </section>

          <div className="plane plane-compact flex flex-wrap items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value as any)} className="rounded-md border border-input bg-background px-2 py-1">
              <option value="all">Pagos + pendentes</option>
              <option value="pago">Só pagos</option>
              <option value="pendente">Só pendentes</option>
            </select>
            <select value={fType} onChange={(e) => setFType(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1">
              <option value="all">Todos os tipos</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={fPay} onChange={(e) => setFPay(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1">
              <option value="all">Toda forma</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="cartao">Cartão</option>
            </select>
            <input type="date" value={fDay} min={format(startOfMonth(monthDate), "yyyy-MM-dd")} max={format(endOfMonth(monthDate), "yyyy-MM-dd")}
              onChange={(e) => setFDay(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1" />
            {(fType !== "all" || fPay !== "all" || fStatus !== "all" || fDay) && (
              <button onClick={() => { setFType("all"); setFPay("all"); setFStatus("all"); setFDay(""); }}
                className="text-xs text-primary hover:underline">Limpar filtros</button>
            )}
            <div className="ml-auto text-xs text-muted-foreground">{filteredPaid.length} reserva(s)</div>
          </div>

          <div className="overflow-x-auto bg-card/30">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary text-left type-eyebrow text-muted-foreground">
                <tr>
                  <th className="p-3">Data</th>
                  <th className="p-3">Aluno</th>
                  <th className="p-3">Origem</th>
                  <th className="p-3">Forma</th>
                  <th className="p-3">Operadora</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filteredPaid.map((b) => (
                  <tr key={b.id} className="border-b border-border/60 hover:bg-secondary">
                    <td className="p-3 whitespace-nowrap">
                      <div className="type-data font-medium">{format(new Date(b.booking_date + "T00:00:00"), "dd/MM")}</div>
                      <div className="type-micro text-muted-foreground">{String(b.start_hour).padStart(2, "0")}:00</div>
                    </td>
                    <td className="p-3">{profiles[b.user_id]?.full_name ?? "—"}</td>
                    <td className="p-3 text-xs">{TYPE_LABEL[b.type] ?? b.type}</td>
                    <td className="p-3 text-xs">{b.payment_method ? PAY_LABEL[b.payment_method] : "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">{b.card_operator_id ? operators[b.card_operator_id] ?? "—" : "—"}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${b.payment_status === "pago" ? "bg-primary/15 text-primary" : "bg-yellow-500/15 text-yellow-600"}`}>
                        {b.payment_status}
                      </span>
                    </td>
                    <td className="p-3 text-right type-data font-semibold">{brl(b.amount_cents ?? 0)}</td>
                  </tr>
                ))}
                {filteredPaid.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Nenhuma receita com esses filtros.</td></tr>
                )}
              </tbody>
              {filteredPaid.length > 0 && (
                <tfoot className="border-t-2 border-border bg-secondary">
                  <tr>
                    <td colSpan={6} className="p-3 text-right type-eyebrow text-muted-foreground">Total</td>
                    <td className="p-3 text-right type-data font-bold">{brl(filteredPaid.reduce((s, b) => s + (b.amount_cents ?? 0), 0))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Tabela de preços */}
          <section className="plane">
            <h2 className="mb-4 type-h3">Tabela de preços (por hora)</h2>
            <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pricing.map((p) => (
                <div key={p.id} className="rounded-xl bg-secondary p-3">
                  <div className="type-small text-muted-foreground">{TYPE_LABEL[p.booking_type] ?? p.booking_type}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm">R$</span>
                    <input type="text" defaultValue={(p.price_cents / 100).toFixed(2).replace(".", ",")}
                      onBlur={(e) => savePrice(p.id, cents(e.currentTarget.value))}
                      className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-right type-data font-semibold" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ============ CUSTOS ============ */}
      {tab === "custos" && (
        <div className="stack-app">
          <section className="grid auto-rows-fr gap-4 sm:grid-cols-3">
            <Kpi small label="Custos fixos (mensais)" value={brl(fixedMonth)} accent="bad" />
            <Kpi small label="Custos avulsos do mês" value={brl(oneOffMonth)} accent="bad" />
            <Kpi small label="Total" value={brl(totalCost)} accent="bad" />
          </section>

          <section className="plane">
            <h2 className="mb-4 type-h3">Adicionar custo</h2>
            <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_140px_120px_120px_auto]">
              <input placeholder="Descrição" value={newCost.description} onChange={(e) => setNewCost({ ...newCost, description: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <input placeholder="Categoria" value={newCost.category} onChange={(e) => setNewCost({ ...newCost, category: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <input placeholder="Valor" value={newCost.amount} onChange={(e) => setNewCost({ ...newCost, amount: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm text-right" />
              <select value={newCost.recurrence} onChange={(e) => setNewCost({ ...newCost, recurrence: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="mensal">Mensal</option>
                <option value="avulso">Avulso</option>
              </select>
              <button onClick={addCost} className="btn-bounce inline-flex items-center gap-1 rounded-full bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
                <Plus className="h-4 w-4" /> Adicionar
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left type-eyebrow text-muted-foreground">
                  <tr><th className="p-2">Descrição</th><th className="p-2">Categoria</th><th className="p-2">Recorrência</th><th className="p-2">Data</th><th className="p-2 text-right">Valor</th><th /></tr>
                </thead>
                <tbody>
                  {costs.map((c) => (
                    <tr key={c.id} className="border-b border-border/60">
                      <td className="p-2">{c.description}</td>
                      <td className="p-2 text-muted-foreground">{c.category ?? "—"}</td>
                      <td className="p-2"><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{c.recurrence}</span></td>
                      <td className="p-2 type-data">{format(new Date(c.incurred_on + "T00:00:00"), "dd/MM/yy")}</td>
                      <td className="p-2 text-right type-data font-semibold">{brl(c.amount_cents)}</td>
                      <td className="p-2 text-right">
                        <button onClick={() => delCost(c.id)} className="btn-bounce text-destructive hover:opacity-70">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {costs.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhum custo cadastrado.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, accent, small, sub }: { icon?: any; label: string; value: any; accent?: "good" | "bad"; small?: boolean; sub?: string }) {
  const c = accent === "good" ? "text-primary" : accent === "bad" ? "text-destructive" : "";
  return (
    <div className="plane h-full">
      <div className="flex items-center justify-between">
        <div className="type-small text-muted-foreground">{label}</div>
        {Icon && <Icon className="h-4 w-4 text-primary" />}
      </div>
      <div className={`mt-2 type-data font-bold ${small ? "text-xl" : "text-2xl"} ${c}`}>{value}</div>
      {sub && <div className="mt-1 type-micro text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Bar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">{brl(value)} · {pct}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary/70 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
