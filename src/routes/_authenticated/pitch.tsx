import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import {
  Trophy,
  Calendar,
  MessageCircle,
  Wallet,
  Users,
  Building2,
  GraduationCap,
  TrendingUp,
  Sparkles,
  Target,
  ChevronDown,
  Copy,
  RotateCcw,
  Phone,
  Check,
  Rocket,
} from "lucide-react";
import hero from "@/assets/pitch/hero-champion.jpg.asset.json";
import clay from "@/assets/pitch/clay-court.jpg.asset.json";
import serve from "@/assets/pitch/serve-action.jpg.asset.json";
import arena from "@/assets/pitch/arena.jpg.asset.json";
import ball from "@/assets/pitch/ball-impact.jpg.asset.json";
import community from "@/assets/pitch/community.jpg.asset.json";

// ─────────────────────────────────────────────────────────────
// Search-param scenario state
// ─────────────────────────────────────────────────────────────
const scenarioSchema = z.object({
  clients: fallback(z.number().int().min(50).max(10000), 1000).default(1000),
  entry: fallback(z.number().int().min(0).max(2000), 499).default(499),
  monthly: fallback(z.number().int().min(0).max(99), 14).default(14),
  reservas: fallback(z.number().int().min(0).max(200), 50).default(50),
  ticket: fallback(z.number().int().min(20).max(300), 80).default(80),
  taxa: fallback(z.number().min(0).max(20), 3).default(3),
  taxaMode: fallback(z.enum(["pct", "fix"]), "pct").default("pct"),
  // Custos operacionais
  infraPerClient: fallback(z.number().min(0).max(20), 3).default(3),
  payFeePct: fallback(z.number().min(0).max(8), 1.5).default(1.5),
  supportPerClient: fallback(z.number().min(0).max(20), 2).default(2),
  cacPerNew: fallback(z.number().int().min(0).max(500), 80).default(80),
  newPerMonth: fallback(z.number().int().min(0).max(2000), 60).default(60),
  fixedTeam: fallback(z.number().int().min(0).max(200000), 15000).default(15000),
});

type Scenario = z.infer<typeof scenarioSchema>;

export const Route = createFileRoute("/_authenticated/pitch")({
  validateSearch: zodValidator(scenarioSchema),
  head: () => ({
    meta: [
      { title: "QuadraFast — Pitch interativo" },
      {
        name: "description",
        content:
          "Plataforma de gestão para quadras e professores de tênis. Pitch interativo com simuladores de receita ao vivo.",
      },
      { property: "og:title", content: "QuadraFast — Pitch" },
      {
        property: "og:description",
        content: "Democratizar o tênis e ganhar na escala. Veja os cenários ao vivo.",
      },
      { property: "og:image", content: hero.url },
    ],
  }),
  component: PitchPage,
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const num = (n: number) => Math.round(n).toLocaleString("pt-BR");

function useScenario() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const set = (patch: Partial<Scenario>) =>
    navigate({ to: "/pitch", search: (prev: Scenario) => ({ ...prev, ...patch }), replace: true });
  return { s: search, set };
}

function useCountUp(value: number, duration = 600) {
  const [v, setV] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const start = prev.current;
    const delta = value - start;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(start + delta * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return v;
}

// ─────────────────────────────────────────────────────────────
// Section index
// ─────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: "capa", label: "Abertura" },
  { id: "dor", label: "A dor" },
  { id: "posicionamento", label: "Posicionamento" },
  { id: "receita", label: "5 fontes de receita" },
  { id: "publicos", label: "3 públicos" },
  { id: "mercado", label: "Mercado" },
  { id: "sim-vendas", label: "Simulador · Vendas" },
  { id: "sim-trans", label: "Simulador · Transações" },
  { id: "planos", label: "Planos" },
  { id: "sim-total", label: "Simulador · Receita total" },
  { id: "custos", label: "Custos & Margem" },
  { id: "modulos", label: "Módulos futuros" },
  { id: "mvp", label: "MVP enxuto" },
  { id: "fases", label: "Fases" },
  { id: "fechamento", label: "Vamos jogar" },
];

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
function PitchPage() {
  const [active, setActive] = useState(0);
  const obs = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    obs.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const idx = Number((e.target as HTMLElement).dataset.idx);
            setActive(idx);
          }
        });
      },
      { threshold: 0.55 },
    );
    document.querySelectorAll<HTMLElement>("[data-section]").forEach((el) => obs.current?.observe(el));
    return () => obs.current?.disconnect();
  }, []);

  return (
    <div
      className="pitch-root min-h-screen"
      style={{
        // local theme — clay / forest / cream / ball-yellow
        ["--clay" as any]: "oklch(0.58 0.16 38)",
        ["--clay-soft" as any]: "oklch(0.70 0.12 40)",
        ["--forest" as any]: "oklch(0.30 0.06 150)",
        ["--forest-deep" as any]: "oklch(0.20 0.04 155)",
        ["--cream" as any]: "oklch(0.96 0.025 85)",
        ["--cream-soft" as any]: "oklch(0.92 0.03 85)",
        ["--ball" as any]: "oklch(0.88 0.19 100)",
        ["--ink" as any]: "oklch(0.18 0.02 150)",
        background: "var(--cream)",
        color: "var(--ink)",
        scrollSnapType: "y mandatory",
        overflowY: "auto",
        height: "100vh",
      }}
    >
      <style>{`
        .pitch-root * { font-feature-settings: "ss01","cv11"; }
        .pitch-section { scroll-snap-align: start; min-height: 100vh; position: relative; display: flex; flex-direction: column; padding: 96px 6vw 64px; }
        .pitch-h { font-family: "Space Grotesk", system-ui; font-weight: 700; letter-spacing: -0.03em; line-height: 1.02; }
        .pitch-num { font-family: "Space Grotesk", system-ui; font-weight: 800; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
        .pitch-kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; }
        .pitch-dashed {
          background-image: linear-gradient(to right, var(--ball) 50%, transparent 0%);
          background-position: top;
          background-size: 14px 2px;
          background-repeat: repeat-x;
        }
        @keyframes pitch-fade { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        .pitch-section > * { animation: pitch-fade 0.7s cubic-bezier(0.2,0.7,0.3,1) both; }
        .pitch-section > *:nth-child(2) { animation-delay: 0.08s; }
        .pitch-section > *:nth-child(3) { animation-delay: 0.16s; }
        .pitch-section > *:nth-child(4) { animation-delay: 0.24s; }
        .pitch-section > *:nth-child(5) { animation-delay: 0.32s; }
        .pitch-range { -webkit-appearance: none; appearance: none; width: 100%; height: 8px; border-radius: 999px; background: color-mix(in oklab, var(--clay) 20%, transparent); outline: none; cursor: pointer; }
        .pitch-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 24px; height: 24px; border-radius: 50%; background: var(--clay); border: 3px solid var(--cream); box-shadow: 0 2px 8px color-mix(in oklab, var(--clay) 40%, transparent); cursor: grab; }
        .pitch-range::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.1); }
        .pitch-range::-moz-range-thumb { width: 24px; height: 24px; border-radius: 50%; background: var(--clay); border: 3px solid var(--cream); box-shadow: 0 2px 8px color-mix(in oklab, var(--clay) 40%, transparent); cursor: grab; }
      `}</style>

      <PitchHeader active={active} />

      <Capa />
      <Dor />
      <Posicionamento />
      <Receita5Fontes />
      <Publicos />
      <Mercado />
      <SimVendas />
      <SimTransacoes />
      <Planos />
      <SimTotal />
      <SimCustos />
      <Modulos />
      <MVP />
      <Fases />
      <Fechamento />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────
function PitchHeader({ active }: { active: number }) {
  const pct = ((active + 1) / SECTIONS.length) * 100;
  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        backdropFilter: "blur(12px)",
        background: "color-mix(in oklab, var(--cream) 82%, transparent)",
        borderBottom: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)",
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
        <div className="flex items-center gap-2">
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              background: "var(--ball)",
              boxShadow: "inset -3px -3px 0 color-mix(in oklab, var(--clay) 18%, transparent)",
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", inset: 0, borderRadius: 999, border: "1.5px dashed color-mix(in oklab, var(--clay) 45%, transparent)" }} />
          </div>
          <span className="pitch-h" style={{ fontSize: 18 }}>
            Quadra<span style={{ color: "var(--clay)" }}>Fast</span>
          </span>
        </div>

        <nav className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {SECTIONS.map((s, i) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              title={s.label}
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: i === active ? "var(--clay)" : "color-mix(in oklab, var(--ink) 18%, transparent)",
                transition: "all 280ms",
                transform: i === active ? "scale(1.6)" : "scale(1)",
              }}
            />
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <span className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--ink) 55%, transparent)" }}>
            {String(active + 1).padStart(2, "0")} / {SECTIONS.length}
          </span>
        </div>
      </div>

      {/* Trajectory progress */}
      <div style={{ height: 2, background: "color-mix(in oklab, var(--ink) 6%, transparent)" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "linear-gradient(90deg, var(--clay), var(--ball))",
            transition: "width 500ms cubic-bezier(0.2,0.7,0.3,1)",
          }}
        />
      </div>
    </header>
  );
}

function Section({
  id,
  idx,
  bg,
  children,
}: {
  id: string;
  idx: number;
  bg?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-section
      data-idx={idx}
      className="pitch-section"
      style={{ background: bg }}
    >
      {children}
      <div className="pitch-kicker" style={{ position: "absolute", bottom: 24, right: 32, color: "color-mix(in oklab, var(--ink) 45%, transparent)" }}>
        {String(idx + 1).padStart(2, "0")} · {SECTIONS[idx].label}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 1. Capa
// ─────────────────────────────────────────────────────────────
function Capa() {
  return (
    <Section id="capa" idx={0}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(120deg, color-mix(in oklab, var(--cream) 88%, transparent) 40%, transparent 70%), url(${hero.url})`,
          backgroundSize: "cover",
          backgroundPosition: "center right",
          zIndex: 0,
        }}
      />
      <div style={{ position: "relative", zIndex: 1, marginTop: "auto", marginBottom: "auto", maxWidth: 880 }}>
        <span className="pitch-kicker" style={{ color: "var(--clay)" }}>
          QuadraFast · Pitch 2026
        </span>
        <h1 className="pitch-h" style={{ fontSize: "clamp(48px, 8vw, 112px)", marginTop: 24 }}>
          Democratizar o tênis.<br />
          <span style={{ color: "var(--clay)" }}>Ganhar na escala.</span>
        </h1>
        <p style={{ fontSize: 22, marginTop: 28, maxWidth: 640, color: "color-mix(in oklab, var(--ink) 75%, transparent)", lineHeight: 1.45 }}>
          Uma plataforma feita para professores, quadras e arenas. Entrada baixa, manutenção simbólica
          e o jogo grande nas transações e módulos premium.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 40, flexWrap: "wrap" }}>
          <a
            href="#sim-vendas"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 24px",
              borderRadius: 999,
              background: "var(--clay)",
              color: "var(--cream)",
              fontWeight: 600,
              boxShadow: "0 12px 32px -12px var(--clay)",
            }}
          >
            <Target size={18} /> Brincar com os cenários
          </a>
          <a
            href="#dor"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 24px",
              borderRadius: 999,
              border: "1.5px solid color-mix(in oklab, var(--ink) 20%, transparent)",
              fontWeight: 600,
            }}
          >
            Ver a apresentação <ChevronDown size={18} />
          </a>
        </div>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 2. Dor
// ─────────────────────────────────────────────────────────────
function Dor() {
  const dores = [
    { icon: MessageCircle, t: "WhatsApp lotado", d: "Conversas espalhadas, horários trocados, alunos perdidos." },
    { icon: Calendar, t: "Caderno e planilha", d: "Agenda manual, sem visão real da ocupação." },
    { icon: Wallet, t: "Cobrança quebrada", d: "Mensalidade atrasa, inadimplência sobe, ninguém sabe quem deve." },
  ];
  return (
    <Section id="dor" idx={1} bg="var(--cream-soft)">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center", height: "100%", marginTop: 32 }}>
        <div>
          <span className="pitch-kicker" style={{ color: "var(--clay)" }}>A dor real do mercado</span>
          <h2 className="pitch-h" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 16 }}>
            Tem milhares de quadras e professores rodando com<br />
            <span style={{ color: "var(--clay)" }}>WhatsApp, caderno e planilha.</span>
          </h2>
          <p style={{ fontSize: 18, marginTop: 24, color: "color-mix(in oklab, var(--ink) 70%, transparent)", lineHeight: 1.5 }}>
            Eles perdem aulas, perdem reservas, perdem dinheiro. E não conseguem pagar
            R$ 500 por mês por um sistema engessado. A dor existe. A solução tem que caber no bolso.
          </p>
          <div style={{ display: "grid", gap: 12, marginTop: 32 }}>
            {dores.map((d) => (
              <div
                key={d.t}
                style={{
                  display: "flex",
                  gap: 16,
                  padding: 18,
                  borderRadius: 16,
                  background: "var(--cream)",
                  border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)",
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "color-mix(in oklab, var(--clay) 12%, transparent)", color: "var(--clay)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <d.icon size={22} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{d.t}</div>
                  <div style={{ fontSize: 14, color: "color-mix(in oklab, var(--ink) 60%, transparent)", marginTop: 2 }}>{d.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            backgroundImage: `url(${clay.url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            borderRadius: 28,
            aspectRatio: "4/5",
            boxShadow: "0 30px 80px -30px rgba(0,0,0,0.3)",
          }}
        />
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 3. Posicionamento
// ─────────────────────────────────────────────────────────────
function Posicionamento() {
  return (
    <Section id="posicionamento" idx={2} bg="var(--forest-deep)">
      <div style={{ color: "var(--cream)", marginTop: "auto", marginBottom: "auto", maxWidth: 1000 }}>
        <span className="pitch-kicker" style={{ color: "var(--ball)" }}>Novo posicionamento</span>
        <h2 className="pitch-h" style={{ fontSize: "clamp(44px, 7vw, 96px)", marginTop: 24 }}>
          Sua plataforma de agendamento por{" "}
          <span style={{ color: "var(--ball)" }}>R$ 499</span>,
          com manutenção simbólica de{" "}
          <span style={{ color: "var(--ball)" }}>R$ 9,90/mês.</span>
        </h2>
        <p style={{ fontSize: 22, marginTop: 32, maxWidth: 720, color: "color-mix(in oklab, var(--cream) 75%, transparent)", lineHeight: 1.45 }}>
          Tenha seu próprio sistema de reservas por menos que o valor de uma aula.
          Sem mensalidade alta, sem barreira de entrada, sem desculpa para não digitalizar.
        </p>
        <div style={{ display: "flex", gap: 32, marginTop: 56, flexWrap: "wrap" }}>
          <Pill k="R$ 499" v="Implantação única" />
          <Pill k="R$ 9,90" v="Manutenção mensal" />
          <Pill k="0%" v="Mensalidade abusiva" />
        </div>
      </div>
    </Section>
  );
}
function Pill({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="pitch-num" style={{ fontSize: 56, color: "var(--ball)" }}>{k}</div>
      <div className="pitch-kicker" style={{ marginTop: 6, color: "color-mix(in oklab, var(--cream) 70%, transparent)" }}>{v}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 4. Receita - 5 fontes
// ─────────────────────────────────────────────────────────────
function Receita5Fontes() {
  const fontes = [
    { t: "Venda inicial", v: "R$ 299 – R$ 799", d: "Caixa imediato. Valida interesse e cobre aquisição.", icon: Rocket, color: "var(--clay)" },
    { t: "Manutenção", v: "R$ 9,90 – R$ 19,90/mês", d: "Hospedagem, suporte básico, melhorias contínuas.", icon: Calendar, color: "var(--forest)" },
    { t: "Transações", v: "2% – 5% ou R$ fixo", d: "O jogo grande. Cresce com o volume da plataforma.", icon: TrendingUp, color: "var(--clay)" },
    { t: "Módulos extras", v: "R$ 29 – R$ 299/mês", d: "Funções avançadas para quem precisa de mais.", icon: Sparkles, color: "var(--forest)" },
    { t: "Premium / patrocínio", v: "R$ 499+ / variável", d: "Câmeras, lances, marcas. Camada nobre.", icon: Trophy, color: "var(--clay)" },
  ];
  return (
    <Section id="receita" idx={3}>
      <span className="pitch-kicker" style={{ color: "var(--clay)" }}>Modelo de receita</span>
      <h2 className="pitch-h" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 12, maxWidth: 1000 }}>
        Cinco fontes que se somam.
      </h2>
      <p style={{ fontSize: 18, marginTop: 16, maxWidth: 720, color: "color-mix(in oklab, var(--ink) 65%, transparent)" }}>
        A mensalidade baixa reduz a barreira. As outras quatro camadas é onde o negócio cresce.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 40 }}>
        {fontes.map((f, i) => (
          <div
            key={f.t}
            style={{
              padding: 24,
              borderRadius: 20,
              background: "var(--cream)",
              border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)",
              boxShadow: "0 8px 24px -16px rgba(0,0,0,0.15)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: f.color }} />
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `color-mix(in oklab, ${f.color} 14%, transparent)`, color: f.color, display: "grid", placeItems: "center", marginBottom: 16 }}>
              <f.icon size={22} />
            </div>
            <div className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--ink) 55%, transparent)" }}>0{i + 1}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{f.t}</div>
            <div className="pitch-num" style={{ fontSize: 22, color: f.color, marginTop: 8 }}>{f.v}</div>
            <div style={{ fontSize: 13, color: "color-mix(in oklab, var(--ink) 60%, transparent)", marginTop: 8, lineHeight: 1.4 }}>{f.d}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 5. Públicos
// ─────────────────────────────────────────────────────────────
function Publicos() {
  const pubs = [
    {
      icon: GraduationCap,
      title: "Professor autônomo",
      subtitle: "O melhor público para começar",
      need: ["Agenda de aulas", "Cadastro de alunos", "Pacotes & pagamentos", "Lembrete por WhatsApp", "Lista de presença"],
      img: serve.url,
    },
    {
      icon: Building2,
      title: "Quadra pequena",
      subtitle: "1 a 4 quadras · academias",
      need: ["Agenda online", "Reserva por horário", "Pix integrado", "Bloqueio de horários", "Relatório de ocupação"],
      img: clay.url,
    },
    {
      icon: Trophy,
      title: "Clube & arena",
      subtitle: "Entram numa fase posterior",
      need: ["Multi-quadra", "Múltiplos professores", "Dashboard financeiro", "Torneios e ranking", "Campanhas"],
      img: arena.url,
    },
  ];
  return (
    <Section id="publicos" idx={4} bg="var(--cream-soft)">
      <span className="pitch-kicker" style={{ color: "var(--clay)" }}>Os 3 públicos</span>
      <h2 className="pitch-h" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 12, maxWidth: 900 }}>
        A mesma plataforma resolve três realidades diferentes.
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginTop: 40 }}>
        {pubs.map((p, i) => (
          <div
            key={p.title}
            style={{
              borderRadius: 24,
              overflow: "hidden",
              background: "var(--cream)",
              border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ height: 160, backgroundImage: `url(${p.img})`, backgroundSize: "cover", backgroundPosition: "center", position: "relative" }}>
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.55))" }} />
              <div style={{ position: "absolute", bottom: 16, left: 16, color: "var(--cream)", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--ball)", color: "var(--ink)", display: "grid", placeItems: "center" }}>
                  <p.icon size={18} />
                </div>
                <div className="pitch-kicker">Público 0{i + 1}</div>
              </div>
            </div>
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{p.title}</div>
              <div style={{ fontSize: 13, color: "var(--clay)", fontWeight: 600, marginTop: 4 }}>{p.subtitle}</div>
              <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                {p.need.map((n) => (
                  <div key={n} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                    <Check size={14} style={{ color: "var(--forest)" }} /> {n}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 6. Mercado
// ─────────────────────────────────────────────────────────────
function Mercado() {
  const dados = [
    { n: "5–20k", l: "Professores de tênis e raquete" },
    { n: "1,2–3k", l: "Quadras, academias e clubes" },
    { n: "2–8k", l: "Condomínios e locais privados" },
    { n: "10k+", l: "Arenas de outros esportes (fase 2)" },
  ];
  return (
    <Section id="mercado" idx={5} bg="var(--forest-deep)">
      <div style={{ color: "var(--cream)" }}>
        <span className="pitch-kicker" style={{ color: "var(--ball)" }}>Mercado nacional</span>
        <h2 className="pitch-h" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 12, maxWidth: 1000 }}>
          O bolo é grande — e ninguém ocupou.
        </h2>
        <p style={{ fontSize: 18, marginTop: 16, maxWidth: 720, color: "color-mix(in oklab, var(--cream) 70%, transparent)" }}>
          Com preço acessível, o público vai muito além das quadras: professores, condomínios, academias,
          e logo depois, outros esportes de raquete.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 32, marginTop: 56 }}>
          {dados.map((d) => (
            <div key={d.l} style={{ borderTop: "2px dashed var(--ball)", paddingTop: 20 }}>
              <div className="pitch-num" style={{ fontSize: 64, color: "var(--ball)" }}>{d.n}</div>
              <div style={{ fontSize: 14, marginTop: 8, color: "color-mix(in oklab, var(--cream) 75%, transparent)" }}>{d.l}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 48, padding: 20, borderRadius: 16, background: "color-mix(in oklab, var(--ball) 14%, transparent)", border: "1px solid color-mix(in oklab, var(--ball) 30%, transparent)", maxWidth: 720 }}>
          <div style={{ fontSize: 15, color: "var(--ball)", fontWeight: 700 }}>Meta realista de validação</div>
          <div style={{ fontSize: 18, marginTop: 4, color: "var(--cream)" }}>1.000 clientes pagantes no primeiro ciclo forte — professores + quadras + academias combinados.</div>
        </div>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// Slider control
// ─────────────────────────────────────────────────────────────
function Ctrl({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v: number) => num(v),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const dec = () => onChange(clamp(Number((value - step).toFixed(2))));
  const inc = () => onChange(clamp(Number((value + step).toFixed(2))));
  const btn: React.CSSProperties = {
    width: 36, height: 36, borderRadius: 10, background: "var(--clay)", color: "var(--cream)",
    fontSize: 20, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", border: "none", lineHeight: 1, userSelect: "none",
  };
  return (
    <div style={{ padding: 16, borderRadius: 14, background: "color-mix(in oklab, var(--cream) 96%, transparent)", border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "color-mix(in oklab, var(--ink) 65%, transparent)", fontWeight: 600 }}>{label}</span>
        <span className="pitch-num" style={{ fontSize: 22, color: "var(--clay)" }}>{format(value)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={dec} aria-label="diminuir" style={btn}>−</button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="pitch-range"
          style={{ flex: 1 }}
        />
        <button type="button" onClick={inc} aria-label="aumentar" style={btn}>+</button>
      </div>
    </div>
  );
}

function StatBig({ label, value, color = "var(--clay)" }: { label: string; value: number; color?: string }) {
  const v = useCountUp(value);
  return (
    <div>
      <div className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--ink) 55%, transparent)" }}>{label}</div>
      <div className="pitch-num" style={{ fontSize: "clamp(36px, 5vw, 64px)", color, marginTop: 4 }}>{brl(v)}</div>
    </div>
  );
}

function ScenarioBar({ s, set }: { s: Scenario; set: (p: Partial<Scenario>) => void }) {
  const apply = (preset: "cons" | "base" | "forte") => {
    if (preset === "cons") set({ clients: 300, entry: 499, monthly: 10, reservas: 30, ticket: 70, taxa: 2, taxaMode: "fix" });
    if (preset === "base") set({ clients: 1000, entry: 499, monthly: 14, reservas: 50, ticket: 80, taxa: 3, taxaMode: "pct" });
    if (preset === "forte") set({ clients: 3000, entry: 499, monthly: 19, reservas: 80, ticket: 100, taxa: 3, taxaMode: "pct" });
  };
  const copy = () => {
    navigator.clipboard?.writeText(window.location.href);
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--ink) 55%, transparent)", marginRight: 6 }}>Cenários</span>
      {([["cons", "Conservador"], ["base", "Base"], ["forte", "Forte"]] as const).map(([k, l]) => (
        <button
          key={k}
          onClick={() => apply(k)}
          style={{ padding: "8px 14px", borderRadius: 999, background: "var(--forest)", color: "var(--cream)", fontSize: 13, fontWeight: 600 }}
        >
          {l}
        </button>
      ))}
      <button
        onClick={copy}
        title="Copiar link deste cenário"
        style={{ padding: "8px 14px", borderRadius: 999, border: "1.5px solid color-mix(in oklab, var(--ink) 18%, transparent)", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <Copy size={14} /> Copiar link
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 7. Simulador de vendas
// ─────────────────────────────────────────────────────────────
function SimVendas() {
  const { s, set } = useScenario();
  const entradaTotal = s.clients * s.entry;
  const mrr = s.clients * s.monthly;
  const arr = mrr * 12;
  const primeiroMes = entradaTotal + mrr;
  const ano1 = entradaTotal + arr;
  return (
    <Section id="sim-vendas" idx={6}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start", marginTop: 24 }}>
        <div>
          <span className="pitch-kicker" style={{ color: "var(--clay)" }}>Simulador · Mexe à vontade</span>
          <h2 className="pitch-h" style={{ fontSize: "clamp(36px, 4.5vw, 56px)", marginTop: 12 }}>
            Quanto a base instalada vale?
          </h2>
          <p style={{ fontSize: 16, marginTop: 12, color: "color-mix(in oklab, var(--ink) 65%, transparent)", maxWidth: 460 }}>
            Ajuste o número de contratantes, o preço de entrada e a manutenção mensal. Caixa imediato = entrada × clientes + manutenção do primeiro mês.
          </p>
          <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
            <Ctrl label="Número de contratantes" value={s.clients} min={50} max={10000} step={50} onChange={(v) => set({ clients: v })} format={num} />
            <Ctrl label="Preço de entrada" value={s.entry} min={0} max={1500} step={10} onChange={(v) => set({ entry: v })} format={brl} />
            <Ctrl label="Manutenção mensal" value={s.monthly} min={0} max={49} onChange={(v) => set({ monthly: v })} format={brl} />
          </div>
          <div style={{ marginTop: 20 }}>
            <ScenarioBar s={s} set={set} />
          </div>
        </div>
        <div style={{ padding: 32, borderRadius: 24, background: "var(--forest-deep)", color: "var(--cream)", display: "grid", gap: 28, alignContent: "start" }}>
          <div>
            <div className="pitch-kicker" style={{ color: "var(--ball)" }}>Caixa imediato (1º mês)</div>
            <div className="pitch-num" style={{ fontSize: "clamp(40px, 6vw, 72px)", color: "var(--ball)", marginTop: 4, lineHeight: 1 }}>
              {brl(useCountUp(primeiroMes))}
            </div>
            <div style={{ fontSize: 13, color: "color-mix(in oklab, var(--cream) 70%, transparent)", marginTop: 8, display: "grid", gap: 2 }}>
              <div>+ {brl(entradaTotal)} de entrada ({num(s.clients)} × {brl(s.entry)})</div>
              <div>+ {brl(mrr)} de manutenção ({num(s.clients)} × {brl(s.monthly)})</div>
            </div>
          </div>
          <div style={{ borderTop: "1px dashed color-mix(in oklab, var(--ball) 30%, transparent)" }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <div className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--cream) 65%, transparent)" }}>MRR</div>
              <div className="pitch-num" style={{ fontSize: 32, color: "var(--cream)", marginTop: 4 }}>{brl(useCountUp(mrr))}</div>
              <div style={{ fontSize: 12, color: "color-mix(in oklab, var(--cream) 55%, transparent)", marginTop: 2 }}>recorrente / mês</div>
            </div>
            <div>
              <div className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--cream) 65%, transparent)" }}>ARR</div>
              <div className="pitch-num" style={{ fontSize: 32, color: "var(--cream)", marginTop: 4 }}>{brl(useCountUp(arr))}</div>
              <div style={{ fontSize: 12, color: "color-mix(in oklab, var(--cream) 55%, transparent)", marginTop: 2 }}>recorrente / ano</div>
            </div>
          </div>
          <div style={{ borderTop: "1px dashed color-mix(in oklab, var(--ball) 30%, transparent)" }} />
          <div>
            <div className="pitch-kicker" style={{ color: "var(--ball)" }}>Caixa acumulado · ano 1</div>
            <div className="pitch-num" style={{ fontSize: 44, color: "var(--ball)", marginTop: 4 }}>{brl(useCountUp(ano1))}</div>
            <div style={{ fontSize: 12, color: "color-mix(in oklab, var(--cream) 55%, transparent)", marginTop: 4 }}>
              entrada {brl(entradaTotal)} + ARR {brl(arr)}
            </div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 32, padding: 20, borderRadius: 16, background: "color-mix(in oklab, var(--ball) 18%, transparent)", border: "1px dashed color-mix(in oklab, var(--clay) 35%, transparent)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <div className="pitch-kicker" style={{ color: "var(--clay)" }}>O que é MRR?</div>
          <div style={{ fontSize: 14, marginTop: 6, color: "color-mix(in oklab, var(--ink) 75%, transparent)" }}>
            <b>Monthly Recurring Revenue</b> — receita recorrente mensal. É o dinheiro previsível que entra todo mês das mensalidades. Fórmula: nº de contratantes × manutenção mensal.
          </div>
        </div>
        <div>
          <div className="pitch-kicker" style={{ color: "var(--clay)" }}>O que é ARR?</div>
          <div style={{ fontSize: 14, marginTop: 6, color: "color-mix(in oklab, var(--ink) 75%, transparent)" }}>
            <b>Annual Recurring Revenue</b> — receita recorrente anual. É o MRR multiplicado por 12. Esse é o número que investidor olha para avaliar o tamanho do negócio.
          </div>
        </div>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 8. Simulador de transações
// ─────────────────────────────────────────────────────────────
function calcTrans(s: Scenario) {
  const reservas = s.clients * s.reservas;
  const perReserva = s.taxaMode === "pct" ? (s.ticket * s.taxa) / 100 : s.taxa;
  const monthly = reservas * perReserva;
  return { reservas, perReserva, monthly, yearly: monthly * 12 };
}

function SimTransacoes() {
  const { s, set } = useScenario();
  const t = calcTrans(s);

  // 3 scenario bars for visual comparison
  const presets = useMemo(
    () => [
      { name: "Conservador", v: calcTrans({ ...s, clients: 300 }) },
      { name: "Base", v: calcTrans({ ...s, clients: 1000 }) },
      { name: "Forte", v: calcTrans({ ...s, clients: 3000 }) },
    ],
    [s],
  );
  const max = Math.max(...presets.map((p) => p.v.monthly), t.monthly, 1);

  return (
    <Section id="sim-trans" idx={7} bg="var(--cream-soft)">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginTop: 24 }}>
        <div>
          <span className="pitch-kicker" style={{ color: "var(--clay)" }}>Simulador · O jogo grande</span>
          <h2 className="pitch-h" style={{ fontSize: "clamp(36px, 4.5vw, 56px)", marginTop: 12 }}>
            É aqui que o negócio escala.
          </h2>
          <p style={{ fontSize: 16, marginTop: 12, color: "color-mix(in oklab, var(--ink) 65%, transparent)", maxWidth: 460 }}>
            Mensalidade simbólica mantém o cliente. Mas o dinheiro real está nas reservas que passam pela plataforma.
          </p>
          <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
            <Ctrl label="Clientes ativos" value={s.clients} min={50} max={10000} step={50} onChange={(v) => set({ clients: v })} format={num} />
            <Ctrl label="Reservas / mês por cliente" value={s.reservas} min={0} max={150} onChange={(v) => set({ reservas: v })} format={num} />
            <Ctrl label="Ticket médio da reserva" value={s.ticket} min={20} max={300} step={5} onChange={(v) => set({ ticket: v })} format={brl} />
            <div style={{ padding: 16, borderRadius: 14, background: "var(--cream)", border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button
                  onClick={() => set({ taxaMode: "pct" })}
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 999, background: s.taxaMode === "pct" ? "var(--clay)" : "transparent", color: s.taxaMode === "pct" ? "var(--cream)" : "var(--ink)", fontWeight: 600, fontSize: 13, border: "1.5px solid color-mix(in oklab, var(--ink) 12%, transparent)" }}
                >
                  Percentual
                </button>
                <button
                  onClick={() => set({ taxaMode: "fix" })}
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 999, background: s.taxaMode === "fix" ? "var(--clay)" : "transparent", color: s.taxaMode === "fix" ? "var(--cream)" : "var(--ink)", fontWeight: 600, fontSize: 13, border: "1.5px solid color-mix(in oklab, var(--ink) 12%, transparent)" }}
                >
                  R$ por reserva
                </button>
              </div>
              <Ctrl
                label={s.taxaMode === "pct" ? "Taxa (%)" : "R$ por reserva"}
                value={s.taxa}
                min={0}
                max={s.taxaMode === "pct" ? 10 : 15}
                step={s.taxaMode === "pct" ? 0.5 : 0.5}
                onChange={(v) => set({ taxa: v })}
                format={(v) => (s.taxaMode === "pct" ? `${v}%` : brl(v))}
              />
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <ScenarioBar s={s} set={set} />
          </div>
        </div>
        <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
          <div style={{ padding: 28, borderRadius: 24, background: "var(--clay)", color: "var(--cream)" }}>
            <div className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--cream) 80%, transparent)" }}>Receita transacional</div>
            <div className="pitch-num" style={{ fontSize: "clamp(44px, 7vw, 88px)", marginTop: 4 }}>{brl(useCountUp(t.monthly))}</div>
            <div style={{ fontSize: 14, marginTop: 6, color: "color-mix(in oklab, var(--cream) 80%, transparent)" }}>
              por mês · {brl(useCountUp(t.yearly))} ao ano
            </div>
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px dashed color-mix(in oklab, var(--cream) 40%, transparent)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 13 }}>
              <div>
                <div style={{ opacity: 0.7 }}>Reservas/mês</div>
                <div className="pitch-num" style={{ fontSize: 22, marginTop: 2 }}>{num(t.reservas)}</div>
              </div>
              <div>
                <div style={{ opacity: 0.7 }}>R$ por reserva</div>
                <div className="pitch-num" style={{ fontSize: 22, marginTop: 2 }}>{brl(t.perReserva)}</div>
              </div>
            </div>
          </div>
          <div style={{ padding: 24, borderRadius: 24, background: "var(--cream)", border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)" }}>
            <div className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--ink) 55%, transparent)", marginBottom: 16 }}>Comparativo — receita transacional/mês</div>
            <div style={{ display: "grid", gap: 14 }}>
              {presets.map((p) => (
                <div key={p.name}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    <span className="pitch-num" style={{ color: "var(--clay)" }}>{brl(p.v.monthly)}</span>
                  </div>
                  <div style={{ height: 10, borderRadius: 999, background: "color-mix(in oklab, var(--ink) 6%, transparent)", overflow: "hidden" }}>
                    <div style={{ width: `${(p.v.monthly / max) * 100}%`, height: "100%", background: "linear-gradient(90deg, var(--clay), var(--ball))", transition: "width 500ms" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 9. Planos
// ─────────────────────────────────────────────────────────────
function Planos() {
  const planos = [
    {
      name: "Start", entry: 299, m: 9.9, target: "Professor autônomo",
      feats: ["Agenda de aulas", "Cadastro de alunos", "Pacotes de aula", "Lembrete WhatsApp", "Link de pagamento", "Relatório simples"],
    },
    {
      name: "Quadra", entry: 499, m: 14.9, target: "Quadra pequena · produto principal", highlight: true,
      feats: ["Agenda de reservas", "Pagamento Pix/cartão", "Bloqueio de horários", "Lista de espera", "Cupons", "Página pública", "Relatório de ocupação"],
    },
    {
      name: "Arena", entry: 799, m: 19.9, target: "Centros com várias quadras",
      feats: ["Várias quadras", "Vários professores", "Permissões por função", "Dashboard financeiro", "Ranking interno", "Torneios simples", "Campanhas"],
    },
  ];
  return (
    <Section id="planos" idx={8}>
      <span className="pitch-kicker" style={{ color: "var(--clay)" }}>Escada de planos</span>
      <h2 className="pitch-h" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 12 }}>
        Barato para entrar. Sem deixar valor na mesa.
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginTop: 40 }}>
        {planos.map((p) => {
          const hl = p.highlight;
          return (
            <div
              key={p.name}
              style={{
                padding: 28,
                borderRadius: 24,
                background: hl ? "var(--forest-deep)" : "var(--cream)",
                color: hl ? "var(--cream)" : "var(--ink)",
                border: hl ? "2px solid var(--ball)" : "1px solid color-mix(in oklab, var(--ink) 8%, transparent)",
                boxShadow: hl ? "0 30px 60px -30px var(--forest-deep)" : "0 8px 24px -16px rgba(0,0,0,0.1)",
                position: "relative",
              }}
            >
              {hl && (
                <div style={{ position: "absolute", top: -12, right: 20, padding: "4px 10px", background: "var(--ball)", color: "var(--ink)", borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>
                  PRINCIPAL
                </div>
              )}
              <div style={{ fontSize: 26, fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 13, color: hl ? "var(--ball)" : "var(--clay)", fontWeight: 600, marginTop: 4 }}>{p.target}</div>
              <div style={{ marginTop: 20, paddingBottom: 20, borderBottom: `1px dashed ${hl ? "color-mix(in oklab, var(--cream) 25%, transparent)" : "color-mix(in oklab, var(--ink) 15%, transparent)"}` }}>
                <div className="pitch-num" style={{ fontSize: 48, color: hl ? "var(--ball)" : "var(--clay)" }}>{brl(p.entry)}</div>
                <div style={{ fontSize: 13, marginTop: 4, opacity: 0.7 }}>uma vez + {brl(p.m)}/mês</div>
              </div>
              <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                {p.feats.map((f) => (
                  <div key={f} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                    <Check size={14} style={{ color: hl ? "var(--ball)" : "var(--forest)" }} /> {f}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 10. Simulador total combinado
// ─────────────────────────────────────────────────────────────
function SimTotal() {
  const { s, set } = useScenario();
  const t = calcTrans(s);
  const mrr = s.clients * s.monthly;
  const total = mrr + t.monthly;
  const annual = total * 12 + s.clients * s.entry;

  const reset = () =>
    set({ clients: 1000, entry: 499, monthly: 14, reservas: 50, ticket: 80, taxa: 3, taxaMode: "pct" });

  const parts = [
    { label: "Manutenção", value: mrr, color: "var(--forest)" },
    { label: "Transações", value: t.monthly, color: "var(--clay)" },
  ];
  const sum = mrr + t.monthly || 1;

  return (
    <Section id="sim-total" idx={9} bg="var(--forest-deep)">
      <div style={{ color: "var(--cream)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginTop: 24 }}>
        <div>
          <span className="pitch-kicker" style={{ color: "var(--ball)" }}>Simulador · Receita total</span>
          <h2 className="pitch-h" style={{ fontSize: "clamp(36px, 4.5vw, 56px)", marginTop: 12 }}>
            Soma tudo. Veja o ano inteiro.
          </h2>
          <p style={{ fontSize: 16, marginTop: 12, color: "color-mix(in oklab, var(--cream) 70%, transparent)", maxWidth: 460 }}>
            Caixa de entrada + recorrência mensal + transações. O modelo só faz sentido nas três camadas juntas.
          </p>
          <div style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ScenarioBar s={s} set={set} />
            <button
              onClick={reset}
              style={{ padding: "8px 14px", borderRadius: 999, background: "transparent", color: "var(--cream)", border: "1.5px solid color-mix(in oklab, var(--cream) 30%, transparent)", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <RotateCcw size={14} /> Resetar
            </button>
          </div>

          {/* parametros resumo */}
          <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <Resume k="Clientes" v={num(s.clients)} />
            <Resume k="Entrada" v={brl(s.entry)} />
            <Resume k="Manutenção" v={`${brl(s.monthly)}/mês`} />
            <Resume k="Reservas/mês" v={`${num(s.reservas)} por cliente`} />
            <Resume k="Ticket médio" v={brl(s.ticket)} />
            <Resume k="Taxa" v={s.taxaMode === "pct" ? `${s.taxa}%` : `${brl(s.taxa)} fixo`} />
          </div>
        </div>

        <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
          <div style={{ padding: 32, borderRadius: 24, background: "color-mix(in oklab, var(--ball) 14%, transparent)", border: "2px solid var(--ball)" }}>
            <div className="pitch-kicker" style={{ color: "var(--ball)" }}>Receita total mensal</div>
            <div className="pitch-num" style={{ fontSize: "clamp(48px, 8vw, 96px)", color: "var(--ball)", marginTop: 4 }}>{brl(useCountUp(total))}</div>
            <div style={{ fontSize: 14, color: "color-mix(in oklab, var(--cream) 70%, transparent)", marginTop: 8 }}>
              Anual (com entradas): <span className="pitch-num" style={{ color: "var(--cream)" }}>{brl(useCountUp(annual))}</span>
            </div>

            {/* composição */}
            <div style={{ marginTop: 24 }}>
              <div className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--cream) 70%, transparent)", marginBottom: 8 }}>Composição do mensal</div>
              <div style={{ height: 14, borderRadius: 999, overflow: "hidden", display: "flex" }}>
                {parts.map((p) => (
                  <div key={p.label} style={{ width: `${(p.value / sum) * 100}%`, background: p.color, transition: "width 500ms" }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12 }}>
                {parts.map((p) => (
                  <div key={p.label} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />
                    <span>{p.label}: {brl(p.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ padding: 24, borderRadius: 24, background: "color-mix(in oklab, var(--cream) 6%, transparent)", border: "1px solid color-mix(in oklab, var(--cream) 12%, transparent)" }}>
            <div className="pitch-kicker" style={{ color: "var(--ball)" }}>Projeção 12 meses</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginTop: 16, height: 80 }}>
              {Array.from({ length: 12 }, (_, i) => {
                const v = s.clients * s.entry + total * (i + 1);
                const m = s.clients * s.entry + total * 12;
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", height: `${(v / m) * 100}%`, background: "linear-gradient(180deg, var(--ball), var(--clay))", borderRadius: 4, transition: "height 500ms" }} />
                    <span style={{ fontSize: 10, opacity: 0.6 }}>{i + 1}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 12, marginTop: 8, color: "color-mix(in oklab, var(--cream) 65%, transparent)" }}>Receita acumulada incluindo caixa de entrada</div>
          </div>
        </div>
      </div>
    </Section>
  );
}
function Resume({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 12, background: "color-mix(in oklab, var(--cream) 6%, transparent)" }}>
      <div className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--cream) 60%, transparent)" }}>{k}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{v}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 11. Custos & Margem (interativo)
// ─────────────────────────────────────────────────────────────
function calcCustos(s: Scenario, receitaMensal: number, transMensal: number) {
  const infra = s.clients * s.infraPerClient;
  const support = s.clients * s.supportPerClient;
  const payFee = transMensal * (s.payFeePct / 100);
  const acquisition = s.newPerMonth * s.cacPerNew;
  const team = s.fixedTeam;
  const total = infra + support + payFee + acquisition + team;
  const lucro = receitaMensal - total;
  const margem = receitaMensal > 0 ? (lucro / receitaMensal) * 100 : 0;
  return { infra, support, payFee, acquisition, team, total, lucro, margem };
}

function SimCustos() {
  const { s, set } = useScenario();
  const t = calcTrans(s);
  const mrr = s.clients * s.monthly;
  const receita = mrr + t.monthly;
  const c = calcCustos(s, receita, t.monthly);

  const rows: { label: string; value: number; color: string; hint: string }[] = [
    { label: "Infra + mensageria", value: c.infra, color: "var(--clay)", hint: `${num(s.clients)} ativos × ${brl(s.infraPerClient)}` },
    { label: "Suporte + onboarding", value: c.support, color: "var(--clay-soft)", hint: `${num(s.clients)} ativos × ${brl(s.supportPerClient)}` },
    { label: "Taxa de pagamento", value: c.payFee, color: "var(--ball)", hint: `${s.payFeePct}% de ${brl(t.monthly)} em transações` },
    { label: "Marketing (CAC)", value: c.acquisition, color: "var(--forest)", hint: `${num(s.newPerMonth)} novos × ${brl(s.cacPerNew)}` },
    { label: "Equipe fixa", value: c.team, color: "color-mix(in oklab, var(--forest) 70%, var(--ink))", hint: "Pro-labore + freelas" },
  ];
  const maxRow = Math.max(...rows.map((r) => r.value), 1);
  const payback = c.acquisition > 0 ? s.entry / s.cacPerNew : 0;

  return (
    <Section id="custos" idx={10}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginTop: 24, alignItems: "start" }}>
        <div>
          <span className="pitch-kicker" style={{ color: "var(--clay)" }}>Simulador · O outro lado</span>
          <h2 className="pitch-h" style={{ fontSize: "clamp(36px, 4.5vw, 56px)", marginTop: 12 }}>
            E os custos? A margem fecha.
          </h2>
          <p style={{ fontSize: 16, marginTop: 12, color: "color-mix(in oklab, var(--ink) 65%, transparent)", maxWidth: 480 }}>
            A tecnologia já existe — o custo marginal por cliente é baixo. Ajuste cada bloco e veja a margem operacional em tempo real.
          </p>
          <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
            <Ctrl label="Infra + WhatsApp/SMS · R$/ativo/mês" value={s.infraPerClient} min={0} max={15} step={0.5} onChange={(v) => set({ infraPerClient: v })} format={brl} />
            <Ctrl label="Suporte + onboarding · R$/ativo/mês" value={s.supportPerClient} min={0} max={15} step={0.5} onChange={(v) => set({ supportPerClient: v })} format={brl} />
            <Ctrl label="Taxa de pagamento · % das transações" value={s.payFeePct} min={0} max={5} step={0.1} onChange={(v) => set({ payFeePct: v })} format={(v) => `${v.toFixed(1)}%`} />
            <Ctrl label="Novos clientes / mês" value={s.newPerMonth} min={0} max={1000} step={10} onChange={(v) => set({ newPerMonth: v })} format={num} />
            <Ctrl label="CAC · R$ por cliente novo" value={s.cacPerNew} min={0} max={400} step={5} onChange={(v) => set({ cacPerNew: v })} format={brl} />
            <Ctrl label="Equipe fixa · R$/mês" value={s.fixedTeam} min={0} max={100000} step={500} onChange={(v) => set({ fixedTeam: v })} format={brl} />
          </div>
        </div>

        <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
          <div style={{ padding: 32, borderRadius: 24, background: "var(--forest-deep)", color: "var(--cream)" }}>
            <div className="pitch-kicker" style={{ color: "var(--ball)" }}>Lucro operacional mensal</div>
            <div className="pitch-num" style={{ fontSize: "clamp(44px, 7vw, 84px)", color: c.lucro >= 0 ? "var(--ball)" : "oklch(0.70 0.18 25)", marginTop: 4 }}>
              {brl(useCountUp(c.lucro))}
            </div>
            <div style={{ fontSize: 14, color: "color-mix(in oklab, var(--cream) 70%, transparent)", marginTop: 4 }}>
              Margem <span className="pitch-num" style={{ color: c.margem >= 0 ? "var(--ball)" : "oklch(0.75 0.18 25)" }}>{c.margem.toFixed(1)}%</span>
              {" · "}Receita {brl(receita)} − Custos {brl(c.total)}
            </div>
            <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Resume k="Lucro anual" v={brl(c.lucro * 12)} />
              <Resume k="Payback do CAC" v={`${payback.toFixed(1)} meses (entrada)`} />
            </div>
          </div>

          <div style={{ padding: 24, borderRadius: 24, background: "var(--cream-soft)", border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)" }}>
            <div className="pitch-kicker" style={{ color: "color-mix(in oklab, var(--ink) 55%, transparent)" }}>Quebra dos custos · {brl(c.total)}/mês</div>
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              {rows.map((r) => (
                <div key={r.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</span>
                    <span className="pitch-num" style={{ fontSize: 14, color: "var(--ink)" }}>{brl(r.value)}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: "color-mix(in oklab, var(--ink) 6%, transparent)", overflow: "hidden" }}>
                    <div style={{ width: `${(r.value / maxRow) * 100}%`, height: "100%", background: r.color, transition: "width 500ms" }} />
                  </div>
                  <div style={{ fontSize: 11, color: "color-mix(in oklab, var(--ink) 50%, transparent)", marginTop: 3 }}>{r.hint}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 11. Módulos futuros
// ─────────────────────────────────────────────────────────────
function Modulos() {
  const mods = [
    { n: "WhatsApp avançado", p: "R$ 29/mês" },
    { n: "Relatórios financeiros", p: "R$ 49/mês" },
    { n: "Torneios & ranking", p: "R$ 49–99/mês" },
    { n: "CRM de alunos", p: "R$ 49/mês" },
    { n: "Campanhas (horário vago)", p: "R$ 49–99/mês" },
    { n: "Página personalizada", p: "R$ 29/mês" },
    { n: "Multi-unidades", p: "R$ 99+/mês" },
    { n: "Lances / vídeo / câmeras", p: "R$ 499+/mês" },
    { n: "Patrocinadores", p: "comissão" },
  ];
  return (
    <Section id="modulos" idx={11}>
      <span className="pitch-kicker" style={{ color: "var(--clay)" }}>Módulos futuros</span>
      <h2 className="pitch-h" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 12, maxWidth: 1000 }}>
        Plataforma simples. Receita expansível.
      </h2>
      <p style={{ fontSize: 18, marginTop: 16, maxWidth: 720, color: "color-mix(in oklab, var(--ink) 65%, transparent)" }}>
        Quem precisa de mais, paga mais. Sem forçar quem só quer agendar.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 32 }}>
        {mods.map((m, i) => (
          <div key={m.n} style={{ padding: 20, borderRadius: 16, background: "var(--cream)", border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)" }}>
            <div className="pitch-kicker" style={{ color: "var(--clay)" }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{m.n}</div>
            <div className="pitch-num" style={{ fontSize: 16, color: "var(--forest)", marginTop: 6 }}>{m.p}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 12. MVP enxuto vs depois
// ─────────────────────────────────────────────────────────────
function MVP() {
  const agora = [
    "Cadastro de quadra/professor",
    "Página pública de agendamento",
    "Agenda com horários disponíveis",
    "Confirmação de reserva",
    "Pagamento / sinal via Pix",
    "Cadastro de clientes",
    "Histórico de reservas",
    "Bloqueio de horários",
    "Cancelamento / reagendamento",
    "Notificação WhatsApp / e-mail",
  ];
  const depois = [
    "Câmeras e lances ao vivo",
    "Scout e IA avançada",
    "PDV de bar / estoque",
    "Financeiro completo",
    "Automações complexas",
    "App nativo iOS/Android",
  ];
  return (
    <Section id="mvp" idx={12} bg="var(--cream-soft)">
      <span className="pitch-kicker" style={{ color: "var(--clay)" }}>MVP enxuto</span>
      <h2 className="pitch-h" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 12, maxWidth: 1000 }}>
        Primeiro valida agendamento e transação. Depois vem o premium.
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 40 }}>
        <div style={{ padding: 28, borderRadius: 24, background: "var(--forest-deep)", color: "var(--cream)" }}>
          <div className="pitch-kicker" style={{ color: "var(--ball)" }}>Agora</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>MVP que entra em quadra</div>
          <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
            {agora.map((a) => (
              <div key={a} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 15 }}>
                <Check size={16} style={{ color: "var(--ball)" }} /> {a}
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: 28, borderRadius: 24, background: "var(--cream)", border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)" }}>
          <div className="pitch-kicker" style={{ color: "var(--clay)" }}>Fase 2+</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>Camadas premium</div>
          <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
            {depois.map((a) => (
              <div key={a} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 15, color: "color-mix(in oklab, var(--ink) 75%, transparent)" }}>
                <Sparkles size={16} style={{ color: "var(--clay)" }} /> {a}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 13. Fases
// ─────────────────────────────────────────────────────────────
function Fases() {
  const fases = [
    { n: "01", t: "Validar com professores", g: "100 clientes", d: "Plano Start. Provar que professores pagam por organização." },
    { n: "02", t: "Quadras pequenas", g: "300–500 clientes", d: "Plano Quadra. Gerar reservas reais na plataforma." },
    { n: "03", t: "Ativar transações", g: "20–50k reservas/mês", d: "Pix integrado, split, taxa, sinal. Receita recorrente real." },
    { n: "04", t: "Expansão multi-esporte", g: "Padel, beach, futevôlei, society", d: "Mesmo motor. Mercado várias vezes maior." },
  ];
  return (
    <Section id="fases" idx={13}>
      <span className="pitch-kicker" style={{ color: "var(--clay)" }}>Estratégia em 4 fases</span>
      <h2 className="pitch-h" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 12, maxWidth: 1000 }}>
        Plano de ataque, sem pressa e sem cair do cavalo.
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginTop: 48, position: "relative" }}>
        {/* trajetória */}
        <div style={{ position: "absolute", left: 30, right: 30, top: 38, height: 2, borderTop: "2px dashed var(--ball)", zIndex: 0 }} />
        {fases.map((f) => (
          <div key={f.n} style={{ position: "relative", zIndex: 1 }}>
            <div style={{ width: 60, height: 60, borderRadius: 999, background: "var(--clay)", color: "var(--cream)", display: "grid", placeItems: "center", fontSize: 22, fontWeight: 700, fontFamily: "Space Grotesk", boxShadow: "0 12px 24px -12px var(--clay)" }}>
              {f.n}
            </div>
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 19, fontWeight: 700 }}>{f.t}</div>
              <div className="pitch-num" style={{ fontSize: 14, color: "var(--clay)", marginTop: 4 }}>{f.g}</div>
              <div style={{ fontSize: 14, color: "color-mix(in oklab, var(--ink) 65%, transparent)", marginTop: 8, lineHeight: 1.45 }}>{f.d}</div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// 14. Fechamento
// ─────────────────────────────────────────────────────────────
function Fechamento() {
  return (
    <Section id="fechamento" idx={14}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(60deg, var(--forest-deep) 40%, transparent 80%), url(${community.url})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          zIndex: 0,
        }}
      />
      <div style={{ position: "relative", zIndex: 1, color: "var(--cream)", marginTop: "auto", marginBottom: "auto", maxWidth: 1000 }}>
        <span className="pitch-kicker" style={{ color: "var(--ball)" }}>Vamos jogar juntos</span>
        <h2 className="pitch-h" style={{ fontSize: "clamp(48px, 7vw, 96px)", marginTop: 24 }}>
          1.000 clientes =<br />
          <span style={{ color: "var(--ball)" }}>R$ 500 mil</span> de entrada
          <span style={{ color: "var(--cream)", opacity: 0.7, fontSize: "0.55em" }}> +</span>{" "}
          <span style={{ color: "var(--ball)" }}>R$ 120 mil/mês</span> em transações.
        </h2>
        <p style={{ fontSize: 20, marginTop: 28, maxWidth: 700, color: "color-mix(in oklab, var(--cream) 80%, transparent)", lineHeight: 1.5 }}>
          A QuadraFast nasce barata para popularizar. Cresce no volume.
          Vira a base nacional de quadras, professores e jogadores.
        </p>
        <div style={{ marginTop: 48, display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <a
            href="https://wa.me/5548988169645"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "16px 28px", borderRadius: 999, background: "var(--ball)", color: "var(--ink)", fontWeight: 700, fontSize: 17, boxShadow: "0 16px 40px -16px var(--ball)" }}
          >
            <Phone size={18} /> Falar com a gente
          </a>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="pitch-kicker" style={{ color: "var(--ball)" }}>WhatsApp</span>
            <span className="pitch-num" style={{ fontSize: 22 }}>+55 48 98816-9645</span>
          </div>
        </div>
        <div
          style={{
            marginTop: 64,
            paddingTop: 24,
            borderTop: "1px dashed color-mix(in oklab, var(--ball) 35%, transparent)",
            fontStyle: "italic",
            fontSize: 18,
            color: "color-mix(in oklab, var(--cream) 75%, transparent)",
            maxWidth: 640,
          }}
        >
          "O tênis é um esporte de vida inteira. Que a tecnologia entre em quadra com a gente."
          <div style={{ marginTop: 8, fontStyle: "normal", fontSize: 13 }}>— QuadraFast</div>
        </div>
      </div>
    </Section>
  );
}
