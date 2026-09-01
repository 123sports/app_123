import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Filter, X, List, CalendarDays, Columns3, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/money";
import { format, startOfMonth, endOfMonth, addDays, isSameDay, isSameMonth, startOfWeek, addMonths, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";
import { ViewTabs } from "@/components/ViewTabs";

export const Route = createFileRoute("/_authenticated/admin/reservas")({
  component: AdminReservas,
});

type Row = {
  id: string;
  user_id: string;
  booking_date: string;
  start_hour: number;
  type: string;
  status: string;
  payment_status: string;
  amount_cents: number | null;
  attended: boolean | null;
  professor_id: string | null;
};

type Profile = { id: string; full_name: string | null };
type ViewMode = "lista" | "calendario" | "kanban" | "agenda";

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pendente: "Aguardando Pix",
  pago: "Pix confirmado",
  expirado: "Pix expirado",
  cancelado: "Cancelado",
  estornado: "Pix estornado",
  isento: "Isento",
};

function paymentStatusLabel(status: string) {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

function PaymentStatus({ status }: { status: string }) {
  const color = status === "pago"
    ? "bg-primary/15 text-primary"
    : status === "pendente"
      ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
      : "bg-muted text-muted-foreground";
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 type-micro font-semibold ${color}`}>{paymentStatusLabel(status)}</span>;
}

const STATUSES: { key: Row["status"]; label: string; color: string }[] = [
  { key: "pendente", label: "Pendente", color: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  { key: "confirmada", label: "Confirmada", color: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  { key: "concluida", label: "Concluída", color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  { key: "cancelada", label: "Cancelada", color: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
];

function AdminReservas() {
  const { staffRole } = Route.useRouteContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [pricing, setPricing] = useState<Record<string, number>>({});
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [view, setView] = useState<ViewMode>("lista");
  const [cursor, setCursor] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  const load = async () => {
    const [{ data: bs }, { data: pr }] = await Promise.all([
      supabase.from("bookings")
        .select("id, user_id, professor_id, booking_date, start_hour, type, status, payment_status, amount_cents, attended")
        .order("booking_date", { ascending: false }).order("start_hour", { ascending: false }).limit(500),
      supabase.from("pricing").select("booking_type, price_cents"),
    ]);
    setRows((bs ?? []) as Row[]);
    setPricing(Object.fromEntries((pr ?? []).map((p: any) => [p.booking_type, p.price_cents])));
    const ids = [...new Set((bs ?? []).map((b: any) => b.user_id))];
    if (ids.length) {
      const { data: pf } = await (supabase as any).from("profiles_public").select("id, full_name").in("id", ids);
      setProfiles(Object.fromEntries((pf ?? []).map((p: any) => [p.id, p])));
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((r) =>
    (paymentFilter === "all" || r.payment_status === paymentFilter) &&
    (statusFilter === "all" || r.status === statusFilter),
  ), [rows, paymentFilter, statusFilter]);

  const update = async (id: string, patch: Record<string, any>) => {
    const { error } = await (supabase.from("bookings") as any).update(patch).eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível atualizar a reserva. Tente de novo.");
    toast.success("Reserva atualizada");
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...patch } as Row : r));
  };

  const views: { key: ViewMode; label: string; icon: any }[] = [
    { key: "lista", label: "Lista", icon: List },
    { key: "calendario", label: "Calendário", icon: CalendarDays },
    { key: "kanban", label: "Kanban", icon: Columns3 },
    { key: "agenda", label: "Agenda do dia", icon: Clock },
  ];

  if (staffRole === "professor") {
    return (
      <ProfessorReservationsView
        rows={filtered}
        profiles={profiles}
        paymentFilter={paymentFilter}
        statusFilter={statusFilter}
        setPaymentFilter={setPaymentFilter}
        setStatusFilter={setStatusFilter}
        update={update}
      />
    );
  }

  return (
    <div className="stack-app">
      <PageHeader
        eyebrow="Admin · Reservas"
        title="Reservas"
        subtitle="Acompanhe pagamentos Pix, presença e detalhes de cada reserva."
        actions={<>
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="rounded-full border border-input bg-background px-2 py-1.5 text-sm">
            <option value="all">Todos os pagamentos Pix</option>
            <option value="pendente">Aguardando Pix</option>
            <option value="pago">Pix confirmado</option>
            <option value="expirado">Pix expirado</option>
            <option value="estornado">Pix estornado</option>
            <option value="cancelado">Cancelado</option>
            <option value="isento">Isento</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-full border border-input bg-background px-2 py-1.5 text-sm">
            <option value="all">Todos status</option>
            <option value="pendente">Pendente</option>
            <option value="confirmada">Confirmada</option>
            <option value="concluida">Concluída</option>
            <option value="cancelada">Cancelada</option>
          </select>
        </>}
      />

      <ViewTabs tabs={views} value={view} onChange={setView} />

      {view === "lista" && (
        <ListaView rows={filtered} profiles={profiles} pricing={pricing} update={update} />
      )}
      {view === "calendario" && (
        <CalendarioView
          rows={filtered}
          profiles={profiles}
          cursor={cursor}
          setCursor={setCursor}
          onDayClick={(d) => { setSelectedDay(d); setView("agenda"); }}
        />
      )}
      {view === "kanban" && (
        <KanbanView rows={filtered} profiles={profiles} pricing={pricing} update={update} />
      )}
      {view === "agenda" && (
        <AgendaView
          rows={filtered}
          profiles={profiles}
          pricing={pricing}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          update={update}
        />
      )}
    </div>
  );
}

function ProfessorReservationsView({
  rows,
  profiles,
  paymentFilter,
  statusFilter,
  setPaymentFilter,
  setStatusFilter,
  update,
}: {
  rows: Row[];
  profiles: Record<string, Profile>;
  paymentFilter: string;
  statusFilter: string;
  setPaymentFilter: (value: string) => void;
  setStatusFilter: (value: string) => void;
  update: (id: string, patch: Record<string, any>) => void;
}) {
  return (
    <div className="stack-app">
      <PageHeader
        eyebrow="Professor · Reservas"
        title="Minha agenda"
        subtitle="Acompanhe suas aulas, registre presença e conclua atendimentos."
        actions={(
          <>
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} className="rounded-full border border-input bg-background px-2 py-1.5 text-sm">
              <option value="all">Todos os pagamentos Pix</option>
              <option value="pendente">Aguardando Pix</option>
              <option value="pago">Pix confirmado</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-full border border-input bg-background px-2 py-1.5 text-sm">
              <option value="all">Todos status</option>
              <option value="confirmada">Confirmada</option>
              <option value="concluida">Concluída</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </>
        )}
      />

      <div className="plane p-0">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma reserva encontrada.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((booking) => (
              <li key={booking.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-28">
                  <div className="type-data font-semibold">
                    {format(new Date(`${booking.booking_date}T00:00:00`), "dd/MM/yyyy")}
                  </div>
                  <div className="type-small text-muted-foreground">
                    {String(booking.start_hour).padStart(2, "0")}:00
                  </div>
                </div>
                <div className="min-w-48 flex-1">
                  <Link to="/admin/aluno/$id" params={{ id: booking.user_id }} className="font-semibold hover:underline">
                    {profiles[booking.user_id]?.full_name ?? "Aluno"}
                  </Link>
                  <div className="type-small text-muted-foreground">
                    {booking.type.replace("_", " ")} · {paymentStatusLabel(booking.payment_status)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => update(booking.id, { attended: true })}
                    className={`rounded-full border p-2 ${booking.attended === true ? "border-primary bg-primary/15" : "border-border"}`}
                    title="Marcar presença"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => update(booking.id, { attended: false })}
                    className={`rounded-full border p-2 ${booking.attended === false ? "border-destructive bg-destructive/10" : "border-border"}`}
                    title="Marcar falta"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  {booking.status === "confirmada" && (
                    <button
                      onClick={() => update(booking.id, { status: "concluida" })}
                      className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                    >
                      Concluir
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- LISTA ----------
function ListaView({ rows, profiles, pricing, update }: {
  rows: Row[]; profiles: Record<string, Profile>;
  pricing: Record<string, number>; update: (id: string, patch: Record<string, any>) => void;
}) {
  return (
    <div className="overflow-x-auto plane p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-secondary text-left type-eyebrow text-muted-foreground">
          <tr>
            <th className="p-3">Data</th>
            <th className="p-3">Aluno</th>
            <th className="p-3">Tipo</th>
            <th className="p-3">Valor</th>
            <th className="p-3">Pagamento Pix</th>
            <th className="p-3">Status</th>
            <th className="p-3">Presença</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const value = r.amount_cents ?? pricing[r.type] ?? 0;
            return (
              <tr key={r.id} className="border-b border-border/60">
                <td className="p-3 whitespace-nowrap">
                  <div className="font-medium">{format(new Date(r.booking_date + "T00:00:00"), "dd/MM/yy")}</div>
                  <div className="text-xs text-muted-foreground">{String(r.start_hour).padStart(2, "0")}:00</div>
                </td>
                <td className="p-3">
                  <Link to="/admin/aluno/$id" params={{ id: r.user_id }} className="font-medium hover:underline">
                    {profiles[r.user_id]?.full_name ?? "—"}
                  </Link>
                </td>
                <td className="p-3 text-xs">{r.type.replace("_", " ")}</td>
                <td className="p-3">
                  <span className="whitespace-nowrap type-data font-semibold">{brl(value)}</span>
                </td>
                <td className="p-3">
                  <PaymentStatus status={r.payment_status} />
                </td>
                <td className="p-3">
                  <select value={r.status} onChange={(e) => update(r.id, { status: e.target.value as any })}
                    className="rounded-md border border-input bg-background px-2 py-1">
                    <option value="pendente">Pendente</option>
                    <option value="confirmada">Confirmada</option>
                    <option value="concluida">Concluída</option>
                    <option value="cancelada">Cancelada</option>
                  </select>
                </td>
                <td className="p-3">
                  <div className="flex gap-1">
                    <button
                      onClick={() => update(r.id, { attended: true })}
                      className={`btn-bounce rounded-md border p-1.5 ${r.attended === true ? "border-primary bg-primary/20" : "border-border"}`}
                      title="Presente"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => update(r.id, { attended: false })}
                      className={`btn-bounce rounded-md border p-1.5 ${r.attended === false ? "border-destructive bg-destructive/20" : "border-border"}`}
                      title="Faltou"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Nenhuma reserva.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------- CALENDÁRIO ----------
function CalendarioView({ rows, profiles, cursor, setCursor, onDayClick }: {
  rows: Row[]; profiles: Record<string, Profile>; cursor: Date;
  setCursor: (d: Date) => void; onDayClick: (d: Date) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));

  const byDay = useMemo(() => {
    const m: Record<string, Row[]> = {};
    rows.forEach((r) => { (m[r.booking_date] ||= []).push(r); });
    Object.values(m).forEach((list) => list.sort((a, b) => a.start_hour - b.start_hour));
    return m;
  }, [rows]);

  return (
    <div className="plane">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => setCursor(subMonths(cursor, 1))} className="rounded-full border border-border px-3 py-1 text-sm hover:bg-accent">←</button>
        <div className="type-h3 capitalize">{format(cursor, "MMMM yyyy", { locale: ptBR })}</div>
        <button onClick={() => setCursor(addMonths(cursor, 1))} className="rounded-full border border-border px-3 py-1 text-sm hover:bg-accent">→</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center type-eyebrow text-muted-foreground">
        {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const list = byDay[key] ?? [];
          const inMonth = isSameMonth(d, cursor);
          const today = isSameDay(d, new Date());
          return (
            <button
              key={key}
              onClick={() => onDayClick(d)}
              className={`min-h-[88px] rounded-lg border p-1.5 text-left transition-colors ${
                inMonth ? "border-border bg-background hover:bg-accent" : "border-border/40 bg-muted/30 text-muted-foreground/50"
              } ${today ? "ring-1 ring-primary" : ""}`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className={today ? "font-bold text-primary type-data" : "font-medium type-data"}>{format(d, "d")}</span>
                {list.length > 0 && <span className="rounded-full bg-primary/15 px-1.5 type-micro font-medium text-primary type-data">{list.length}</span>}
              </div>
              <div className="mt-1 space-y-0.5">
                {list.slice(0, 3).map((r) => (
                  <div key={r.id} className="truncate rounded bg-secondary px-1 py-0.5 type-micro text-foreground">
                    {String(r.start_hour).padStart(2,"0")}h · {profiles[r.user_id]?.full_name?.split(" ")[0] ?? "—"}
                  </div>
                ))}
                {list.length > 3 && <div className="type-micro text-muted-foreground">+{list.length - 3}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- KANBAN ----------
function KanbanView({ rows, profiles, pricing, update }: {
  rows: Row[]; profiles: Record<string, Profile>; pricing: Record<string, number>;
  update: (id: string, patch: Record<string, any>) => void;
}) {
  const cols = STATUSES.map((s) => ({ ...s, items: rows.filter((r) => r.status === s.key) }));
  return (
    <div className="flex overflow-x-auto">
      {cols.map((c) => (
        <div key={c.key} className="flex min-w-[15rem] flex-1 flex-col border-l border-border px-4 first:border-l-0 first:pl-0">
          <div className="mb-3 flex items-center justify-between border-b border-border pb-2 type-eyebrow">
            <span>{c.label}</span>
            <span className="type-data">{c.items.length}</span>
          </div>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {c.items.map((r) => {
              const value = r.amount_cents ?? pricing[r.type] ?? 0;
              return (
                <div
                  key={r.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
                  className="bg-card/30 p-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <Link to="/admin/aluno/$id" params={{ id: r.user_id }} className="truncate font-medium hover:underline">
                      {profiles[r.user_id]?.full_name ?? "—"}
                    </Link>
                    <span className="rounded bg-secondary px-1.5 py-0.5 type-micro">{r.type.replace("_"," ")}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-muted-foreground">
                    <span className="type-data">{format(new Date(r.booking_date + "T00:00:00"), "dd/MM")} · {String(r.start_hour).padStart(2,"0")}h</span>
                    <span className="font-medium text-foreground type-data">{brl(value)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {STATUSES.filter((s) => s.key !== r.status).map((s) => (
                      <button
                        key={s.key}
                        onClick={() => update(r.id, { status: s.key })}
                        className="rounded-full border border-border px-2 py-0.5 type-micro hover:bg-accent"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {c.items.length === 0 && <div className="py-4 text-center text-xs text-muted-foreground">Vazio</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- AGENDA DO DIA ----------
function AgendaView({ rows, profiles, pricing, selectedDay, setSelectedDay, update }: {
  rows: Row[]; profiles: Record<string, Profile>; pricing: Record<string, number>;
  selectedDay: Date; setSelectedDay: (d: Date) => void;
  update: (id: string, patch: Record<string, any>) => void;
}) {
  const key = format(selectedDay, "yyyy-MM-dd");
  const dayRows = rows.filter((r) => r.booking_date === key).sort((a, b) => a.start_hour - b.start_hour);
  const hours = Array.from({ length: 16 }, (_, i) => i + 6); // 6h..21h

  return (
    <div className="plane">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => setSelectedDay(addDays(selectedDay, -1))} className="rounded-full border border-border px-3 py-1 text-sm hover:bg-accent">← Dia anterior</button>
        <div className="text-center">
          <div className="type-h3 capitalize">{format(selectedDay, "EEEE", { locale: ptBR })}</div>
          <div className="type-small text-muted-foreground">{format(selectedDay, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</div>
        </div>
        <button onClick={() => setSelectedDay(addDays(selectedDay, 1))} className="rounded-full border border-border px-3 py-1 text-sm hover:bg-accent">Próximo dia →</button>
      </div>
      <input
        type="date"
        value={key}
        onChange={(e) => e.target.value && setSelectedDay(new Date(e.target.value + "T00:00:00"))}
        className="mb-4 rounded-md border border-input bg-background px-2 py-1 text-sm"
      />
      <div className="space-y-1">
        {hours.map((h) => {
          const items = dayRows.filter((r) => r.start_hour === h);
          return (
            <div key={h} className="flex gap-3 border-b border-border/40 py-2">
              <div className="w-14 shrink-0 text-sm font-medium text-muted-foreground type-data">{String(h).padStart(2,"0")}:00</div>
              <div className="flex flex-1 flex-wrap gap-2">
                {items.length === 0 && <div className="type-micro text-muted-foreground/60">—</div>}
                {items.map((r) => {
                  const value = r.amount_cents ?? pricing[r.type] ?? 0;
                  const st = STATUSES.find((s) => s.key === r.status);
                  return (
                    <div key={r.id} className={`min-w-[220px] flex-1 rounded-lg border p-2 text-xs ${st?.color ?? ""}`}>
                      <div className="flex items-center justify-between">
                        <Link to="/admin/aluno/$id" params={{ id: r.user_id }} className="truncate font-semibold hover:underline">
                          {profiles[r.user_id]?.full_name ?? "—"}
                        </Link>
                        <span className="rounded bg-secondary px-1.5 py-0.5 type-micro text-foreground">{r.type.replace("_"," ")}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-foreground/70 type-data">{brl(value)} · {paymentStatusLabel(r.payment_status)}</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => update(r.id, { attended: true })}
                            className={`rounded border p-1 ${r.attended === true ? "border-primary bg-primary/20" : "border-border bg-secondary"}`}
                            title="Presente"
                          ><Check className="h-3 w-3" /></button>
                          <button
                            onClick={() => update(r.id, { attended: false })}
                            className={`rounded border p-1 ${r.attended === false ? "border-destructive bg-destructive/20" : "border-border bg-secondary"}`}
                            title="Faltou"
                          ><X className="h-3 w-3" /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
