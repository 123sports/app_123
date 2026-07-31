import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Menu, X, LogOut } from "lucide-react";
import { Logo } from "@/components/Logo";
import { playPop } from "@/lib/sfx";

/**
 * ON COURT — shell de menu lateral unificado (design-system §7).
 * Um só padrão de navegação para o app do aluno e o admin: rail fixo à
 * esquerda no desktop, drawer deslizante no mobile. Grupos com rótulo eyebrow,
 * item ativo em pill ácido, rodapé com usuário + sair.
 */
export type SideNavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
};
export type SideNavGroup = { label?: string; items: SideNavItem[] };

function initialsOf(name: string) {
  return (name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function Avatar({ url, name }: { url?: string | null; name: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-primary text-sm font-bold text-primary-foreground">
      {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : initialsOf(name)}
    </div>
  );
}

function NavList({ groups, onNavigate }: { groups: SideNavGroup[]; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4">
      {groups.map((g, i) => (
        <div key={g.label ?? `grp-${i}`} className={i > 0 ? "mt-6" : ""}>
          {g.label ? <p className="type-eyebrow px-3 pb-2">{g.label}</p> : null}
          <div className="flex flex-col gap-1">
            {g.items.map((it) => (
              <Link
                key={it.to}
                to={it.to}
                onClick={() => { playPop(); onNavigate?.(); }}
                activeOptions={{ exact: it.exact }}
                activeProps={{ className: "bg-primary text-primary-foreground" }}
                inactiveProps={{ className: "text-foreground hover:bg-accent" }}
                className="btn-bounce flex items-center gap-3 rounded-full px-3 py-2 text-sm font-bold"
              >
                <it.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{it.label}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function SidebarShell({
  groups,
  user,
  onLogout,
  badge,
  headerRight,
  homeTo = "/app",
  children,
}: {
  groups: SideNavGroup[];
  user: { name: string; avatarUrl?: string | null };
  onLogout: () => void;
  badge?: ReactNode;
  headerRight?: ReactNode;
  homeTo?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const SidebarBody = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
        <Link to={homeTo} onClick={() => playPop()} aria-label="Início">
          <Logo className="h-9" />
        </Link>
        {badge}
      </div>
      <NavList groups={groups} onNavigate={onNavigate} />
      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-3">
          <Avatar url={user.avatarUrl} name={user.name} />
          <span className="type-small min-w-0 flex-1 truncate">{user.name || "—"}</span>
          <button
            onClick={onLogout}
            aria-label="Sair"
            className="btn-bounce rounded-full border border-border p-2 hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="hero-bg min-h-screen">
      <div className="flex min-h-screen">
        {/* Rail fixo — colado à esquerda e ao topo (desktop) */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
          <SidebarBody />
        </aside>

        {/* Drawer — mobile */}
        {open ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden />
            <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-card animate-float-in">
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="btn-bounce absolute right-3 top-4 z-10 rounded-full p-2 hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
              <SidebarBody onNavigate={() => setOpen(false)} />
            </aside>
          </div>
        ) : null}

        {/* Conteúdo */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
            <button
              className="btn-bounce rounded-full p-2 lg:hidden"
              onClick={() => { playPop(); setOpen(true); }}
              aria-label="Menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link to={homeTo} onClick={() => playPop()} className="lg:hidden" aria-label="Início">
              <Logo className="h-8" />
            </Link>
            <div className="ml-auto flex items-center gap-2">{headerRight}</div>
          </header>
          <main className="w-full flex-1 p-6 animate-float-in">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
