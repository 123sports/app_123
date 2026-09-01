import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Home, User, CalendarDays, ShieldCheck, GraduationCap, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsBell } from "@/components/NotificationsBell";
import { TermsGate } from "@/components/TermsGate";
import { SidebarShell, type SideNavGroup } from "@/components/SidebarShell";
import { playPop } from "@/lib/sfx";
import { Toaster } from "@/components/ui/sonner";
import { getAudience, clearAudience } from "@/lib/session-audience";

export const Route = createFileRoute("/_authenticated/app")({
  component: AppShell,
});

const NAV: SideNavGroup[] = [
  {
    label: "Quadra",
    items: [
      { to: "/app", label: "Início", icon: Home, exact: true },
      { to: "/app/agenda", label: "Agenda", icon: CalendarDays },
      { to: "/app/pagamentos", label: "Pagamentos", icon: QrCode },
      { to: "/app/aulas", label: "Minhas Aulas", icon: GraduationCap },
    ],
  },
  {
    label: "Mais",
    items: [{ to: "/app/perfil", label: "Perfil", icon: User }],
  },
];

function AppShell() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

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
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(data.avatar_url, 3600);
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
      <Toaster />
      <SidebarShell
        groups={NAV}
        user={{ name, avatarUrl: avatar }}
        onLogout={handleLogout}
        homeTo="/app"
        headerRight={
          <>
            <NotificationsBell />
            {isAdmin ? (
              <Link
                to="/admin"
                onClick={() => playPop()}
                className="btn-bounce flex items-center gap-2 rounded-full border border-primary px-4 py-2 text-sm font-bold text-foreground hover:bg-accent"
              >
                <ShieldCheck className="h-4 w-4" /> Admin
              </Link>
            ) : null}
          </>
        }
      >
        <Outlet />
      </SidebarShell>
    </TermsGate>
  );
}
