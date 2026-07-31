import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, CalendarClock, Users, Wallet, CreditCard, UserPlus, Trophy, ArrowLeft, Inbox, Settings, Gift, Store, Handshake, Award, MessageSquareHeart, Lock, GraduationCap, FileText, FileSignature, ScrollText, Presentation, QrCode,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsBell } from "@/components/NotificationsBell";
import { SidebarShell, type SideNavGroup } from "@/components/SidebarShell";
import { playPop } from "@/lib/sfx";
import { Toaster } from "@/components/ui/sonner";
import { getAudience, clearAudience } from "@/lib/session-audience";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ location }) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const audience = getAudience();
    if (audience !== "equipe") {
      throw redirect({ to: "/app" });
    }
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    const isProfessor = (roles ?? []).some((r) => r.role === "professor");
    if (!isAdmin && !isProfessor) throw redirect({ to: "/app" });

    const staffRole = isAdmin ? "admin" as const : "professor" as const;
    if (
      staffRole === "professor"
      && !PROFESSOR_PATHS.some((path) =>
        path === "/admin"
          ? location.pathname === path || location.pathname === `${path}/`
          : location.pathname === path || location.pathname.startsWith(`${path}/`),
      )
    ) {
      throw redirect({ to: "/admin" });
    }

    return { staffRole };
  },
  component: AdminShell,
});

const PROFESSOR_PATHS = [
  "/admin",
  "/admin/reservas",
  "/admin/bloqueios",
  "/admin/alunos",
  "/admin/aluno",
  "/admin/avaliacoes",
  "/admin/feedbacks",
];

const ADMIN_NAV: SideNavGroup[] = [
  {
    label: "Operação",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/admin/reservas", label: "Reservas", icon: CalendarClock },
      { to: "/admin/bloqueios", label: "Bloqueios", icon: Lock },
      { to: "/admin/match-aberto", label: "Match Aberto", icon: Handshake },
    ],
  },
  {
    label: "Aulas",
    items: [
      { to: "/admin/aulas-planos", label: "Planos de Aulas", icon: GraduationCap },
      { to: "/admin/aulas-contratos", label: "Contratos", icon: FileSignature },
      { to: "/admin/aulas-template", label: "Termo Padrão", icon: FileText },
      { to: "/admin/contrato-config", label: "Config. Contrato", icon: ScrollText },
      { to: "/admin/termos", label: "Termo de Aceite", icon: ScrollText },
    ],
  },
  {
    label: "Pessoas",
    items: [
      { to: "/admin/alunos", label: "Alunos", icon: Users },
      { to: "/admin/leads", label: "Leads", icon: Inbox },
      { to: "/admin/avaliacoes", label: "Avaliações", icon: Award },
      { to: "/admin/feedbacks", label: "Feedbacks", icon: MessageSquareHeart },
      { to: "/admin/equipe", label: "Equipe", icon: UserPlus },
    ],
  },
  {
    label: "Negócio",
    items: [
      { to: "/admin/pagamentos", label: "Pagamentos", icon: QrCode },
      { to: "/admin/financeiro", label: "Financeiro", icon: Wallet },
      { to: "/admin/operadoras", label: "Operadoras", icon: CreditCard },
      { to: "/admin/gamificacao", label: "Gamificação", icon: Trophy },
      { to: "/admin/indicacoes", label: "Indicações", icon: Gift },
      { to: "/admin/loja", label: "Loja", icon: Store },
    ],
  },
  {
    label: "Sistema",
    items: [
      { to: "/admin/configuracoes", label: "Configurações", icon: Settings },
      { to: "/pitch", label: "Pitch Investidor", icon: Presentation },
    ],
  },
];

const PROFESSOR_NAV: SideNavGroup[] = [
  {
    label: "Operação",
    items: [
      { to: "/admin", label: "Minha agenda", icon: LayoutDashboard, exact: true },
      { to: "/admin/reservas", label: "Reservas", icon: CalendarClock },
      { to: "/admin/bloqueios", label: "Meus bloqueios", icon: Lock },
    ],
  },
  {
    label: "Alunos",
    items: [
      { to: "/admin/alunos", label: "Meus alunos", icon: Users },
      { to: "/admin/avaliacoes", label: "Avaliações", icon: Award },
      { to: "/admin/feedbacks", label: "Feedbacks", icon: MessageSquareHeart },
    ],
  },
];

function AdminShell() {
  const navigate = useNavigate();
  const { staffRole } = Route.useRouteContext();
  const [name, setName] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase.from("profiles").select("full_name").eq("id", u.user.id).maybeSingle();
      setName(data?.full_name ?? u.user.email ?? "");
    })();
  }, []);

  const handleLogout = async () => {
    playPop();
    clearAudience();
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <>
      <Toaster />
      <SidebarShell
        groups={staffRole === "admin" ? ADMIN_NAV : PROFESSOR_NAV}
        user={{ name }}
        onLogout={handleLogout}
        homeTo="/admin"
        badge={
          <span className="ml-1 hidden rounded-full bg-primary/15 px-2.5 py-1 type-micro font-bold text-foreground sm:inline-block">
            {staffRole === "admin" ? "Admin" : "Professor"}
          </span>
        }
        headerRight={
          <>
            <NotificationsBell />
            <Link
              to="/app"
              onClick={() => playPop()}
              className="btn-bounce flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-bold hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" /> Ver como aluno
            </Link>
          </>
        }
      >
        <Outlet />
      </SidebarShell>
    </>
  );
}
