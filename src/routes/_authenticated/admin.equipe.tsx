import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Plus, Trash2, ShieldCheck, GraduationCap, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/equipe")({
  component: AdminEquipe,
});

const MASTER_EMAIL = "bruno@oddrive.com.br";

function AdminEquipe() {
  const [isMaster, setIsMaster] = useState(false);
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
      setIsMaster((u.user?.email ?? "").toLowerCase() === MASTER_EMAIL);
    })();
    load();
  }, []);

  const invite = async () => {
    if (!email.includes("@")) return toast.error("E-mail inválido");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("staff_invites").insert({
      email: email.toLowerCase(), role, invited_by: u.user.id,
    });
    if (error) return toast.error(error.message);
    setEmail("");
    toast.success("Convite criado");
    load();
  };

  const cancel = async (id: string) => {
    await supabase.from("staff_invites").update({ status: "cancelado" }).eq("id", id);
    load();
  };

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/convite/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado");
  };

  const removeRole = async (user_id: string, r: string) => {
    if (!confirm("Remover esse papel?")) return;
    await supabase.from("user_roles").delete().eq("user_id", user_id).eq("role", r as any);
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Equipe</h1>
        <p className="text-muted-foreground">Convide professores e admins. Cada um cria seu perfil ao aceitar.</p>
      </div>

      {isMaster ? (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-3 font-semibold">Novo convite</h2>
          <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" type="email"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <select value={role} onChange={(e) => setRole(e.target.value as any)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="professor">Professor</option>
              <option value="admin">Administrador</option>
            </select>
            <button onClick={invite} className="btn-bounce inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              <Plus className="h-4 w-4" /> Criar convite
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Copie e envie o link para o convidado. O envio automático por e-mail pode ser ativado depois.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-soft">
          Apenas o administrador master pode convidar ou aprovar novos membros da equipe.
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="mb-3 font-semibold">Convites</h2>
        <ul className="divide-y divide-border text-sm">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium">{i.email}</div>
                <div className="text-xs text-muted-foreground">
                  {i.role} · expira {format(new Date(i.expires_at), "dd/MM/yyyy")}
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${
                i.status === "aceito" ? "bg-primary/20 text-primary" :
                i.status === "pendente" ? "bg-muted text-muted-foreground" : "bg-destructive/20 text-destructive"
              }`}>{i.status}</span>
              {i.status === "pendente" && (
                <>
                  <button onClick={() => copyLink(i.token)} className="btn-bounce inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs">
                    <Copy className="h-3 w-3" /> Copiar link
                  </button>
                  {isMaster && (
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

      <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="mb-3 font-semibold">Membros atuais</h2>
        <ul className="divide-y divide-border text-sm">
          {team.map((t) => (
            <li key={`${t.user_id}-${t.role}`} className="flex items-center gap-3 py-3">
              {t.role === "admin" ? <ShieldCheck className="h-4 w-4 text-primary" /> : t.role === "professor" ? <GraduationCap className="h-4 w-4 text-primary" /> : <UserIcon className="h-4 w-4" />}
              <div className="flex-1">
                <div className="font-medium">{t.profile?.full_name ?? "Sem nome"}</div>
                <div className="text-xs text-muted-foreground">{t.profile?.phone ?? ""}</div>
              </div>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{t.role}</span>
              {isMaster && (
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
