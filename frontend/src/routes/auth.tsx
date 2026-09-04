import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  LOCAL_DEV_EMAIL,
  LOCAL_DEV_PASSWORD,
  isLocalSupabaseMode,
  supabase,
} from "@/integrations/supabase/client";
import logoFullColor from "@/assets/brand/on-tennis-full-color.png";

import { BouncingBall } from "@/components/BouncingBall";
import { playPop } from "@/lib/sfx";
import { Toaster } from "@/components/ui/sonner";
import { destinationForRoles } from "@/lib/auth-routing";
import { friendlyAuthError } from "@/lib/auth-errors";
import {
  formatBrazilPhone,
  isValidPersonName,
  normalizeBrazilPhone,
  normalizePersonName,
} from "@/lib/contact";
import { PasswordInput } from "@/components/PasswordInput";
import { TurnstileWidget, type TurnstileHandle } from "@/components/TurnstileWidget";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — On Tennis" },
      { name: "description", content: "Acesse sua conta On Tennis para reservar quadras e aulas." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const isLocalAuth = isLocalSupabaseMode();
  const googleAuthEnabled = !isLocalAuth && import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true";
  const captchaSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? "";
  const captchaEnabled = !isLocalAuth && Boolean(captchaSiteKey);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(isLocalAuth ? LOCAL_DEV_EMAIL : "");
  const [password, setPassword] = useState(isLocalAuth ? LOCAL_DEV_PASSWORD : "");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileHandle>(null);

  const [referralCode, setReferralCode] = useState<string>("");

  useEffect(() => {
    // Capture ?ref=CODE from URL (and persist so it survives provider redirects)
    const params = new URLSearchParams(window.location.search);
    const ref = (params.get("ref") || sessionStorage.getItem("on_tennis_ref") || "")
      .trim()
      .toUpperCase();
    if (ref) {
      sessionStorage.setItem("on_tennis_ref", ref);
      setReferralCode(ref);
      setMode("signup");
    }
    // Allow ?mode=signup from external CTAs (e.g. landing page header)
    if (params.get("mode") === "signup") setMode("signup");
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.session.user.id);
      navigate({ to: destinationForRoles(roles ?? []) });
    });
  }, [navigate]);

  const requireCaptcha = () => {
    if (!captchaEnabled || captchaToken) return true;
    toast.error("Conclua a verificação de segurança.");
    return false;
  };

  const resetCaptcha = () => {
    setCaptchaToken(null);
    captchaRef.current?.reset();
  };

  const routeForUser = async (userId: string): Promise<"/admin" | "/app"> => {
    const { data: roles, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (error) throw error;
    return destinationForRoles(roles ?? []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    playPop();
    if (!requireCaptcha()) return;
    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      if (mode === "signup") {
        const normalizedName = normalizePersonName(fullName);
        const normalizedPhone = normalizeBrazilPhone(phone);
        if (!isValidPersonName(normalizedName)) {
          toast.error("Informe seu nome completo.");
          return;
        }
        if (!normalizedPhone) {
          toast.error("Informe um WhatsApp válido com DDD.");
          return;
        }
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            captchaToken: captchaToken ?? undefined,
            data: {
              full_name: normalizedName,
              phone: normalizedPhone,
              referral_code: referralCode || undefined,
            },
          },
        });
        if (error) throw error;
        if (!signUpData.session || !signUpData.user) {
          if (signUpData.user?.identities?.length === 0) {
            toast.error("Este e-mail já está cadastrado. Entre com sua senha.");
          } else {
            toast.error("Não foi possível liberar sua conta agora. Tente novamente.");
          }
          return;
        }
        toast.success("Conta criada. Você já pode reservar suas aulas.");
        navigate({ to: await routeForUser(signUpData.user.id) });
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
          options: { captchaToken: captchaToken ?? undefined },
        });
        if (error) throw error;
        navigate({ to: await routeForUser(data.user!.id) });
      }
    } catch (err: unknown) {
      toast.error(friendlyAuthError(err, mode));
    } finally {
      setLoading(false);
      resetCaptcha();
    }
  };

  const handleGoogle = async () => {
    playPop();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth`,
      },
    });
    if (error) toast.error("Não foi possível entrar com Google.");
  };

  const sendPasswordReset = async () => {
    if (!email.includes("@")) {
      toast.error("Informe o e-mail da conta.");
      return;
    }
    if (!requireCaptcha()) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/redefinir-senha`,
        captchaToken: captchaToken ?? undefined,
      });
      if (error) throw error;
      toast.success("Se a conta existir, enviaremos um link de recuperação.");
    } catch (error: unknown) {
      toast.error(friendlyAuthError(error, "recovery"));
    } finally {
      setLoading(false);
      resetCaptcha();
    }
  };

  return (
    <div className="hero-bg flex min-h-screen items-center justify-center px-4 py-12">
      <Toaster />

      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center">
          <img src={logoFullColor} alt="On Tennis" className="h-20 w-auto object-contain sm:h-24" />
        </Link>
        <div className="plane plane-hero overflow-hidden">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="type-h2">
              {mode === "signin" ? "Bem-vindo de volta" : "Crie sua conta"}
            </h1>
            <div className="-mt-4">
              <BouncingBall size={32} />
            </div>
          </div>

          {mode === "signup" ? (
            <p className="mb-5 text-sm text-muted-foreground">
              Cadastre-se como aluno para comprar planos e reservar suas aulas.
            </p>
          ) : null}

          {isLocalAuth ? (
            <div className="mb-5 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-xs text-foreground">
              <p className="font-bold">Login local</p>
              <p className="mt-1 text-muted-foreground">
                Use <span className="font-semibold text-foreground">{LOCAL_DEV_EMAIL}</span> /{" "}
                <span className="font-semibold text-foreground">{LOCAL_DEV_PASSWORD}</span>.
              </p>
            </div>
          ) : null}

          {googleAuthEnabled ? (
            <>
              <button
                onClick={handleGoogle}
                className="btn-bounce mb-4 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-secondary"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"
                  />
                </svg>
                Continuar com Google
              </button>

              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> ou e-mail{" "}
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-3">
            {referralCode && mode === "signup" && (
              <div className="border-l-2 border-primary px-3 py-1 text-xs text-primary">
                Você está se cadastrando pela indicação{" "}
                <span className="font-bold">{referralCode}</span>
              </div>
            )}
            {mode === "signup" && (
              <Field label="Nome completo">
                <input
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  maxLength={100}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={inputCls}
                />
              </Field>
            )}
            {mode === "signup" && (
              <Field label="WhatsApp com DDD">
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(formatBrazilPhone(e.target.value))}
                  placeholder="(11) 99999-9999"
                  className={inputCls}
                />
              </Field>
            )}
            <Field label="E-mail">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Senha">
              <PasswordInput
                name="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </Field>
            {captchaEnabled ? (
              <TurnstileWidget
                ref={captchaRef}
                siteKey={captchaSiteKey}
                onToken={setCaptchaToken}
              />
            ) : null}
            {mode === "signin" && !isLocalAuth ? (
              <button
                type="button"
                onClick={() => void sendPasswordReset()}
                disabled={loading}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Esqueci minha senha
              </button>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="btn-bounce mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-bold text-primary-foreground disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "signin" ? "Entrar" : "Criar conta"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" ? "Ainda não tem conta?" : "Já tem conta?"}{" "}
            <button
              onClick={() => {
                playPop();
                setMode(mode === "signin" ? "signup" : "signin");
                setPassword("");
                resetCaptcha();
              }}
              className="font-semibold text-foreground hover:text-primary"
            >
              {mode === "signin" ? "Cadastre-se" : "Entrar"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full border border-input bg-background px-4 py-2.5 text-sm font-medium outline-none focus:border-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block type-eyebrow">{label}</span>
      {children}
    </label>
  );
}
