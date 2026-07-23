import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Home, User, CalendarDays, LogOut, Menu, X, ShieldCheck, Gift, Store, Handshake, TrendingUp, Star, GraduationCap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { BackButton } from "@/components/BackButton";
import { NotificationsBell } from "@/components/NotificationsBell";
import { TermsGate } from "@/components/TermsGate";

import { playPop } from "@/lib/sfx";
import { Toaster } from "@/components/ui/sonner";
import { getAudience, clearAudience } from "@/lib/session-audience";

function PageBack() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/app") return null;
  return <div className="mb-4"><BackButton /></div>;
}

export const Route = createFileRoute("/_authenticated/app")({
  component: AppShell,
});

function AppShell() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("full_name, avatar_url").eq("id", u.user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", u.user.id),
      ]);
      setName(data?.full_name ?? "");
      // Só mostra atalho "Admin" se a sessão foi aberta como equipe E o usuário tem papel admin
      const hasAdminRole = (roles ?? []).some((r) => r.role === "admin");
      setIsAdmin(hasAdminRole && getAudience() === "equipe");
      if (data?.avatar_url) {
        const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(data.avatar_url, 3600);
        setAvatar(signed?.signedUrl ?? null);
      }
    })();
  }, []);

  const handleLogout = async () => {
    playPop();
    clearAudience();
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <TermsGate>
    <div className="hero-bg min-h-screen">
      <Toaster />
      <header className="sticky top-0 z-30 border-b border-border/40 bg-gradient-to-b from-secondary/70 via-secondary/40 to-transparent backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4">
          <div className="flex shrink-0 items-center gap-8">
            <button
              className="btn-bounce rounded-full p-2 md:hidden"
              onClick={() => { playPop(); setOpen(!open); }}
              aria-label="Menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Logo className="h-28 sm:h-32 md:h-28 lg:h-32" />
          </div>

          <nav className="ml-8 hidden items-center gap-2 md:flex">
            <NavLink to="/app" icon={Home} label="Início" />
            <NavLink to="/app/agenda" icon={CalendarDays} label="Agenda" />
            <NavLink to="/app/aulas" icon={GraduationCap} label="Minhas Aulas" />
            <NavLink to="/app/evolucao" icon={TrendingUp} label="Evolução" />
            <NavLink to="/app/match-aberto" icon={Handshake} label="Match Aberto" />
            <NavLink to="/app/indicacoes" icon={Gift} label="Indique e ganhe" />
            <NavLink to="/app/loja" icon={Store} label="Loja" />
            <NavLink to="/app/feedback" icon={Star} label="Avaliar prof." />
            <NavLink to="/app/perfil" icon={User} label="Perfil" />
            {isAdmin && (
              <Link to="/admin" onClick={() => playPop()}
                className="btn-bounce flex items-center gap-2 rounded-full border border-primary bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20">
                <ShieldCheck className="h-4 w-4" /> Admin
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-3">
            <div className="md:hidden"><NotificationsBell /></div>
            <div className="hidden items-center gap-2 md:flex">
              <NotificationsBell />
              <Avatar url={avatar} name={name} />
              <button
                onClick={handleLogout}
                className="btn-bounce inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm hover:bg-secondary"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        {open && (
          <div className="border-t border-border bg-background md:hidden">
            <nav className="flex flex-col gap-1 p-3">
              <NavLink to="/app" icon={Home} label="Início" onClick={() => setOpen(false)} />
              <NavLink to="/app/agenda" icon={CalendarDays} label="Agenda" onClick={() => setOpen(false)} />
              <NavLink to="/app/aulas" icon={GraduationCap} label="Minhas Aulas" onClick={() => setOpen(false)} />
              <NavLink to="/app/evolucao" icon={TrendingUp} label="Evolução" onClick={() => setOpen(false)} />
              <NavLink to="/app/match-aberto" icon={Handshake} label="Match Aberto" onClick={() => setOpen(false)} />
              <NavLink to="/app/indicacoes" icon={Gift} label="Indique e ganhe" onClick={() => setOpen(false)} />
              <NavLink to="/app/loja" icon={Store} label="Loja" onClick={() => setOpen(false)} />
              <NavLink to="/app/feedback" icon={Star} label="Avaliar prof." onClick={() => setOpen(false)} />
              <NavLink to="/app/perfil" icon={User} label="Perfil" onClick={() => setOpen(false)} />
              {isAdmin && (
                <Link to="/admin" onClick={() => { playPop(); setOpen(false); }}
                  className="btn-bounce flex items-center gap-2 rounded-xl border border-primary bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                  <ShieldCheck className="h-4 w-4" /> Admin
                </Link>
              )}
              <button
                onClick={handleLogout}
                className="btn-bounce mt-2 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm"
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </nav>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <PageBack />
        <Outlet />
      </main>
    </div>
    </TermsGate>
  );
}

function NavLink({
  to, icon: Icon, label, onClick,
}: { to: string; icon: any; label: string; onClick?: () => void }) {
  return (
    <Link
      to={to}
      onClick={() => { playPop(); onClick?.(); }}
      activeOptions={{ exact: to === "/app" }}
      activeProps={{ className: "bg-primary text-primary-foreground" }}
      inactiveProps={{ className: "text-foreground hover:bg-secondary" }}
      className="btn-bounce flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  const initials = (name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-border bg-primary text-sm font-bold text-primary-foreground">
      {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : initials}
    </div>
  );
}
