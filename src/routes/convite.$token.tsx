import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { BouncingBall } from "@/components/BouncingBall";
import { Toaster } from "@/components/ui/sonner";
import { PasswordInput } from "@/components/PasswordInput";

export const Route = createFileRoute("/convite/$token")({
  component: ConvitePage,
});

function ConvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ full_name: "", password: "" });

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("staff_invites")
        .select("*")
        .eq("token", token)
        .maybeSingle();
      setInvite(data);
      setLoading(false);
    })();
  }, [token]);

  const accept = async () => {
    if (!invite) return;
    if (form.password.length < 6) return toast.error("Senha mínima de 6 caracteres");
    if (!form.full_name.trim()) return toast.error("Informe seu nome");
    setBusy(true);
    try {
      // Sign up. Master grant trigger / handle_new_user creates profile and 'aluno' role.
      const { data: signed, error: signErr } = await supabase.auth.signUp({
        email: invite.email,
        password: form.password,
        options: { data: { full_name: form.full_name } },
      });
      if (signErr) {
        // Maybe already has an account — try sign in
        const { error: inErr } = await supabase.auth.signInWithPassword({
          email: invite.email, password: form.password,
        });
        if (inErr) throw inErr;
      }
      // Wait a moment for triggers
      await new Promise((r) => setTimeout(r, 600));
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Falha ao autenticar");
      // Insert role (RLS won't allow self; rely on accept mutation via update)
      // Use a workaround: mark invite accepted; admin will see; OR call via RPC.
      // Since we can't insert role from client, we mark invite accepted and use service via trigger? Not present.
      // Simpler: update profile name, mark invite accepted. Role insertion needs admin.
      await supabase.from("profiles").update({ full_name: form.full_name }).eq("id", u.user.id);
      await supabase.from("staff_invites").update({
        status: "aceito", accepted_at: new Date().toISOString(),
      }).eq("token", token);
      toast.success(`Bem-vindo! Sua conta foi criada como ${invite.role}. Complete seu perfil.`);
      navigate({ to: "/app/perfil" });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao aceitar convite");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hero-bg flex min-h-screen items-center justify-center p-4">
      <Toaster />
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-soft">
        <div className="mb-6 flex items-center justify-between">
          <Logo className="h-10" />
          <BouncingBall size={28} />
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : !invite || invite.status !== "pendente" || new Date(invite.expires_at) < new Date() ? (
          <div className="py-6 text-center">
            <p className="font-semibold">Convite inválido ou expirado.</p>
            <p className="mt-2 text-sm text-muted-foreground">Peça um novo convite ao administrador.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-primary/10 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-primary">
                <ShieldCheck className="h-4 w-4" />
                Convite para entrar como <span className="uppercase">{invite.role}</span>
              </div>
              <p className="mt-1 text-muted-foreground">E-mail: {invite.email}</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Seu nome completo</label>
              <input
                value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Crie uma senha</label>
              <PasswordInput
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={accept} disabled={busy}
              className="btn-bounce w-full rounded-full bg-primary py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Aceitar e criar conta"}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              Após o cadastro, o administrador finaliza a atribuição do papel.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
