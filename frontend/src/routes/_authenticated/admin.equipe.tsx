import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Plus, Trash2, ShieldCheck, GraduationCap, User as UserIcon, Users, UserCog } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { PageHeader } from "@/components/PageHeader";
import { ViewTabs } from "@/components/ViewTabs";
import { CoachProfilesPanel } from "./admin.coach-perfis";
import { useConfirmation } from "@/hooks/use-confirmation";

export const Route = createFileRoute("/_authenticated/admin/equipe")({
  component: AdminEquipe,
});

function AdminEquipe() {
  const [tab, setTab] = useState<"membros" | "coaches">("membros");
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin · Equipe"
        title="Equipe"
        subtitle="Convites, membros e as fichas dos coaches usadas nos contratos."
      />
      <ViewTabs
        tabs={[
          { key: "membros", label: "Membros & convites", icon: Users },
          { key: "coaches", label: "Perfis dos coaches", icon: UserCog },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "membros" ? <TeamPanel /> : <CoachProfilesPanel />}
    </div>
  );
}

function TeamPanel() {
  const requestConfirmation = useConfirmation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [invites, setInvites] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "professor">("professor");

  const load = async () => {
    const [{ data: inv }, { data: ur }] = await Promise.all([
      supabase.from("staff_invites").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role").in("role", ["admin", "professor"]),
    ]);
    setInvites(inv ?? []);
    if (ur && ur.length) {
      const ids = [...new Set(ur.map((r: any) => r.user_id))];
      const { data: profs } = await supabase.from("profiles").select("id, full_name, phone").in("id", ids);
      setTeam(ur.map((r: any) => ({ ...r, profile: profs?.find((p: any) => p.id === r.user_id) })));
    } else setTeam([]);
  };
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id)
        .eq("role", "admin");
      setIsAdmin((roles ?? []).length > 0);
    })();
    load();
  }, []);

  const invite = async () => {
    if (!email.includes("@")) return toast.error("E-mail inválido");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("staff_invites").insert({
      email: email.trim().toLowerCase(), role, invited_by: u.user.id,
    });
    if (error) return toast.error(error?.message ?? "Não foi possível criar o convite. Tente de novo.");
    setEmail("");
    toast.success("Convite criado");
    load();
  };

  const cancel = async (id: string) => {
    const { error } = await supabase.from("staff_invites").update({ status: "cancelado" }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    load();
  };

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/convite-equipe/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado");
  };

  const removeRole = async (user_id: string, r: string) => {
    const confirmed = await requestConfirmation({
      title: "Remover este acesso?",
      description: `O papel de ${r} será removido deste usuário.`,
      confirmLabel: "Remover acesso",
      cancelLabel: "Manter acesso",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await supabase.from("user_roles").delete().eq("user_id", user_id).eq("role", r as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Papel removido.");
    load();
  };

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <section className="plane">
          <h2 className="type-h3 mb-3">Novo convite</h2>
          <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" type="email"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <select value={role} onChange={(e) => setRole(e.target.value as any)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="professor">Professor</option>
              <option value="admin">Administrador</option>
            </select>
            <button onClick={invite} className="btn-bounce inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              <Plus className="h-4 w-4" /> Criar convite
            </button>
          </div>
          <p className="type-small mt-2 text-muted-foreground">
            Copie e envie o link para o convidado. O envio automático por e-mail pode ser ativado depois.
          </p>
        </section>
      ) : (
        <section className="plane type-small text-muted-foreground">
          Apenas administradores podem convidar ou aprovar novos membros da equipe.
        </section>
      )}

      <section className="plane">
        <h2 className="type-h3 mb-3">Convites</h2>
        <ul className="divide-y divide-border text-sm">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium">{i.email}</div>
                <div className="type-small text-muted-foreground">
                  {i.role} · expira {format(new Date(i.expires_at), "dd/MM/yyyy")}
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${
                i.status === "aceito" ? "bg-primary/20 text-primary" :
                i.status === "pendente" ? "bg-muted text-muted-foreground" : "bg-destructive/20 text-destructive"
              }`}>{i.status}</span>
              {i.status === "pendente" && (
                <>
                  <button onClick={() => copyLink(i.token)} className="btn-bounce inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-accent">
                    <Copy className="h-3 w-3" /> Copiar link
                  </button>
                  {isAdmin && (
                    <button onClick={() => cancel(i.id)} className="btn-bounce text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
          {invites.length === 0 && <p className="py-6 text-center text-muted-foreground">Nenhum convite ainda.</p>}
        </ul>
      </section>

      <section className="plane">
        <h2 className="type-h3 mb-3">Membros atuais</h2>
        <ul className="divide-y divide-border text-sm">
          {team.map((t) => (
            <li key={`${t.user_id}-${t.role}`} className="flex items-center gap-3 py-3">
              {t.role === "admin" ? <ShieldCheck className="h-4 w-4 text-primary" /> : t.role === "professor" ? <GraduationCap className="h-4 w-4 text-primary" /> : <UserIcon className="h-4 w-4" />}
              <div className="flex-1">
                <div className="font-medium">{t.profile?.full_name ?? "Sem nome"}</div>
                <div className="type-small text-muted-foreground">{t.profile?.phone ?? ""}</div>
              </div>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{t.role}</span>
              {isAdmin && (
                <button onClick={() => removeRole(t.user_id, t.role)} className="btn-bounce text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
          {team.length === 0 && <p className="py-6 text-center text-muted-foreground">Nenhum membro além de você.</p>}
        </ul>
      </section>
    </div>
  );
}
