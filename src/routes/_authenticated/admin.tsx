import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, CalendarClock, Users, Wallet, CreditCard, UserPlus, Trophy, ArrowLeft, LogOut, Inbox, Settings, Gift, Store, Handshake, Award, MessageSquareHeart, Lock, GraduationCap, FileText, FileSignature, UserCog, ScrollText, Presentation,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { BackButton } from "@/components/BackButton";
import { NotificationsBell } from "@/components/NotificationsBell";
import { playPop } from "@/lib/sfx";
import { Toaster } from "@/components/ui/sonner";
import { getAudience, clearAudience } from "@/lib/session-audience";

function AdminPageBack() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/admin") return null;
  return <div className="mb-4"><BackButton /></div>;
}

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    // Sessão precisa ter sido aberta como "equipe" — alunos não acessam admin
    // mesmo que a conta tenha papel administrativo.
    const audience = getAudience();
    if (audience !== "equipe") {
      throw redirect({ to: "/app" });
    }
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/app" });
  },
  component: AdminShell,
});

type NavItem = { to: string; label: string; icon: any; exact?: boolean };
type NavGroup = { group: string; icon: any; items: NavItem[] };
type NavEntry = NavItem | NavGroup;

const NAV: NavEntry[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/reservas", label: "Reservas", icon: CalendarClock },
  { to: "/admin/bloqueios", label: "Bloqueios", icon: Lock },
  { to: "/admin/aulas-planos", label: "Planos de Aulas", icon: GraduationCap },
  {
    group: "Contratos",
    icon: FileSignature,
    items: [
      { to: "/admin/aulas-contratos", label: "Contratos", icon: FileSignature },
      { to: "/admin/aulas-template", label: "Termo Padrão", icon: FileText },
      { to: "/admin/contrato-config", label: "Config. Contrato", icon: ScrollText },
      { to: "/admin/termos", label: "Termo de Aceite", icon: ScrollText },
    ],
  },
  { to: "/admin/coach-perfis", label: "Dados dos Coaches", icon: UserCog },
  { to: "/admin/match-aberto", label: "Match Aberto", icon: Handshake },
  { to: "/admin/leads", label: "Leads", icon: Inbox },
  { to: "/admin/alunos", label: "Alunos", icon: Users },
  { to: "/admin/avaliacoes", label: "Avaliações", icon: Award },
  { to: "/admin/feedbacks", label: "Feedbacks", icon: MessageSquareHeart },
  { to: "/admin/financeiro", label: "Financeiro", icon: Wallet },
  { to: "/admin/operadoras", label: "Operadoras", icon: CreditCard },
  { to: "/admin/equipe", label: "Equipe", icon: UserPlus },
  { to: "/admin/gamificacao", label: "Gamificação", icon: Trophy },
  { to: "/admin/indicacoes", label: "Indicações", icon: Gift },
  { to: "/admin/loja", label: "Loja", icon: Store },
  { to: "/admin/configuracoes", label: "Configurações", icon: Settings },
  { to: "/pitch", label: "Pitch Investidor", icon: Presentation },
];

function isGroup(e: NavEntry): e is NavGroup {
  return (e as NavGroup).group !== undefined;
}

function AdminShell() {
  const navigate = useNavigate();
  const [name, setName] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase.from("profiles").select("full_name").eq("id", u.user.id).maybeSingle();
      setName(data?.full_name ?? u.user.email ?? "");
    })();
  }, []);

  return (
    <div className="hero-bg min-h-screen">
      <Toaster />
      <header className="sticky top-0 z-30 border-b border-border/40 bg-gradient-to-b from-secondary/70 via-secondary/40 to-transparent backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link to="/app" onClick={() => playPop()} className="btn-bounce rounded-full border border-border bg-card p-2 hover:bg-secondary">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <Logo className="h-10" />
            <span className="hidden rounded-full bg-primary/20 px-3 py-1 text-xs font-semibold text-primary md:inline-block">
              Administração
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground md:inline">{name}</span>
            <NotificationsBell />
            <button
              onClick={async () => { playPop(); clearAudience(); await supabase.auth.signOut(); navigate({ to: "/" }); }}
              className="btn-bounce inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm hover:bg-secondary"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-border bg-card p-2 lg:flex-col lg:overflow-visible">
            {NAV.map((n, idx) => {
              if (isGroup(n)) {
                return (
                  <div key={`grp-${idx}`} className="shrink-0 lg:w-full">
                    <div className="hidden items-center gap-2 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:flex">
                      <n.icon className="h-3 w-3" /> {n.group}
                    </div>
                    <div className="flex gap-1.5 lg:flex-col lg:gap-1 lg:border-l lg:border-border/60 lg:pl-2">
                      {n.items.map((c) => (
                        <Link
                          key={c.to}
                          to={c.to}
                          onClick={() => playPop()}
                          activeProps={{ className: "bg-primary text-primary-foreground" }}
                          inactiveProps={{ className: "text-foreground hover:bg-secondary" }}
                          className="btn-bounce flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium"
                        >
                          <c.icon className="h-4 w-4" />
                          <span>{c.label}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => playPop()}
                  activeOptions={{ exact: n.exact }}
                  activeProps={{ className: "bg-primary text-primary-foreground" }}
                  inactiveProps={{ className: "text-foreground hover:bg-secondary" }}
                  className="btn-bounce flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium"
                >
                  <n.icon className="h-4 w-4" />
                  <span>{n.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 animate-float-in">
          <AdminPageBack />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
