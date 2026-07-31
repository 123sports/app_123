import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { PasswordInput } from "@/components/PasswordInput";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/redefinir-senha")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [hasSession, setHasSession] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      setChecking(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
      setChecking(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      toast.error("As senhas não conferem.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success("Senha atualizada. Entre novamente.");
      navigate({ to: "/auth" });
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível atualizar a senha.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hero-bg flex min-h-screen items-center justify-center p-4">
      <Toaster />
      <main className="plane w-full max-w-md">
        <Logo className="mb-6 h-10" />
        <h1 className="type-h2">Redefinir senha</h1>
        {checking ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : !hasSession ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              Este link é inválido ou expirou. Solicite uma nova recuperação na tela de login.
            </p>
            <Link to="/auth" className="inline-flex text-sm font-semibold hover:underline">
              Voltar ao login
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1 block type-eyebrow">Nova senha</span>
              <PasswordInput
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full border border-input bg-background px-4 py-2.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block type-eyebrow">Confirmar nova senha</span>
              <PasswordInput
                required
                minLength={8}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="w-full border border-input bg-background px-4 py-2.5 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="btn-bounce min-h-11 w-full rounded-full bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-40"
            >
              {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Atualizar senha"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
