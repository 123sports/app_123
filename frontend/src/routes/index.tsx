import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Loader2, Instagram, Facebook, Youtube, Music2, Globe, Star, Trophy } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import landingLogo from "@/assets/brand/on-tennis-app-light.png";

import { playPop } from "@/lib/sfx";
import { supabase } from "@/integrations/supabase/client";
import { safeExternalHttpUrl } from "@/lib/url";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "On Tennis — Reserve sua quadra e suas aulas" },
      {
        name: "description",
        content:
          "On Tennis: agende horários de quadra, marque aulas individuais ou em grupo, pague online e converse direto com o professor.",
      },
      { property: "og:title", content: "On Tennis" },
      {
        property: "og:description",
        content: "Reserve quadra, marque aulas e pague online — tudo num só lugar.",
      },
    ],
  }),
  component: Landing,
});

/* ============================================================================
 * MÍDIA DA LANDING — placeholders até a chave de API chegar.
 * Preencha as URLs abaixo (vídeo do hero + imagens dos divisores) e os
 * placeholders estilizados são substituídos automaticamente.
 * ========================================================================== */
const HERO_VIDEO_URL: string | null = "/media/hero.mp4"; // gerado via Veo 3.1 (Gemini API)
const MEDIA_BREAK_1_VIDEO: string | null = "/media/break-1.mp4"; // montagem 3 cortes (Veo 3.1)
const MEDIA_BREAK_1: string | null = "/media/break-1.jpg"; // fallback/poster (gemini-3-pro-image)
const MEDIA_SPLIT_A: string | null = "/media/split-a.jpg"; // aula em grupo
const MEDIA_SPLIT_B: string | null = "/media/split-b.jpg"; // treino individual

/* ============================================================================
 * MOTION — estilos exclusivos da landing (não tocam o CSS global do app).
 * Sistema PK: easing assinatura, entradas once, marquee, pixel reveal, grain.
 * ========================================================================== */
function LandingFxStyles() {
  return (
    <style>{`
      /* --- hero: bloco central de vídeo → expande para o BG ---
         Os VALORES dos estágios são inline (React); aqui só as transições. */
      .lp-hero-media { position: absolute; z-index: 0; overflow: hidden;
        transition: top .95s var(--on-ease), right .95s var(--on-ease), bottom .95s var(--on-ease), left .95s var(--on-ease), opacity .55s var(--on-ease), transform .95s var(--on-ease); }
      .lp-hero-veil { position: absolute; inset: 0; z-index: 1; pointer-events: none;
        background: linear-gradient(to top, rgba(11,18,12,.88) 0%, rgba(11,18,12,.45) 45%, rgba(11,18,12,.35) 100%);
        transition: opacity .8s var(--on-ease); }

      /* linhas do headline sobem uma a uma (roll-up PK) — valores inline */
      .lp-line { display: block; overflow: hidden; }
      .lp-line > span { display: block; transition: transform .85s var(--on-ease); }
      .lp-fade { transition: opacity .7s var(--on-ease), transform .7s var(--on-ease); }

      /* --- marquee tipográfico (duas metades idênticas = loop sem emenda) --- */
      .lp-marquee { animation: lp-marquee 30s linear infinite; }
      .lp-marquee:hover { animation-play-state: paused; }
      @keyframes lp-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }

      /* --- revelação pixelada (grade 25×4 na cor do fundo) --- */
      .lp-px { position: absolute; inset: 0; z-index: 3; pointer-events: none; display: grid;
        grid-template-columns: repeat(25, 1fr); grid-template-rows: repeat(4, 1fr); }
      .lp-px > i { display: block; background: var(--background); transition: opacity .5s ease; }
      .lp-px > i.off { opacity: 0; }

      /* --- ken burns lento nas mídias --- */
      .lp-kenburns { animation: lp-kb 16s ease-in-out infinite alternate; }
      @keyframes lp-kb { from { transform: scale(1); } to { transform: scale(1.07); } }

      /* --- cursor contextual --- */
      .lp-cursor { position: fixed; left: 0; top: 0; z-index: 60; pointer-events: none; height: 2.25rem; width: 2.25rem;
        margin: -1.125rem 0 0 -1.125rem; border: 1px solid var(--foreground); border-radius: 9999px; opacity: 0;
        mix-blend-mode: difference; border-color: #fff;
        transition: opacity .3s ease, width .2s var(--on-ease), height .2s var(--on-ease), margin .2s var(--on-ease); }
      .lp-cursor.on { opacity: .5; }
      .lp-cursor.lg { height: 4rem; width: 4rem; margin: -2rem 0 0 -2rem; opacity: .95; }

      @media (hover: none), (prefers-reduced-motion: reduce) {
        .lp-cursor { display: none; }
        .lp-marquee { animation: none; }
        .lp-kenburns { animation: none; }
        .lp-hero-media { transition: none; }
        .lp-line > span, .lp-fade { transition: none; }
      }
    `}</style>
  );
}

/* Cursor: anel que segue o mouse com atraso e cresce sobre interativos. */
function CustomCursor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      typeof matchMedia === "undefined" ||
      matchMedia("(hover: none)").matches ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const el = ref.current;
    if (!el) return;
    let x = 0, y = 0, tx = 0, ty = 0, raf = 0;
    const loop = () => {
      tx += (x - tx) * 0.2;
      ty += (y - ty) * 0.2;
      el.style.transform = `translate(${tx}px, ${ty}px)`;
      raf = requestAnimationFrame(loop);
    };
    const move = (e: PointerEvent) => { x = e.clientX; y = e.clientY; el.classList.add("on"); };
    const over = (e: PointerEvent) => {
      const hit = (e.target as HTMLElement)?.closest?.("a, button, [role=button], input, textarea, select");
      el.classList.toggle("lg", !!hit);
    };
    const leave = () => el.classList.remove("on");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerover", over);
    document.addEventListener("pointerleave", leave);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerover", over);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);
  return <div ref={ref} className="lp-cursor" aria-hidden />;
}

/* Rótulo com roll-up letra-a-letra (hover do styleguide). O CSS global
   [data-char-button]/.on-char cuida da animação; aqui só renderizamos os
   pares de spans com o índice --char. */
function CharLabel({ text }: { text: string }) {
  return (
    <span aria-hidden className="flex">
      {[...text].map((ch, i) => (
        <span key={i} className="on-char" style={{ "--char": String(i + 1) } as React.CSSProperties}>
          <span>{ch === " " ? " " : ch}</span>
          <span>{ch === " " ? " " : ch}</span>
        </span>
      ))}
    </span>
  );
}

/* Entradas once a ~88% da viewport, com MutationObserver para elementos que
   montam depois (ex.: depoimentos após fetch). */
function useLandingReveals() {
  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = new WeakSet<Element>();
    const io = reduce
      ? null
      : new IntersectionObserver(
          (entries) =>
            entries.forEach((e) => {
              if (e.isIntersecting) {
                e.target.classList.add("is-in");
                io?.unobserve(e.target);
              }
            }),
          { rootMargin: "0px 0px -12% 0px" },
        );
    const handle = (el: Element) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (!io) { el.classList.add("is-in"); return; }
      io.observe(el);
    };
    const scan = (root: Element | Document) => {
      if (root instanceof Element && root.matches("[data-reveal]")) handle(root);
      root.querySelectorAll("[data-reveal]").forEach(handle);
    };
    scan(document);
    const mo = new MutationObserver((muts) =>
      muts.forEach((m) => m.addedNodes.forEach((n) => { if (n instanceof Element) scan(n); })),
    );
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { io?.disconnect(); mo.disconnect(); };
  }, []);
}

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/app" });
    });
  }, [navigate]);
  useLandingReveals();
  return (
    <div className="relative min-h-screen hero-bg">
      <LandingFxStyles />
      <div className="on-grain" aria-hidden />
      <CustomCursor />
      <Toaster />
      <Hero />
      <Marquee />
      <Features />
      <MediaBreak
        src={MEDIA_BREAK_1}
        video={MEDIA_BREAK_1_VIDEO}
        eyebrow="Na quadra · todos os níveis"
        title="Tênis pra quem joga. E pra quem quer começar."
        placeholderLabel="Imagem — jogo na quadra"
      />
      <HowItWorks />
      <MediaSplit />
      <Testimonials />
      <LeadCapture />
      <CoachApply />
      <CTA />
      <Footer />
      <FloatingWhatsApp />
    </div>
  );
}

/* ============================================================================
 * HERO — coreografia de carregamento:
 * stage 0 (boot) → 1: bloco de vídeo entra no centro → 2: bloco expande até o
 * BG e o véu escurece → 3: headline sobe linha a linha, CTAs e meta entram.
 * ========================================================================== */
function Hero() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage(3);
      return;
    }
    const ts = [
      setTimeout(() => setStage(1), 150),
      setTimeout(() => setStage(2), 1350),
      setTimeout(() => setStage(3), 2150),
    ];
    return () => ts.forEach(clearTimeout);
  }, []);

  const lineStyle = (delay: number): React.CSSProperties => ({
    transform: stage >= 3 ? "none" : "translateY(118%)",
    transitionDelay: `${delay}ms`,
  });
  const fadeStyle = (delay: number): React.CSSProperties => ({
    opacity: stage >= 3 ? 1 : 0,
    transform: stage >= 3 ? "none" : "translateY(1rem)",
    transitionDelay: `${delay}ms`,
  });

  return (
    <section className="relative flex min-h-svh flex-col overflow-hidden bg-ink text-white">
      {/* mídia: bloco central → background (valores inline por estágio) */}
      <div
        className="lp-hero-media"
        style={{
          inset: stage >= 2 ? "0%" : "22% 14%",
          opacity: stage >= 1 ? 1 : 0,
          transform: stage >= 1 ? "none" : "scale(.94)",
        }}
      >
        <HeroMedia />
      </div>
      <div className="lp-hero-veil" style={{ opacity: stage >= 2 ? 1 : 0 }} />

      {/* header sobre o hero */}
      <header className="lp-fade relative z-20 flex items-center justify-between px-6 py-5 md:px-10" style={fadeStyle(500)}>
        <img src={landingLogo} alt="On Tennis — Olimpio Neto Treinamento Esportivo" className="h-14 w-auto object-contain md:h-16" />
        <nav className="hidden items-center gap-8 text-sm font-bold md:flex">
          <a href="#features" className="text-white/70 transition-colors hover:text-white">Recursos</a>
          <a href="#how" className="text-white/70 transition-colors hover:text-white">Como funciona</a>
          <a href="#contato" className="text-white/70 transition-colors hover:text-white">Contato</a>
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            to="/auth"
            onClick={() => playPop()}
            className="btn-bounce rounded-full px-3 py-2 text-sm font-bold text-white/80 transition-colors hover:text-white sm:px-4"
          >
            Entrar
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signup" } as any}
            onClick={() => playPop()}
            data-char-button
            aria-label="Criar conta"
            className="btn-bounce inline-flex items-center rounded-full bg-acid px-5 py-2.5 text-sm font-bold text-ink"
          >
            <CharLabel text="Criar conta" />
          </Link>
        </div>
      </header>

      {/* conteúdo ancorado embaixo, estilo PK */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-end px-6 pb-14 pt-10 md:px-10">
        <p className="lp-fade text-[13px] font-bold uppercase tracking-[.08em] text-acid" style={fadeStyle(80)}>
          On Tennis · Olimpio Neto Treinamento Esportivo
        </p>
        <h1 className="mt-4 text-[clamp(2.75rem,8.5vw,7rem)] font-bold leading-[.88] tracking-[-.03em]">
          <span className="lp-line"><span style={lineStyle(0)}>Marque sua aula</span></span>
          <span className="lp-line">
            <span style={lineStyle(90)}>
              em <span className="text-acid">30 segundos</span>
            </span>
          </span>
          <span className="lp-line">
            <span style={lineStyle(180)}>e entre em quadra.</span>
          </span>
        </h1>

        <div className="lp-fade mt-8 flex flex-wrap items-center gap-3" style={fadeStyle(380)}>
          <Link
            to="/auth"
            onClick={() => playPop()}
            data-char-button
            aria-label="Reservar minha aula"
            className="btn-bounce inline-flex items-center rounded-full bg-acid px-7 py-3.5 text-base font-bold text-ink"
          >
            <CharLabel text="Reservar minha aula" />
          </Link>
          <a
            href="#contato"
            onClick={() => playPop()}
            className="btn-bounce rounded-full border border-white/40 px-7 py-3.5 text-base font-bold text-white transition-colors hover:bg-white/10"
          >
            Quero saber mais
          </a>
        </div>

        <div className="lp-fade mt-10 flex flex-wrap items-center justify-between gap-6 border-t border-white/20 pt-5" style={fadeStyle(520)}>
          <div className="flex flex-wrap gap-10">
            <HeroStat n="24/7" label="Reserva online" />
            <HeroStat n="2h" label="Cancelamento flexível" />
            <HeroStat n="100%" label="Pagamento seguro" />
          </div>
          <span className="hidden text-xs font-bold uppercase tracking-[.08em] text-white/40 md:block">
            Role para descobrir ↓
          </span>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div className="type-data text-2xl font-bold text-white">{n}</div>
      <div className="text-xs uppercase tracking-[.06em] text-white/50">{label}</div>
    </div>
  );
}

/* Vídeo do hero — enquanto não há URL, um placeholder de quadra desenhado em
   CSS (linhas de giz + ken burns) segura a composição. */
function HeroMedia() {
  if (HERO_VIDEO_URL) {
    return <video className="lp-kenburns h-full w-full object-cover" src={HERO_VIDEO_URL} autoPlay muted loop playsInline />;
  }
  return (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(160deg,#20301f_0%,#101a10_55%,#0b120c_100%)]">
      <div className="lp-kenburns absolute inset-0">
        {/* quadra em perspectiva simples */}
        <div className="absolute inset-x-[10%] inset-y-[14%] border-2 border-white/20" />
        <div className="absolute inset-x-[10%] top-1/2 h-0.5 bg-white/25" />
        <div className="absolute inset-y-[14%] left-1/2 w-0.5 bg-white/10" />
        <div className="absolute bottom-1/2 left-[28%] right-[28%] top-[14%] border-x-2 border-b-2 border-white/10" />
        <div className="absolute bottom-[14%] left-[28%] right-[28%] top-1/2 border-x-2 border-t-0 border-white/10" />
        {/* bola */}
        <div className="absolute left-[62%] top-[34%] h-5 w-5 rounded-full bg-acid" />
      </div>
      <span className="absolute bottom-4 left-4 z-10 border border-white/25 px-2 py-1 text-[11px] font-bold uppercase tracking-[.08em] text-white/50">
        Placeholder — vídeo: pessoas jogando tênis
      </span>
    </div>
  );
}

/* ============================================================================
 * MARQUEE tipográfico (PK) — palavras grandes, pausa no hover.
 * ========================================================================== */
function Marquee() {
  const words = ["Reserve", "Jogue", "Evolua", "On Tennis", "Match aberto", "Aulas em grupo"];
  const half = [...words, ...words];
  const track = [...half, ...half];
  return (
    <section className="overflow-hidden border-b border-border bg-background py-5" aria-label="On Tennis">
      <div className="lp-marquee flex w-max items-center gap-8">
        {track.map((w, i) => (
          <span key={i} className="flex shrink-0 items-center gap-8 whitespace-nowrap text-2xl font-bold uppercase tracking-[-.02em] text-foreground md:text-3xl">
            {w}
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-lime" aria-hidden />
          </span>
        ))}
      </div>
    </section>
  );
}

/* ============================================================================
 * FEATURES — lista numerada com hairlines (PK), título sticky à esquerda.
 * ========================================================================== */
function Features() {
  const items = [
    { n: "01", t: "Reserve em segundos", d: "Escolha o horário que cabe na sua rotina, direto do celular." },
    { n: "02", t: "Jogue do seu jeito", d: "Aula individual, dupla, trio ou quarteto — você decide com quem treinar." },
    { n: "03", t: "Pague com Pix", d: "A reserva é confirmada automaticamente depois da aprovação do pagamento." },
    { n: "04", t: "Fale com o professor", d: "Tire dúvidas, peça dicas e combine detalhes sem sair do app." },
    { n: "05", t: "Evolua jogando", d: "Avaliações, níveis e certificados para acompanhar seu progresso." },
    { n: "06", t: "Sem dor de cabeça", d: "Lembretes automáticos, confirmação rápida e cancelamento flexível." },
  ];
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-24 md:py-32">
      <div className="grid gap-12 md:grid-cols-[1fr_1.35fr] md:gap-16">
        <div className="self-start md:sticky md:top-16">
          <p data-reveal className="type-eyebrow">O que você ganha</p>
          <h2 data-reveal className="mt-3 text-4xl font-bold leading-[.9] tracking-[-.03em] md:text-6xl" style={{ transitionDelay: "60ms" }}>
            Tudo que o seu jogo precisa.
          </h2>
          <p data-reveal className="mt-5 max-w-sm text-muted-foreground" style={{ transitionDelay: "120ms" }}>
            Pensado para o aluno: marcar aula, pagar, treinar e evoluir — simples assim.
          </p>
        </div>
        <ul className="border-y border-border">
          {items.map((it, i) => (
            <li key={it.n} data-reveal style={{ transitionDelay: `${i * 50}ms` }} className={i > 0 ? "border-t border-border" : ""}>
              <div className="group flex gap-6 px-2 py-6 transition-colors hover:bg-card md:px-4 md:py-7">
                <span className="type-data w-12 shrink-0 text-2xl font-bold text-lime">{it.n}</span>
                <div>
                  <h3 className="text-xl font-bold md:text-2xl">{it.t}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground md:text-base">{it.d}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ============================================================================
 * DIVISORES DE MÍDIA — imagem full-bleed com revelação pixelada + legenda.
 * ========================================================================== */
function PixelReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const cells = Array.from(grid.children) as HTMLElement[];
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cells.forEach((c) => c.classList.add("off"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          io.disconnect();
          cells.forEach((c) => {
            c.style.transitionDelay = (Math.random() * 0.4).toFixed(3) + "s";
            c.classList.add("off");
          });
        }),
      { threshold: 0.25 },
    );
    io.observe(grid);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="lp-px" aria-hidden>
      {Array.from({ length: 100 }).map((_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

function MediaPlaceholder({ label, tone = "green" }: { label: string; tone?: "green" | "deep" }) {
  const bg = tone === "green"
    ? "bg-[linear-gradient(150deg,#26381f_0%,#131d12_60%,#0b120c_100%)]"
    : "bg-[linear-gradient(150deg,#17242b_0%,#0e161a_60%,#0b120c_100%)]";
  return (
    <div className={`relative h-full w-full overflow-hidden ${bg}`}>
      <div className="lp-kenburns absolute inset-0">
        <div className="absolute inset-x-[8%] inset-y-[16%] border-2 border-white/15" />
        <div className="absolute inset-x-[8%] top-1/2 h-0.5 bg-white/20" />
        <div className="absolute left-[70%] top-[30%] h-4 w-4 rounded-full bg-acid" />
      </div>
      <span className="absolute bottom-4 right-4 z-10 border border-white/25 px-2 py-1 text-[11px] font-bold uppercase tracking-[.08em] text-white/50">
        Placeholder — {label}
      </span>
    </div>
  );
}

function MediaBreak({
  src,
  video,
  eyebrow,
  title,
  placeholderLabel,
}: {
  src: string | null;
  video?: string | null;
  eyebrow: string;
  title: string;
  placeholderLabel: string;
}) {
  return (
    <section className="relative h-[60vh] w-full overflow-hidden md:h-[72vh]">
      {video ? (
        <video
          className="h-full w-full object-cover"
          src={video}
          poster={src ?? undefined}
          autoPlay
          muted
          loop
          playsInline
        />
      ) : src ? (
        <img src={src} alt="" className="lp-kenburns h-full w-full object-cover" />
      ) : (
        <MediaPlaceholder label={placeholderLabel} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
      <PixelReveal />
      <div className="absolute inset-x-0 bottom-0 z-[4] mx-auto w-full max-w-6xl px-6 pb-10 text-white md:px-10 md:pb-14">
        <p data-reveal className="text-[13px] font-bold uppercase tracking-[.08em] text-acid">{eyebrow}</p>
        <p data-reveal className="mt-3 max-w-3xl text-3xl font-bold leading-[.95] tracking-[-.02em] md:text-5xl" style={{ transitionDelay: "80ms" }}>
          {title}
        </p>
      </div>
    </section>
  );
}

/* Divisor duplo — duas imagens lado a lado com legendas. */
function MediaSplit() {
  const cells = [
    { src: MEDIA_SPLIT_A, eyebrow: "Aulas em grupo", title: "Dupla, trio ou quarteto.", label: "imagem — aula em grupo" },
    { src: MEDIA_SPLIT_B, eyebrow: "Treino individual", title: "Você e o professor.", label: "imagem — treino individual" },
  ];
  return (
    <section className="grid md:grid-cols-2">
      {cells.map((c, i) => (
        <div key={c.eyebrow} className="relative h-[45vh] overflow-hidden md:h-[56vh]">
          {c.src ? (
            <img src={c.src} alt="" className="lp-kenburns h-full w-full object-cover" />
          ) : (
            <MediaPlaceholder label={c.label} tone={i === 0 ? "green" : "deep"} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/10 to-transparent" />
          <PixelReveal />
          <div className="absolute inset-x-0 bottom-0 z-[4] p-6 text-white md:p-10">
            <p data-reveal className="text-[13px] font-bold uppercase tracking-[.08em] text-acid">{c.eyebrow}</p>
            <p data-reveal className="mt-2 text-2xl font-bold leading-none tracking-[-.02em] md:text-4xl" style={{ transitionDelay: "80ms" }}>
              {c.title}
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}

/* ============================================================================
 * COMO FUNCIONA — seção invertida (tinta), colunas com hairline, números acid.
 * ========================================================================== */
function HowItWorks() {
  const steps = [
    { n: "01", t: "Crie seu perfil", d: "Cadastro completo com foto, contato e dados do aluno." },
    { n: "02", t: "Escolha horário e professor", d: "Veja a disponibilidade e o tipo de aula." },
    { n: "03", t: "Pague e confirme", d: "Pagamento na plataforma garante sua reserva." },
    { n: "04", t: "Jogue!", d: "Receba lembretes e converse com seu professor." },
  ];
  return (
    <section id="how" className="bg-ink py-24 text-white md:py-32">
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <p data-reveal className="text-[13px] font-bold uppercase tracking-[.08em] text-white/50">Como funciona</p>
        <h2 data-reveal className="mt-3 text-4xl font-bold leading-[.9] tracking-[-.03em] md:text-6xl" style={{ transitionDelay: "60ms" }}>
          Do cadastro<br />ao saque inicial.
        </h2>
        <div className="mt-16 grid border-y border-white/15 md:grid-cols-4">
          {steps.map((s, i) => (
            <div
              key={s.n}
              data-reveal
              style={{ transitionDelay: `${i * 70}ms` }}
              className="border-white/15 p-6 max-md:border-t max-md:first:border-t-0 md:border-l md:p-8 md:first:border-l-0"
            >
              <div className="type-data text-5xl font-bold text-acid">{s.n}</div>
              <div className="mt-5 text-lg font-bold">{s.t}</div>
              <p className="mt-2 text-sm text-white/60">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const leadSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(100),
  phone: z.string().trim().min(8, "Telefone inválido").max(20),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  message: z.string().trim().max(500).optional().or(z.literal("")),
});

type Testimonial = { id: string; rating: number; comment: string | null; is_anonymous: boolean; student_id: string | null; student_name?: string | null };

function Testimonials() {
  const [items, setItems] = useState<Testimonial[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("professor_feedback")
        .select("id, rating, comment, is_anonymous, student_id")
        .eq("featured", true)
        .eq("approved_admin", true)
        .eq("public_consent", true)
        .order("created_at", { ascending: false })
        .limit(6);
      const list = (data ?? []) as Testimonial[];
      const ids = [...new Set(list.filter((t) => !t.is_anonymous && t.student_id).map((t) => t.student_id!))];
      let names: Record<string, string> = {};
      if (ids.length) {
        const { data: pf } = await (supabase as any).from("profiles_public").select("id, full_name").in("id", ids);
        names = Object.fromEntries((pf ?? []).map((p: any) => [p.id, p.full_name ?? ""]));
      }
      setItems(list.map((t) => ({ ...t, student_name: t.is_anonymous ? "Aluno(a)" : (t.student_id ? names[t.student_id] ?? "Aluno(a)" : "Aluno(a)") })));
    })();
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-6 py-24 md:py-32">
      <p data-reveal className="type-eyebrow">Depoimentos</p>
      <h2 data-reveal className="mt-3 max-w-2xl text-4xl font-bold leading-[.9] tracking-[-.03em] md:text-6xl" style={{ transitionDelay: "60ms" }}>
        Quem joga aqui, recomenda.
      </h2>
      <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((t, i) => (
          <div key={t.id} data-reveal style={{ transitionDelay: `${i * 50}ms` }} className="flex flex-col bg-card p-6">
            <div className="mb-4 flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={`h-4 w-4 ${n <= t.rating ? "fill-lime text-lime" : "text-muted-foreground/30"}`} />
              ))}
            </div>
            {t.comment && <p className="text-base font-medium leading-snug text-foreground">"{t.comment}"</p>}
            <div className="mt-auto pt-5 text-xs font-bold uppercase tracking-[.06em] text-muted-foreground">— {t.student_name}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LeadCapture() {
  const [form, setForm] = useState({ name: "", phone: "", city: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [whatsapp, setWhatsapp] = useState("");
  const [whatsappMsg, setWhatsappMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("site_settings")
        .select("key, value")
        .in("key", ["whatsapp_number", "whatsapp_message"]);
      const map = Object.fromEntries(((data as any[]) ?? []).map((r) => [r.key, r.value ?? ""]));
      setWhatsapp((map["whatsapp_number"] ?? "").replace(/[^\d]/g, ""));
      setWhatsappMsg(map["whatsapp_message"] ?? "");
    })();
  }, []);


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    playPop();
    const parsed = leadSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Confira os dados");
      return;
    }
    setLoading(true);
    const { error } = await (supabase as any).from("leads").insert({
      name: parsed.data.name,
      phone: parsed.data.phone,
      city: parsed.data.city || null,
      message: parsed.data.message || null,
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível enviar. Tente novamente.");
      return;
    }
    setSent(true);
    setForm({ name: "", phone: "", city: "", message: "" });
    toast.success("Recebemos seu contato! Em breve falaremos com você.");
  };

  return (
    <section id="contato" className="border-y border-border bg-card/30 py-24 md:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2 md:items-center md:px-10">
        <div>
          <p data-reveal className="type-eyebrow">Pré-cadastro</p>
          <h2 data-reveal className="mt-3 text-4xl font-bold leading-[.9] tracking-[-.03em] md:text-6xl" style={{ transitionDelay: "60ms" }}>
            Quer começar a jogar?
          </h2>
          <p data-reveal className="mt-5 max-w-md text-muted-foreground" style={{ transitionDelay: "120ms" }}>
            Conte rapidamente o que você procura — aula individual, em grupo, horário, nível.
            Nosso time entra em contato para encontrar o melhor horário para você.
          </p>
          <ul data-reveal className="mt-6 space-y-2 text-sm text-muted-foreground" style={{ transitionDelay: "180ms" }}>
            <li>• Resposta em até 1 dia útil</li>
            <li>• Sem compromisso</li>
            <li>• Atendimento personalizado</li>
          </ul>
        </div>

        <form
          data-reveal
          onSubmit={submit}
          className="space-y-3 bg-card p-6 md:p-8"
          style={{ transitionDelay: "140ms" }}
        >
          {sent ? (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-lime/20 text-2xl text-foreground">✓</div>
              <h3 className="text-xl font-bold">Recebido!</h3>
              <p className="text-sm text-muted-foreground">
                Entraremos em contato pelo telefone informado.
              </p>
              <button
                type="button"
                onClick={() => setSent(false)}
                className="btn-bounce mt-2 rounded-full border border-border bg-background px-4 py-2 text-xs font-medium hover:bg-secondary"
              >
                Enviar outro
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block type-eyebrow">Nome *</label>
                <input
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-input bg-background px-3 py-2.5 text-sm"
                  placeholder="Seu nome completo"
                />
              </div>
              <div>
                <label className="mb-1 block type-eyebrow">Telefone / WhatsApp *</label>
                <input
                  required
                  type="tel"
                  maxLength={20}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full border border-input bg-background px-3 py-2.5 text-sm"
                  placeholder="(51) 99999-9999"
                />
              </div>
              <div>
                <label className="mb-1 block type-eyebrow">Onde você mora</label>
                <input
                  maxLength={120}
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full border border-input bg-background px-3 py-2.5 text-sm"
                  placeholder="Cidade ou bairro"
                />
              </div>
              <div>
                <label className="mb-1 block type-eyebrow">Mensagem</label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full resize-none border border-input bg-background px-3 py-2.5 text-sm"
                  placeholder="Conte rapidamente o que você procura"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn-bounce w-full rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Enviando…
                  </span>
                ) : (
                  "Quero ser contatado"
                )}
              </button>
              {whatsapp && (
                <a
                  href={`https://wa.me/${whatsapp}${whatsappMsg ? `?text=${encodeURIComponent(whatsappMsg)}` : ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => playPop()}
                  className="btn-bounce mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-[#25D366] bg-[#25D366]/10 px-6 py-3 text-sm font-semibold text-[#128C7E] hover:bg-[#25D366]/20"
                >
                  <MessageCircle className="h-4 w-4" />
                  Falar agora no WhatsApp
                </a>
              )}

              <p className="text-center type-micro text-muted-foreground">
                Ao enviar, você concorda em receber contato sobre aulas e horários.
              </p>
            </>
          )}
        </form>
      </div>
    </section>
  );
}

const coachSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(120),
  email: z.string().trim().email("E-mail inválido").max(255),
  phone: z.string().trim().min(8, "Telefone inválido").max(20),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  message: z.string().trim().max(800).optional().or(z.literal("")),
});

function CoachApply() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", city: "", message: "" });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    playPop();
    const parsed = coachSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Confira os dados");
      return;
    }
    if (file && file.size > 10 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 10MB).");
      return;
    }
    setLoading(true);
    try {
      let cv_path: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
        const safeExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
        const { error: upErr } = await supabase.storage.from("coach-cvs").upload(path, file, {
          contentType: file.type || undefined,
          upsert: false,
        });
        if (upErr) throw upErr;
        cv_path = path;
      }
      const { error } = await (supabase as any).from("coach_applications").insert({
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        city: parsed.data.city || null,
        message: parsed.data.message || null,
        cv_path,
      });
      if (error) throw error;
      setSent(true);
      setForm({ name: "", email: "", phone: "", city: "", message: "" });
      setFile(null);
      toast.success("Candidatura enviada! Entraremos em contato.");
    } catch (err: any) {
      toast.error(err.message ?? "Não foi possível enviar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="trabalhe-conosco" className="mx-auto max-w-6xl px-6 py-24 md:px-10 md:py-32">
      <div className="grid gap-12 md:grid-cols-2 md:items-center">
        <div>
          <p data-reveal className="type-eyebrow flex items-center gap-2"><Trophy className="h-3.5 w-3.5" /> Trabalhe conosco</p>
          <h2 data-reveal className="mt-3 text-4xl font-bold leading-[.9] tracking-[-.03em] md:text-6xl" style={{ transitionDelay: "60ms" }}>
            É professor de tênis?
          </h2>
          <p data-reveal className="mt-5 max-w-md text-muted-foreground" style={{ transitionDelay: "120ms" }}>
            Coaches, professores e profissionais que querem trabalhar na nossa quadra podem enviar
            o currículo aqui. Vamos avaliar e entrar em contato.
          </p>
          <ul data-reveal className="mt-6 space-y-2 text-sm text-muted-foreground" style={{ transitionDelay: "180ms" }}>
            <li>• Estrutura completa e agenda integrada</li>
            <li>• Pagamentos e alunos organizados pela plataforma</li>
            <li>• Análise rápida da sua candidatura</li>
          </ul>
        </div>

        <form
          data-reveal
          onSubmit={submit}
          className="space-y-3 bg-card p-6 md:p-8"
          style={{ transitionDelay: "140ms" }}
        >
          {sent ? (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-lime/20 text-2xl text-foreground">✓</div>
              <h3 className="text-xl font-bold">Candidatura enviada!</h3>
              <p className="text-sm text-muted-foreground">Em breve entraremos em contato.</p>
              <button
                type="button"
                onClick={() => setSent(false)}
                className="btn-bounce mt-2 rounded-full border border-border bg-background px-4 py-2 text-xs font-medium hover:bg-secondary"
              >
                Enviar outra
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block type-eyebrow">Nome completo *</label>
                <input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-input bg-background px-3 py-2.5 text-sm" placeholder="Seu nome" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block type-eyebrow">E-mail *</label>
                  <input required type="email" maxLength={255} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full border border-input bg-background px-3 py-2.5 text-sm" placeholder="seu@email.com" />
                </div>
                <div>
                  <label className="mb-1 block type-eyebrow">WhatsApp *</label>
                  <input required type="tel" maxLength={20} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full border border-input bg-background px-3 py-2.5 text-sm" placeholder="(51) 99999-9999" />
                </div>
              </div>
              <div>
                <label className="mb-1 block type-eyebrow">Cidade</label>
                <input maxLength={120} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full border border-input bg-background px-3 py-2.5 text-sm" placeholder="Cidade ou bairro" />
              </div>
              <div>
                <label className="mb-1 block type-eyebrow">Sobre você</label>
                <textarea rows={3} maxLength={800} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full resize-none border border-input bg-background px-3 py-2.5 text-sm"
                  placeholder="Conte sua experiência, certificações, disponibilidade…" />
              </div>
              <div>
                <label className="mb-1 block type-eyebrow">Currículo (PDF, DOC, imagem — até 10MB)</label>
                <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,application/pdf,image/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground" />
                {file && <p className="mt-1 type-micro text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
              </div>
              <button type="submit" disabled={loading}
                className="btn-bounce w-full rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">
                {loading ? (
                  <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</span>
                ) : "Enviar candidatura"}
              </button>
              <p className="text-center type-micro text-muted-foreground">
                Seus dados serão analisados pela equipe da quadra.
              </p>
            </>
          )}
        </form>
      </div>
    </section>
  );
}

/* ============================================================================
 * CTA-BLOCK (PK) — bloco de largura total que inverte no hover, seta desliza.
 * ========================================================================== */
function CTA() {
  return (
    <section id="cta" className="py-24 md:py-32">
      <Link
        to="/auth"
        search={{ mode: "signup" } as any}
        onClick={() => playPop()}
        className="group flex min-h-[11rem] w-full items-center justify-center border-y-2 border-foreground text-foreground transition-colors duration-500 ease-[cubic-bezier(.625,.05,0,1)] hover:bg-ink hover:text-white md:min-h-[15rem]"
      >
        <span data-reveal className="flex items-center px-6 text-center text-[clamp(2rem,6vw,4.5rem)] font-bold uppercase leading-none tracking-[-.02em]">
          Criar conta grátis
          <span className="inline-block w-0 overflow-hidden opacity-0 transition-all duration-500 ease-[cubic-bezier(.625,.05,0,1)] group-hover:ml-5 group-hover:w-[1em] group-hover:opacity-100">
            →
          </span>
        </span>
      </Link>
    </section>
  );
}

/* ============================================================================
 * FOOTER — tipografia display (PK) + sociais do site_settings.
 * ========================================================================== */
function Footer() {
  const [socials, setSocials] = useState<{ key: string; url: string; icon: React.ReactNode; label: string }[]>([]);

  useEffect(() => {
    (async () => {
      const keys = ["social_instagram", "social_facebook", "social_youtube", "social_tiktok", "social_website"];
      const { data } = await (supabase as any)
        .from("site_settings")
        .select("key, value")
        .in("key", keys);
      const map = Object.fromEntries(((data as any[]) ?? []).map((r) => [r.key, (r.value ?? "").trim()]));
      const list = [
        { key: "instagram", url: map["social_instagram"], icon: <Instagram className="h-4 w-4" />, label: "Instagram" },
        { key: "facebook",  url: map["social_facebook"],  icon: <Facebook className="h-4 w-4" />,  label: "Facebook" },
        { key: "youtube",   url: map["social_youtube"],   icon: <Youtube className="h-4 w-4" />,   label: "YouTube" },
        { key: "tiktok",    url: map["social_tiktok"],    icon: <Music2 className="h-4 w-4" />,    label: "TikTok" },
        { key: "website",   url: map["social_website"],   icon: <Globe className="h-4 w-4" />,     label: "Site" },
      ]
        .map((social) => ({ ...social, url: safeExternalHttpUrl(social.url) }))
        .filter((social): social is typeof social & { url: string } => Boolean(social.url));
      setSocials(list);
    })();
  }, []);

  return (
    <footer className="bg-ink text-white">
      <div className="mx-auto max-w-6xl px-6 pb-8 pt-16 md:px-10 md:pt-24">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <nav className="flex flex-wrap gap-6 text-sm font-bold text-white/60">
            <a href="#features" className="transition-colors hover:text-white">Recursos</a>
            <a href="#how" className="transition-colors hover:text-white">Como funciona</a>
            <a href="#contato" className="transition-colors hover:text-white">Contato</a>
            <a href="#trabalhe-conosco" className="transition-colors hover:text-white">Trabalhe conosco</a>
          </nav>
          {socials.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {socials.map((s) => (
                <a
                  key={s.key}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="btn-bounce inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/25 text-white transition-colors hover:bg-acid hover:text-ink"
                >
                  {s.icon}
                </a>
              ))}
            </div>
          )}
        </div>

        <p data-reveal className="mt-14 text-[clamp(3rem,11vw,9rem)] font-bold leading-[.82] tracking-[-.04em]">
          Jogo, set e<br /><span className="text-acid">match.</span>
        </p>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/15 pt-6 text-xs text-white/50">
          <Logo className="h-7" />
          <p>© {new Date().getFullYear()} On Tennis. Todos os direitos reservados.</p>
        </div>
      </div>
    </footer>
  );
}

function FloatingWhatsApp() {
  const [whatsapp, setWhatsapp] = useState("");
  const [whatsappMsg, setWhatsappMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("site_settings")
        .select("key, value")
        .in("key", ["whatsapp_number", "whatsapp_message"]);
      const map = Object.fromEntries(((data as any[]) ?? []).map((r) => [r.key, r.value ?? ""]));
      setWhatsapp((map["whatsapp_number"] ?? "").replace(/[^\d]/g, ""));
      setWhatsappMsg(map["whatsapp_message"] ?? "");
    })();
  }, []);

  if (!whatsapp) return null;
  const href = `https://wa.me/${whatsapp}${whatsappMsg ? `?text=${encodeURIComponent(whatsappMsg)}` : ""}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => playPop()}
      aria-label="Reservar pelo WhatsApp"
      className="btn-bounce fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-3.5 text-sm font-semibold text-white hover:bg-[#1ebe5b]"
    >
      <MessageCircle className="h-5 w-5" />
      <span className="hidden sm:inline">Reservar pelo WhatsApp</span>
    </a>
  );
}
