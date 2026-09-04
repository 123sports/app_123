import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { BouncingBall } from "@/components/BouncingBall";
import { Toaster } from "@/components/ui/sonner";
import { PasswordInput } from "@/components/PasswordInput";
import { TurnstileWidget, type TurnstileHandle } from "@/components/TurnstileWidget";
import {
  formatBrazilPhone,
  isValidPersonName,
  normalizeBrazilPhone,
  normalizePersonName,
} from "@/lib/contact";

export const Route = createFileRoute("/convite-equipe/$token")({
  component: ConvitePage,
});

function ConvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasAccount, setHasAccount] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", password: "" });
  const captchaSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? "";
  const captchaEnabled = Boolean(captchaSiteKey);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileHandle>(null);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).rpc("get_staff_invite_by_token", { _token: token });
      setInvite(Array.isArray(data) ? (data[0] ?? null) : data);
      setLoading(false);
    })();
  }, [token]);

  const accept = async () => {
    if (!invite) return;
    if (form.password.length < 6) return toast.error("A senha precisa ter pelo menos 6 caracteres");
    if (captchaEnabled && !captchaToken) return toast.error("Conclua a verificação de segurança.");
    const fullName = normalizePersonName(form.full_name);
    const phone = normalizeBrazilPhone(form.phone);
    if (!hasAccount && !isValidPersonName(fullName))
      return toast.error("Informe seu nome completo.");
    if (!hasAccount && !phone) return toast.error("Informe um WhatsApp válido com DDD.");
    setBusy(true);
    try {
      if (hasAccount) {
        const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
          email: invite.email,
          password: form.password,
          options: { captchaToken: captchaToken ?? undefined },
        });
        if (signInError) throw signInError;
        if (!signIn.user) throw new Error("Não foi possível identificar a conta.");
        const { error: acceptError } = await (supabase as any).rpc("accept_staff_invite", {
          _token: token,
        });
        if (acceptError) throw acceptError;
        toast.success("Convite aceito. Acesso de equipe liberado.");
        navigate({ to: "/admin" });
        return;
      }

      const { data: signed, error: signUpError } = await supabase.auth.signUp({
        email: invite.email,
        password: form.password,
        options: {
          captchaToken: captchaToken ?? undefined,
          data: {
            full_name: fullName,
            phone,
            staff_invite_token: token,
          },
        },
      });
      if (signUpError) throw signUpError;
      if (!signed.user?.identities?.length) {
        setHasAccount(true);
        throw new Error("Este e-mail já possui conta. Entre com a senha para aceitar o convite.");
      }

      if (signed.session) {
        toast.success("Conta de equipe criada.");
        navigate({ to: "/admin" });
      } else {
        toast.success("Conta criada. Entre assim que o acesso for liberado.");
        navigate({ to: "/auth" });
      }
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao aceitar convite");
    } finally {
      setBusy(false);
      setCaptchaToken(null);
      captchaRef.current?.reset();
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
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !invite || invite.status !== "pendente" || new Date(invite.expires_at) < new Date() ? (
          <div className="py-6 text-center">
            <p className="font-semibold">Convite inválido ou expirado.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Peça um novo convite ao administrador.
            </p>
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
            {!hasAccount ? (
              <>
                <div>
                  <label htmlFor="staff-invite-name" className="mb-1 block text-xs font-medium">
                    Seu nome completo
                  </label>
                  <input
                    id="staff-invite-name"
                    autoComplete="name"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="staff-invite-phone" className="mb-1 block text-xs font-medium">
                    WhatsApp com DDD
                  </label>
                  <input
                    id="staff-invite-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: formatBrazilPhone(e.target.value) })}
                    placeholder="(11) 99999-9999"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </>
            ) : null}
            <div>
              <label htmlFor="staff-invite-password" className="mb-1 block text-xs font-medium">
                Crie uma senha
              </label>
              <PasswordInput
                id="staff-invite-password"
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {captchaEnabled ? (
              <TurnstileWidget
                ref={captchaRef}
                siteKey={captchaSiteKey}
                onToken={setCaptchaToken}
              />
            ) : null}
            <button
              onClick={accept}
              disabled={busy}
              className="btn-bounce w-full rounded-full bg-primary py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : hasAccount ? (
                "Entrar e aceitar convite"
              ) : (
                "Aceitar e criar conta"
              )}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setHasAccount((current) => !current);
                setCaptchaToken(null);
                captchaRef.current?.reset();
              }}
              className="w-full text-center text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {hasAccount ? "Ainda não tenho conta" : "Já tenho uma conta"}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              O acesso de equipe será liberado automaticamente após o cadastro.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
