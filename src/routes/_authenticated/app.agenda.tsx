import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { PageHeader } from "@/components/PageHeader";
import { labelType } from "./app.index";
import {
  format, addDays, addMonths, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isSameMonth, isBefore, startOfDay, getDay,
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
];

type Booking = {
  id: string;
  user_id: string;
  professor_id: string | null;
  booking_date: string;
  start_hour: number;
  type: string;
  status: string;
};

const PAYMENT_METHODS = [
  { v: "pix", label: "PIX" },
  { v: "cartao_credito", label: "Cartão de crédito" },
  { v: "cartao_debito", label: "Cartão de débito" },
  { v: "dinheiro", label: "Dinheiro" },
  { v: "mensalidade", label: "Na mensalidade" },
];

type BlockedSlot = { id: string; block_date: string; start_hour: number; professor_id: string | null; reason: string | null };

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
  const [paymentMethod, setPaymentMethod] = useState<string>("pix");
  const [pendingHours, setPendingHours] = useState<Set<number>>(new Set());
  const [people, setPeople] = useState<Record<string, { name: string; avatar: string | null }>>({});

  const monthDays = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);
    const days = eachDayOfInterval({ start, end });
    const pad = getDay(start);
    return { pad, days };
  }, [cursor]);

  const minDate = startOfDay(new Date());

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setUserId(u.user?.id ?? null);

      const { data: profIds } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "professor");
      if (profIds && profIds.length) {
        const ids = profIds.map((r) => r.user_id);
        const { data: profs } = await (supabase as any)
          .from("profiles_public")
          .select("id, full_name")
          .in("id", ids);
        setProfessors(profs ?? []);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const from = format(startOfMonth(cursor), "yyyy-MM-dd");
      const to = format(endOfMonth(cursor), "yyyy-MM-dd");
      const [{ data: bs }, { data: bls }] = await Promise.all([
        (supabase as any).from("bookings_occupancy")
          .select("id, user_id, professor_id, booking_date, start_hour, type, status")
          .gte("booking_date", from).lte("booking_date", to),
        (supabase as any).from("blocked_slots")
          .select("id, block_date, start_hour, professor_id, reason")
          .gte("block_date", from).lte("block_date", to),
      ]);
      setBookings(bs ?? []);
      setBlocks((bls ?? []) as BlockedSlot[]);
    })();
  }, [cursor]);

  // Load names + avatars for everyone appearing in current bookings
  useEffect(() => {
    (async () => {
      const ids = new Set<string>();
      bookings.forEach((b) => {
        ids.add(b.user_id);
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
            const { data: s } = await supabase.storage.from("avatars").createSignedUrl(p.avatar_url, 3600);
            signed = s?.signedUrl ?? null;
          }
          return [p.id, { name: p.full_name ?? "Aluno", avatar: signed }] as const;
        })
      );
      setPeople((prev) => {
        const next = { ...prev };
        entries.forEach(([id, info]) => { next[id] = info; });
        return next;
      });
    })();
  }, [bookings]);

  // Reset pending selection when date/type changes
  useEffect(() => {
    setPendingHours(new Set());
  }, [selected, type]);

  const dayBookings = (d: Date) =>
    bookings.filter((b) => b.booking_date === format(d, "yyyy-MM-dd"));

  const isPickable = (d: Date) => !isBefore(d, minDate);

  const selectedBookings = dayBookings(selected);
  const takenHours = new Set(selectedBookings.map((b) => b.start_hour));
  const selectedDateStr = format(selected, "yyyy-MM-dd");
  const dayBlocks = blocks.filter((b) => b.block_date === selectedDateStr && b.professor_id === null);
  const blockedHours = new Map(dayBlocks.map((b) => [b.start_hour, b.reason] as const));
  // Só horários abertos: sem reserva e sem bloqueio.
  const openHours = HOURS.filter((h) => !takenHours.has(h) && blockedHours.get(h) === undefined);

  const toggleHour = (h: number) => {
    playPop();
    setPendingHours((prev) => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next;
    });
  };

  const confirmBooking = async () => {
    if (!userId || pendingHours.size === 0) return;
    playPop();
    setLoading(true);
    try {
      const needsProf = type !== "quadra_livre";
      const rows = Array.from(pendingHours).map((hour) => ({
        user_id: userId,
        professor_id: needsProf && withProfessor ? withProfessor : null,
        booking_date: format(selected, "yyyy-MM-dd"),
        start_hour: hour,
        type: type as "quadra_livre" | "aula_individual" | "aula_dupla" | "aula_trio" | "aula_quarteto",
        status: "pendente" as const,
        payment_method: paymentMethod,
      }));
      const { error } = await supabase.from("bookings").insert(rows);
      if (error) throw error;
      toast.success(
        pendingHours.size === 1
          ? `Reservado! ${format(selected, "dd/MM")} às ${Array.from(pendingHours)[0]}:00`
          : `${pendingHours.size} horários reservados em ${format(selected, "dd/MM")}`
      );
      setPendingHours(new Set());
      const { data } = await supabase
        .from("bookings")
        .select("id, user_id, professor_id, booking_date, start_hour, type, status")
        .gte("booking_date", format(startOfMonth(cursor), "yyyy-MM-dd"))
        .lte("booking_date", format(endOfMonth(cursor), "yyyy-MM-dd"));
      setBookings(data ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível reservar. Tente de novo.");
    } finally {
      setLoading(false);
    }
  };


  const cancel = async (id: string) => {
    playPop();
    const b = bookings.find((x) => x.id === id);
    if (b) {
      const start = new Date(`${b.booking_date}T${String(b.start_hour).padStart(2, "0")}:00:00`);
      const diffMs = start.getTime() - Date.now();
      if (diffMs < 2 * 60 * 60 * 1000) {
        toast.error("Cancelamento só é permitido com no mínimo 2 horas de antecedência.");
        return;
      }
    }
    const { error } = await supabase.from("bookings").delete().eq("id", id);
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
              onClick={() => { playPop(); setCursor(addMonths(cursor, -1)); }}
              className="btn-bounce rounded-full p-2 hover:bg-secondary"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="type-h3 capitalize">
              {format(cursor, "MMMM yyyy", { locale: ptBR })}
            </h2>
            <button
              onClick={() => { playPop(); setCursor(addMonths(cursor, 1)); }}
              className="btn-bounce rounded-full p-2 hover:bg-secondary"
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-2 grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => <div key={i}>{d}</div>)}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: monthDays.pad }).map((_, i) => <div key={`p${i}`} />)}
            {monthDays.days.map((d) => {
              const sel = isSameDay(d, selected);
              const pick = isPickable(d) && isSameMonth(d, cursor);
              const dayList = dayBookings(d);
              const count = dayList.length;
              return (
                <button
                  key={d.toISOString()}
                  disabled={!pick}
                  onClick={() => { playPop(); setSelected(d); }}
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

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo de reserva</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            >
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </div>

          {type !== "quadra_livre" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Professor</label>
              <select
                value={withProfessor}
                onChange={(e) => setWithProfessor(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Sem preferência</option>
                {professors.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name ?? "Professor"}</option>
                ))}
              </select>
              {professors.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Nenhum professor cadastrado ainda.</p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Forma de pagamento</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            >
              {PAYMENT_METHODS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </div>



          <div>
            <div className="mb-2 type-eyebrow">Horários livres</div>
            <div className="grid grid-cols-4 gap-2">
              {openHours.map((h) => {
                const taken = takenHours.has(h);
                const blockedReason = blockedHours.get(h);
                const slot = selectedBookings.find((b) => b.start_hour === h);
                const mine = slot && slot.user_id === userId;
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
                  const owner = people[slot.user_id];
                  return (
                    <button
                      key={h}
                      onClick={() => mine && cancel(slot.id)}
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
                        <span className="type-micro font-medium text-muted-foreground">Ocupado</span>
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
                  {pendingHours.size} horário{pendingHours.size > 1 ? "s" : ""} selecionado{pendingHours.size > 1 ? "s" : ""} ·{" "}
                  {Array.from(pendingHours).sort((a, b) => a - b).map((h) => `${String(h).padStart(2, "0")}h`).join(", ")}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={confirmBooking}
                    disabled={loading}
                    className="btn-bounce flex-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Confirmando…
                      </span>
                    ) : (
                      "Confirmar horário"
                    )}
                  </button>
                  <button
                    onClick={() => { playPop(); setPendingHours(new Set()); }}
                    disabled={loading}
                    className="btn-bounce rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    Limpar
                  </button>
                </div>
              </div>
            )}
          </div>


          {selectedBookings.some((b) => b.user_id === userId) && (
            <div className="border-t border-border pt-4">
              <div className="mb-2 type-eyebrow">Minhas reservas neste dia</div>
              <ul className="space-y-1 text-sm">
                {selectedBookings.filter((b) => b.user_id === userId).map((b) => (
                  <li key={b.id} className="flex justify-between">
                    <span className="type-data">{String(b.start_hour).padStart(2, "0")}:00 · {labelType(b.type)}</span>
                    <button onClick={() => cancel(b.id)} className="text-xs text-destructive hover:underline">
                      cancelar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniAvatar({ url, name }: { url: string | null; name: string }) {
  const initials = (name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border bg-primary type-micro font-bold text-primary-foreground">
      {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : initials}
    </div>
  );
}
