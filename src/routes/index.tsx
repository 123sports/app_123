import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Calendar, MessageCircle, CreditCard, Users, Clock, Trophy, Loader2, Instagram, Facebook, Youtube, Music2, Globe, Star, Sparkles, Zap, Heart } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import landingLogo from "@/assets/brand/on-tennis-app-light.png";

import { TennisSwingVideo } from "@/components/TennisSwingVideo";

import { playPop } from "@/lib/sfx";
import { supabase } from "@/integrations/supabase/client";
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

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/app" });
    });
  }, [navigate]);
  return (
    <div className="min-h-screen hero-bg">
      <Toaster />
      <Header />
      <Hero />
      <SocialProofBar />
      <Features />
      <HowItWorks />
      <Testimonials />
      <LeadCapture />
      <CoachApply />
      <CTA />
      <Footer />
      <FloatingWhatsApp />
    </div>
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
      className="btn-bounce fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-3.5 text-sm font-semibold text-white shadow-glow hover:bg-[#1ebe5b]"
    >
      <MessageCircle className="h-5 w-5" />
      <span className="hidden sm:inline">Reservar pelo WhatsApp</span>
    </a>
  );
}

function Header() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <img
        src={landingLogo}
        alt="On Tennis — Olimpio Neto Treinamento Esportivo"
        className="h-16 md:h-20 w-auto object-contain"
      />
      <nav className="hidden items-center gap-8 text-sm font-medium md:flex">
        <a href="#features" className="hover:text-primary">Recursos</a>
        <a href="#how" className="hover:text-primary">Como funciona</a>
        <a href="#cta" className="hover:text-primary">Começar</a>
      </nav>
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          to="/auth"
          onClick={() => playPop()}
          className="btn-bounce rounded-full px-3 py-2 text-sm font-semibold text-foreground hover:text-primary sm:px-4"
        >
          Entrar
        </Link>
        <Link
          to="/auth"
          search={{ mode: "signup" } as any}
          onClick={() => playPop()}
          className="btn-bounce inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow sm:px-5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Criar conta
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative mx-auto grid max-w-6xl gap-12 px-6 py-16 md:grid-cols-2 md:items-center md:py-24">
      <div className="absolute -left-32 top-20 -z-10 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute right-0 bottom-0 -z-10 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative z-20 animate-float-in space-y-6">

        <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
          <Sparkles className="h-3 w-3" />
          Nova forma de jogar tênis
        </span>
        <h1 className="text-5xl font-bold leading-[1.05] md:text-6xl lg:text-7xl">
          Marque sua aula{" "}
          <span className="relative inline-block">
            <span className="relative z-10 text-foreground">em 30 segundos</span>
            <span className="absolute inset-x-0 bottom-1 -z-0 h-4 bg-primary/70 md:h-5" />
          </span>{" "}
          e entre em quadra.
        </h1>
        <p className="max-w-lg text-lg text-muted-foreground md:text-xl">
          Chega de WhatsApp lotado e horário trocado. Reserve, pague e jogue —
          tudo direto do seu celular, 24 horas por dia.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            to="/auth"
            onClick={() => playPop()}
            className="btn-bounce inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-base font-semibold text-primary-foreground shadow-glow"
          >
            <Zap className="h-5 w-5" /> Reservar minha aula
          </Link>
          <a
            href="#contato"
            onClick={() => playPop()}
            className="btn-bounce rounded-full border border-border bg-card px-6 py-3.5 text-base font-semibold text-foreground hover:border-primary"
          >
            Quero saber mais
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-6 pt-4 text-sm text-muted-foreground">
          <Stat n="24/7" label="Reserva online" />
          <Stat n="2h" label="Cancele com antecedência" />
          <Stat n="100%" label="Pagamento seguro" />
        </div>
      </div>

      <div className="relative flex items-center justify-center">
        <BallShowcase />
      </div>
    </section>
  );
}





function SocialProofBar() {
  return (
    <section className="border-y border-border bg-card/40 py-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-6 px-6 text-center text-sm text-muted-foreground md:gap-12">
        <div className="flex items-center gap-2"><Heart className="h-4 w-4 text-primary" /> <span>Alunos amam reservar pelo app</span></div>
        <div className="flex items-center gap-2"><Star className="h-4 w-4 fill-primary text-primary" /> <span>Aulas avaliadas em tempo real</span></div>
        <div className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-primary" /> <span>Professor a um clique de distância</span></div>
      </div>
    </section>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div className="text-xl font-bold text-foreground">{n}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function BallShowcase() {
  return (
    <div className="relative flex h-[520px] w-full items-center justify-center">
      <div className="absolute inset-0 rounded-[2rem] bg-primary/15 blur-3xl" />
      {/* Full-body player: contain so feet + racket follow-through stay in frame. */}
      <TennisSwingVideo className="h-full w-full object-contain" />
    </div>
  );
}



function Features() {
  const items = [
    { icon: Calendar, title: "Reserve em segundos", desc: "Escolha o horário que cabe na sua rotina, direto do celular." },
    { icon: Users, title: "Jogue do seu jeito", desc: "Aula individual, dupla, trio ou quarteto — você decide com quem treinar." },
    { icon: CreditCard, title: "Pague como preferir", desc: "PIX, crédito, débito ou mensalidade. Sua reserva já sai garantida." },
    { icon: MessageCircle, title: "Fale com o professor", desc: "Tire dúvidas, peça dicas e combine detalhes sem sair do app." },
    { icon: Trophy, title: "Evolua jogando", desc: "Acompanhe vitórias, aces e gamificação para ver seu progresso." },
    { icon: Clock, title: "Sem dor de cabeça", desc: "Lembretes automáticos, confirmação rápida e cancelamento flexível." },
  ];
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-20">
      <h2 className="max-w-2xl text-4xl font-bold">Tudo que o seu jogo precisa, num só app.</h2>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Pensado para o aluno: marcar aula, pagar, treinar e evoluir — simples assim.
      </p>
      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.title}
            className="group rounded-2xl border border-border bg-card p-6 shadow-soft transition hover:-translate-y-1 hover:border-primary"
          >
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground transition group-hover:scale-110">
              <it.icon className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold">{it.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{it.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", t: "Crie seu perfil", d: "Cadastro completo com foto, contato e dados do aluno." },
    { n: "02", t: "Escolha horário e professor", d: "Veja a disponibilidade e o tipo de aula." },
    { n: "03", t: "Pague e confirme", d: "Pagamento na plataforma garante sua reserva." },
    { n: "04", t: "Jogue!", d: "Receba lembretes e converse com seu professor." },
  ];
  return (
    <section id="how" className="bg-secondary/40 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-4xl font-bold">Do cadastro ao saque inicial.</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-card p-6">
              <div className="text-3xl font-bold text-primary">{s.n}</div>
              <div className="mt-3 font-semibold">{s.t}</div>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
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
    <section className="bg-secondary/40 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
            <Star className="h-3 w-3 fill-primary" /> Depoimentos
          </span>
          <h2 className="mt-4 text-4xl font-bold md:text-5xl">Quem joga aqui, recomenda.</h2>
          <p className="mt-3 text-muted-foreground">Avaliações reais de alunos que treinam com a gente.</p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <div key={t.id} className="rounded-2xl border border-border bg-card p-6 shadow-soft transition hover:-translate-y-1 hover:border-primary">
              <div className="mb-3 flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={`h-4 w-4 ${n <= t.rating ? "fill-primary text-primary" : "text-muted-foreground/30"}`} />
                ))}
              </div>
              {t.comment && <p className="text-sm italic text-foreground/90">"{t.comment}"</p>}
              <div className="mt-4 text-xs font-semibold text-muted-foreground">— {t.student_name}</div>
            </div>
          ))}
        </div>
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
    <section id="contato" className="bg-secondary/40 py-20">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 md:grid-cols-2 md:items-center">
        <div className="space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">
            Pré-cadastro
          </span>
          <h2 className="text-4xl font-bold leading-tight md:text-5xl">
            Quer começar a jogar? Deixe seu contato.
          </h2>
          <p className="text-muted-foreground">
            Conte rapidamente o que você procura — aula individual, em grupo, horário, nível.
            Nosso time entra em contato para encontrar o melhor horário para você.
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Resposta em até 1 dia útil</li>
            <li>• Sem compromisso</li>
            <li>• Atendimento personalizado</li>
          </ul>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3 rounded-3xl border border-border bg-card p-6 shadow-soft"
        >
          {sent ? (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary text-2xl">✓</div>
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
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome *</label>
                <input
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                  placeholder="Seu nome completo"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Telefone / WhatsApp *</label>
                <input
                  required
                  type="tel"
                  maxLength={20}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                  placeholder="(51) 99999-9999"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Onde você mora</label>
                <input
                  maxLength={120}
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                  placeholder="Cidade ou bairro"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Mensagem</label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                  placeholder="Conte rapidamente o que você procura"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn-bounce w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
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

              <p className="text-center text-[10px] text-muted-foreground">
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
    <section id="trabalhe-conosco" className="mx-auto max-w-6xl px-6 py-20">
      <div className="grid gap-10 md:grid-cols-2 md:items-center">
        <div className="space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">
            <Trophy className="h-3 w-3" /> Trabalhe conosco
          </span>
          <h2 className="text-4xl font-bold leading-tight md:text-5xl">
            É professor de tênis? Venha fazer parte do nosso time.
          </h2>
          <p className="text-muted-foreground">
            Coaches, professores e profissionais que querem trabalhar na nossa quadra podem enviar
            o currículo aqui. Vamos avaliar e entrar em contato.
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Estrutura completa e agenda integrada</li>
            <li>• Pagamentos e alunos organizados pela plataforma</li>
            <li>• Análise rápida da sua candidatura</li>
          </ul>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3 rounded-3xl border border-border bg-card p-6 shadow-soft"
        >
          {sent ? (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary text-2xl">✓</div>
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
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome completo *</label>
                <input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm" placeholder="Seu nome" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">E-mail *</label>
                  <input required type="email" maxLength={255} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm" placeholder="seu@email.com" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">WhatsApp *</label>
                  <input required type="tel" maxLength={20} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm" placeholder="(51) 99999-9999" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Cidade</label>
                <input maxLength={120} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm" placeholder="Cidade ou bairro" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Sobre você</label>
                <textarea rows={3} maxLength={800} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                  placeholder="Conte sua experiência, certificações, disponibilidade…" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Currículo (PDF, DOC, imagem — até 10MB)</label>
                <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,application/pdf,image/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground" />
                {file && <p className="mt-1 text-[11px] text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
              </div>
              <button type="submit" disabled={loading}
                className="btn-bounce w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60">
                {loading ? (
                  <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</span>
                ) : "Enviar candidatura"}
              </button>
              <p className="text-center text-[10px] text-muted-foreground">
                Seus dados serão analisados pela equipe da quadra.
              </p>
            </>
          )}
        </form>
      </div>
    </section>
  );
}


function CTA() {
  return (
    <section id="cta" className="mx-auto max-w-6xl px-6 py-24">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-foreground p-12 text-background shadow-glow md:p-16">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-primary/40 blur-3xl" />
        <div className="relative max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/20 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="h-3 w-3" /> Comece hoje
          </span>
          <h2 className="mt-4 text-4xl font-bold md:text-5xl">Sua próxima aula está a 2 toques.</h2>
          <p className="mt-4 text-background/80">
            Crie sua conta grátis, escolha o melhor horário e venha jogar.
            Quem chega no On Tennis, joga mais — e melhor.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/auth"
              onClick={() => playPop()}
              className="btn-bounce rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground"
            >
              Criar conta grátis
            </Link>
            <Link
              to="/auth"
              onClick={() => playPop()}
              className="btn-bounce rounded-full border border-background/30 bg-transparent px-6 py-3 font-semibold text-background"
            >
              Já tenho conta
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

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
      ].filter((s) => s.url);
      setSocials(list);
    })();
  }, []);

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground md:flex-row">
        <Logo className="h-8" />
        {socials.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {socials.map((s) => (
              <a
                key={s.key}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                className="btn-bounce inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground transition hover:bg-primary hover:text-primary-foreground"
              >
                {s.icon}
              </a>
            ))}
          </div>
        )}
        <p>© {new Date().getFullYear()} On Tennis. Todos os direitos reservados.</p>
      </div>
    </footer>
  );
}

function BounceButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      onClick={(e) => {
        playPop();
        rest.onClick?.(e);
      }}
      className={`btn-bounce inline-flex items-center justify-center rounded-full ${className}`}
    >
      {children}
    </button>
  );
}
