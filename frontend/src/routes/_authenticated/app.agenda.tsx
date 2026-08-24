import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { brl } from "@/lib/money";
import { reschedulePaidBooking } from "@/lib/bookings";
import { hasBookingMinimumNotice, isBookingScheduleAllowed } from "@/lib/booking-schedule";
import { cancelLocalPixCheckout, createBookingPixCheckout, type PixCheckout } from "@/lib/payments";
import { PageHeader } from "@/components/PageHeader";
import { PixCheckoutDialog } from "@/components/PixCheckoutDialog";
import { labelType } from "./app.index";
import {
  format,
  addDays,
  addMonths,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isBefore,
  isAfter,
  startOfDay,
  getDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/app/agenda")({
  component: Agenda,
});

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 06..22
const TYPES = [
  { v: "quadra_livre", label: "Quadra livre" },
  { v: "aula_individual", label: "Aula individual" },
  { v: "aula_dupla", label: "Aula em dupla" },
  { v: "aula_trio", label: "Aula em trio" },
  { v: "aula_quarteto", label: "Aula em quarteto" },
  ...(import.meta.env.VITE_ENABLE_TEST_BOOKING_TYPE === "true"
    ? [{ v: "teste", label: "Teste" }]
    : []),
];

type Booking = {
  id: string | null;
  user_id: string | null;
  professor_id: string | null;
  booking_date: string;
  start_hour: number;
  type: string;
  status: string;
  payment_status?: string;
  checkout_order_id?: string | null;
  hold_expires_at?: string | null;
};

type BlockedSlot = {
  id: string;
  block_date: string;
  start_hour: number;
  professor_id: string | null;
  reason: string | null;
};

function Agenda() {
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<Date>(() => addDays(new Date(), 1));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<BlockedSlot[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [professors, setProfessors] = useState<{ id: string; full_name: string | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<string>("quadra_livre");
  const [withProfessor, setWithProfessor] = useState<string>("");
  const [pendingHours, setPendingHours] = useState<Set<number>>(new Set());
  const [people, setPeople] = useState<Record<string, { name: string; avatar: string | null }>>({});
  const [pricing, setPricing] = useState<Record<string, number>>({});
  const [checkout, setCheckout] = useState<PixCheckout | null>(null);
  const [rescheduling, setRescheduling] = useState<Booking | null>(null);

  const monthDays = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);
    const days = eachDayOfInterval({ start, end });
    const pad = getDay(start);
    return { pad, days };
  }, [cursor]);

  const minDate = startOfDay(new Date());
  const maxDate = addDays(minDate, 31);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setUserId(u.user?.id ?? null);

      const [{ data: professorRows }, { data: priceRows }] = await Promise.all([
        (supabase as any).rpc("list_active_professors"),
        supabase.from("pricing").select("booking_type, price_cents").eq("active", true),
      ]);
      setPricing(
        Object.fromEntries((priceRows ?? []).map((row) => [row.booking_type, row.price_cents])),
      );
      setProfessors(professorRows ?? []);
    })();
  }, []);

  const loadMonth = useCallback(async () => {
    const from = format(startOfMonth(cursor), "yyyy-MM-dd");
    const to = format(endOfMonth(cursor), "yyyy-MM-dd");
    const [{ data: bs }, { data: bls }] = await Promise.all([
      (supabase as any)
        .from("bookings_occupancy")
        .select(
          "id, user_id, professor_id, booking_date, start_hour, type, status, payment_status, checkout_order_id, hold_expires_at",
        )
        .gte("booking_date", from)
        .lte("booking_date", to),
      (supabase as any)
        .from("blocked_slots")
        .select("id, block_date, start_hour, professor_id, reason")
        .gte("block_date", from)
        .lte("block_date", to),
    ]);
    setBookings(bs ?? []);
    setBlocks((bls ?? []) as BlockedSlot[]);
  }, [cursor]);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  // Load names + avatars for everyone appearing in current bookings
  useEffect(() => {
    (async () => {
      const ids = new Set<string>();
      bookings.forEach((b) => {
        if (b.user_id) ids.add(b.user_id);
        if (b.professor_id) ids.add(b.professor_id);
      });
      const missing = Array.from(ids).filter((id) => !people[id]);
      if (missing.length === 0) return;
      const { data } = await (supabase as any)
        .from("profiles_public")
        .select("id, full_name, avatar_url")
        .in("id", missing);
      const entries = await Promise.all(
        (data ?? []).map(async (p: any) => {
          let signed: string | null = null;
          if (p.avatar_url) {
            const { data: s } = await supabase.storage
              .from("avatars")
              .createSignedUrl(p.avatar_url, 3600);
            signed = s?.signedUrl ?? null;
          }
          return [p.id, { name: p.full_name ?? "Aluno", avatar: signed }] as const;
        }),
      );
      setPeople((prev) => {
        const next = { ...prev };
        entries.forEach(([id, info]) => {
          next[id] = info;
        });
        return next;
      });
    })();
  }, [bookings, people]);

  // Reset pending selection when date/type changes
  useEffect(() => {
    setPendingHours(new Set());
  }, [selected, type]);

  const dayBookings = (d: Date) =>
    bookings.filter((b) => b.booking_date === format(d, "yyyy-MM-dd"));

  const isPickable = (d: Date) => !isBefore(d, minDate) && !isAfter(d, maxDate);

  const selectedBookings = dayBookings(selected);
  const takenHours = new Set(selectedBookings.map((b) => b.start_hour));
  const selectedDateStr = format(selected, "yyyy-MM-dd");
  const activeProfessorId =
    rescheduling?.professor_id ??
    (!["quadra_livre", "teste"].includes(type) ? withProfessor || null : null);
  const dayBlocks = blocks.filter(
    (b) =>
      b.block_date === selectedDateStr &&
      (b.professor_id === null || b.professor_id === activeProfessorId),
  );
  const blockedHours = new Map(dayBlocks.map((b) => [b.start_hour, b.reason] as const));
  // Só horários abertos: sem reserva e sem bloqueio.
  const openHours = HOURS.filter(
    (h) =>
      !takenHours.has(h) &&
      blockedHours.get(h) === undefined &&
      isBookingScheduleAllowed(selectedDateStr, h),
  );

  const toggleHour = (h: number) => {
    playPop();
    if (rescheduling) {
      setPendingHours(new Set([h]));
      return;
    }
    setPendingHours((prev) => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next;
    });
  };

  const beginReschedule = (booking: Booking) => {
    if (!hasBookingMinimumNotice(booking.booking_date, booking.start_hour)) {
      toast.error("A troca exige no mínimo 2 horas de antecedência.");
      return;
    }
    playPop();
    setRescheduling(booking);
    setType(booking.type);
    setWithProfessor(booking.professor_id ?? "");
    setPendingHours(new Set());
  };

  const stopReschedule = () => {
    playPop();
    setRescheduling(null);
    setPendingHours(new Set());
  };

  const confirmReschedule = async () => {
    const newStartHour = [...pendingHours][0];
    if (!rescheduling?.id || newStartHour == null) return;
    playPop();
    setLoading(true);
    try {
      await reschedulePaidBooking({
        bookingId: rescheduling.id,
        newBookingDate: selectedDateStr,
        newStartHour,
      });
      toast.success("Horário trocado com sucesso", {
        description: `Seu pagamento foi mantido para ${format(selected, "dd/MM")} às ${String(newStartHour).padStart(2, "0")}:00.`,
      });
      setRescheduling(null);
      setPendingHours(new Set());
      await loadMonth();
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível trocar o horário.");
      await loadMonth();
    } finally {
      setLoading(false);
    }
  };

  const confirmBooking = async () => {
    if (!userId || pendingHours.size === 0) return;
    playPop();
    setLoading(true);
    try {
      const needsProf = !["quadra_livre", "teste"].includes(type);
      const created = await createBookingPixCheckout({
        bookingDate: format(selected, "yyyy-MM-dd"),
        hours: [...pendingHours],
        bookingType: type,
        professorId: needsProf && withProfessor ? withProfessor : null,
      });
      setPendingHours(new Set());
      await loadMonth();
      setCheckout(created);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível gerar o pagamento.");
    } finally {
      setLoading(false);
    }
  };

  const cancel = async (id: string) => {
    playPop();
    const b = bookings.find((x) => x.id === id);
    if (b) {
      if (b.checkout_order_id && b.payment_status === "pendente") {
        try {
          await cancelLocalPixCheckout(b.checkout_order_id);
          toast.success("Cobrança cancelada e horário liberado");
          await loadMonth();
        } catch (error: any) {
          toast.error(error?.message ?? "Não foi possível cancelar esta cobrança.");
        }
        return;
      }
      if (b.payment_status === "pago") {
        beginReschedule(b);
        return;
      }
      if (!hasBookingMinimumNotice(b.booking_date, b.start_hour)) {
        toast.error("Cancelamento só é permitido com no mínimo 2 horas de antecedência.");
        return;
      }
    }
    const { error } = await supabase.from("bookings").update({ status: "cancelada" }).eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível cancelar. Tente de novo.");
    toast.success("Reserva cancelada");
    setBookings((b) => b.filter((x) => x.id !== id));
  };

  return (
    <div className="stack-app animate-float-in">
      <PageHeader
        eyebrow="Agenda"
        title="Agenda da quadra"
        subtitle="Escolha o dia e o horário livre · 06h às 22h"
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Calendar */}
        <div className="plane">
          <div className="mb-4 flex items-center justify-between">
            <button
              onClick={() => {
                playPop();
                setCursor(addMonths(cursor, -1));
              }}
              className="btn-bounce rounded-full p-2 hover:bg-secondary"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="type-h3 capitalize">{format(cursor, "MMMM yyyy", { locale: ptBR })}</h2>
            <button
              onClick={() => {
                playPop();
                setCursor(addMonths(cursor, 1));
              }}
              className="btn-bounce rounded-full p-2 hover:bg-secondary"
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-2 grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: monthDays.pad }).map((_, i) => (
              <div key={`p${i}`} />
            ))}
            {monthDays.days.map((d) => {
              const sel = isSameDay(d, selected);
              const pick = isPickable(d) && isSameMonth(d, cursor);
              const dayList = dayBookings(d);
              const count = dayList.length;
              return (
                <button
                  key={d.toISOString()}
                  disabled={!pick}
                  onClick={() => {
                    playPop();
                    setSelected(d);
                  }}
                  className={`relative flex aspect-square flex-col items-center justify-start gap-0.5 rounded-xl p-1 text-sm font-medium transition ${
                    sel
                      ? "bg-primary text-primary-foreground"
                      : pick
                        ? "bg-secondary hover:bg-muted"
                        : "bg-muted/40 text-muted-foreground/40"
                  }`}
                >
                  <span className="leading-none type-data">{d.getDate()}</span>
                  {count > 0 && (
                    <span className="mt-auto rounded-full bg-primary/80 px-1.5 py-[1px] type-micro font-bold text-primary-foreground">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Reservas disponíveis a partir de hoje. Escolha o dia que preferir.
          </p>
        </div>

        {/* Booking panel */}
        <div className="space-y-4 plane">
          <div>
            <div className="type-eyebrow text-muted-foreground">Selecionado</div>
            <div className="type-h3 capitalize">
              {format(selected, "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </div>
          </div>

          {rescheduling && (
            <div className="border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-start gap-3">
                <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">Trocar reserva paga</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Atual: {rescheduling.booking_date.split("-").reverse().join("/")} às{" "}
                    {String(rescheduling.start_hour).padStart(2, "0")}:00. Escolha abaixo um novo
                    dia e um horário livre.
                  </p>
                  <p className="mt-1 text-xs font-medium text-primary">
                    O pagamento, o produto e o professor serão mantidos.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={stopReschedule}
                  disabled={loading}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Sair
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Tipo de reserva
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={Boolean(rescheduling)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            >
              {TYPES.map((t) => (
                <option key={t.v} value={t.v} disabled={pricing[t.v] == null}>
                  {t.label}
                  {pricing[t.v] == null ? " · indisponível" : ` · ${brl(pricing[t.v])}/h`}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {pricing[type] == null
                ? "Preço indisponível para este tipo."
                : `${brl(pricing[type])} por horário de 1 hora, definido na tabela do admin.`}
            </p>
          </div>

          {!["quadra_livre", "teste"].includes(type) && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Professor
              </label>
              <select
                value={withProfessor}
                onChange={(e) => setWithProfessor(e.target.value)}
                disabled={Boolean(rescheduling)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Sem preferência</option>
                {professors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? "Professor"}
                  </option>
                ))}
              </select>
              {professors.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Nenhum professor cadastrado ainda.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Forma de pagamento
            </label>
            <div className="flex items-center justify-between border border-input bg-background px-3 py-2 text-sm">
              <span className="font-medium">Pix</span>
              <span className="text-xs text-muted-foreground">
                {rescheduling ? "Pagamento já confirmado" : "Confirmação automática"}
              </span>
            </div>
          </div>

          <div>
            <div className="mb-2 type-eyebrow">
              {rescheduling ? "Escolha o novo horário" : "Horários livres"}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {openHours.map((h) => {
                const taken = takenHours.has(h);
                const blockedReason = blockedHours.get(h);
                const slot = selectedBookings.find((b) => b.start_hour === h);
                const mine = Boolean(slot?.id && slot.user_id === userId);
                if (blockedReason !== undefined && !slot) {
                  return (
                    <div
                      key={h}
                      title={blockedReason ? `Bloqueado: ${blockedReason}` : "Horário bloqueado"}
                      className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-destructive/40 bg-destructive/10 px-2 py-2 text-xs font-semibold text-destructive/80"
                    >
                      <span className="type-data">{String(h).padStart(2, "0")}:00</span>
                      <span className="type-micro font-normal">Bloqueado</span>
                    </div>
                  );
                }
                if (slot) {
                  const owner = people[slot.user_id ?? ""];
                  return (
                    <button
                      key={h}
                      onClick={() => mine && slot.id && cancel(slot.id)}
                      disabled={!mine}
                      className={`btn-bounce flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2 text-xs font-semibold ${
                        mine
                          ? "border-primary bg-primary/20 cursor-pointer"
                          : "border-border bg-muted/60 cursor-not-allowed"
                      }`}
                      title={mine ? "Sua reserva — clique para cancelar" : "Horário ocupado"}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="type-data">{String(h).padStart(2, "0")}:00</span>
                        {mine && <span className="type-micro font-bold text-primary">SUA</span>}
                      </div>
                      {mine ? (
                        <>
                          <MiniAvatar url={owner?.avatar ?? null} name={owner?.name ?? "?"} />
                          <span className="line-clamp-1 max-w-full type-micro font-medium">
                            {owner?.name?.split(" ")[0] ?? "Você"}
                          </span>
                        </>
                      ) : (
                        <span className="type-micro font-medium text-muted-foreground">
                          Ocupado
                        </span>
                      )}
                    </button>
                  );
                }
                const isPending = pendingHours.has(h);
                return (
                  <button
                    key={h}
                    disabled={taken || loading}
                    onClick={() => toggleHour(h)}
                    className={`btn-bounce rounded-full border px-2 py-2 text-xs font-semibold type-data ${
                      isPending
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary hover:border-primary"
                    }`}
                  >
                    {String(h).padStart(2, "0")}:00
                  </button>
                );
              })}
            </div>
            {openHours.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">Nenhum horário livre neste dia.</p>
            )}
            {pendingHours.size > 0 && (
              <div className="mt-4 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <div className="text-xs text-muted-foreground">
                  {pendingHours.size} horário{pendingHours.size > 1 ? "s" : ""} selecionado
                  {pendingHours.size > 1 ? "s" : ""} ·{" "}
                  {Array.from(pendingHours)
                    .sort((a, b) => a - b)
                    .map((h) => `${String(h).padStart(2, "0")}h`)
                    .join(", ")}
                </div>
                {rescheduling ? (
                  <div className="border-y border-primary/20 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Nova reserva</span>
                      <strong className="type-data text-right">
                        {format(selected, "dd/MM")} ·{" "}
                        {String([...pendingHours][0]).padStart(2, "0")}:00
                      </strong>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Nenhum novo pagamento será gerado.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between border-y border-primary/20 py-2">
                      <span className="text-sm text-muted-foreground">Total</span>
                      <strong className="type-data text-lg">
                        {pricing[type] == null
                          ? "Preço indisponível"
                          : brl(pricing[type] * pendingHours.size)}
                      </strong>
                    </div>
                    {pricing[type] != null && (
                      <div className="text-right text-xs text-muted-foreground">
                        {brl(pricing[type])} × {pendingHours.size} horário
                        {pendingHours.size > 1 ? "s" : ""}
                      </div>
                    )}
                  </>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={rescheduling ? confirmReschedule : confirmBooking}
                    disabled={loading || (!rescheduling && pricing[type] == null)}
                    className="btn-bounce flex-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Confirmando…
                      </span>
                    ) : rescheduling ? (
                      "Confirmar troca"
                    ) : (
                      "Ir para pagamento"
                    )}
                  </button>
                  <button
                    onClick={() => {
                      playPop();
                      setPendingHours(new Set());
                    }}
                    disabled={loading}
                    className="btn-bounce rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    {rescheduling ? "Escolher outro" : "Limpar"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {selectedBookings.some((b) => b.user_id === userId) && (
            <div className="border-t border-border pt-4">
              <div className="mb-2 type-eyebrow">Minhas reservas neste dia</div>
              <ul className="space-y-1 text-sm">
                {selectedBookings
                  .filter((b) => b.id && b.user_id === userId)
                  .map((b) => (
                    <li key={b.id} className="flex justify-between">
                      <span className="type-data">
                        {String(b.start_hour).padStart(2, "0")}:00 · {labelType(b.type)}
                        {b.payment_status === "pendente" ? " · aguardando Pix" : ""}
                      </span>
                      <button
                        onClick={() => b.id && cancel(b.id)}
                        className={`text-xs hover:underline ${b.payment_status === "pago" ? "text-primary" : "text-destructive"}`}
                      >
                        {b.payment_status === "pendente"
                          ? "cancelar cobrança"
                          : b.payment_status === "pago"
                            ? "trocar horário"
                            : "cancelar"}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {checkout && (
        <PixCheckoutDialog
          checkout={checkout}
          onClose={() => setCheckout(null)}
          onPaid={() => {
            void loadMonth();
          }}
        />
      )}
    </div>
  );
}

function MiniAvatar({ url, name }: { url: string | null; name: string }) {
  const initials = (name || "?")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border bg-primary type-micro font-bold text-primary-foreground">
      {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : initials}
    </div>
  );
}
