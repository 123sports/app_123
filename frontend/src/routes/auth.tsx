import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  LOCAL_DEV_EMAIL,
  LOCAL_DEV_PASSWORD,
  isLocalSupabaseMode,
  supabase,
} from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import logoFullColor from "@/assets/brand/on-tennis-full-color.png";

import { BouncingBall } from "@/components/BouncingBall";
import { playPop } from "@/lib/sfx";
import { Toaster } from "@/components/ui/sonner";
import { setAudience as persistAudience, type Audience as PersistAudience } from "@/lib/session-audience";
import { PasswordInput } from "@/components/PasswordInput";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — On Tennis" },
      { name: "description", content: "Acesse sua conta On Tennis para reservar quadras e aulas." },
    ],
  }),
  component: AuthPage,
});

type Audience = "aluno" | "equipe";

function AuthPage() {
  const navigate = useNavigate();
  const isLocalAuth = isLocalSupabaseMode();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [audience, setAudience] = useState<Audience>("aluno");
  const [email, setEmail] = useState(isLocalAuth ? LOCAL_DEV_EMAIL : "");
  const [password, setPassword] = useState(isLocalAuth ? LOCAL_DEV_PASSWORD : "");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  const [referralCode, setReferralCode] = useState<string>("");

  useEffect(() => {
    if (mode === "signup" && audience !== "aluno") setAudience("aluno");
  }, [mode, audience]);


  useEffect(() => {
    // Capture ?ref=CODE from URL (and persist so it survives provider redirects)
    const params = new URLSearchParams(window.location.search);
    const ref = (params.get("ref") || sessionStorage.getItem("on_tennis_ref") || "").trim().toUpperCase();
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
      const isStaff = roles?.some((r) => r.role === "admin" || r.role === "professor");
      navigate({ to: isStaff ? "/admin" : "/app" });
    });
  }, [navigate]);

  const routeForUser = async (userId: string): Promise<{ ok: boolean; to: "/admin" | "/app"; msg?: string }> => {
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isStaff = roles?.some((r) => r.role === "admin" || r.role === "professor") ?? false;
    if (audience === "equipe" && !isStaff) {
      return { ok: false, to: "/app", msg: "Esta conta não tem acesso de professor/administrador." };
    }
    if (audience === "aluno" && isStaff) {
      // Equipe pode escolher entrar como aluno — respeitamos a escolha
      return { ok: true, to: "/app" };
    }
    return { ok: true, to: isStaff ? "/admin" : "/app" };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    playPop();
    setLoading(true);
    try {
      if (mode === "signup") {
        if (audience === "equipe") {
          toast.error("Cadastro de equipe é feito apenas por convite do administrador.");
          return;
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/app`,
            data: { full_name: fullName, referral_code: referralCode || undefined },
          },
        });
        if (error) throw error;
        toast.success("Conta criada! Você já pode entrar.");
        setMode("signin");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const result = await routeForUser(data.user!.id);
        if (!result.ok) {
          await supabase.auth.signOut();
          toast.error(result.msg ?? "Acesso negado.");
          return;
        }
        persistAudience(audience as PersistAudience);
        navigate({ to: result.to });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    playPop();
    persistAudience(audience as PersistAudience);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/${audience === "equipe" ? "admin" : "app"}`,
    });
    if (result.error) toast.error("Não foi possível entrar com Google.");
  };

  return (
    <div className="hero-bg flex min-h-screen items-center justify-center px-4 py-12">
      <Toaster />
      
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center">
          <img
            src={logoFullColor}
            alt="On Tennis"
            className="h-20 w-auto object-contain sm:h-24"
          />
        </Link>
        <div className="plane plane-hero">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="type-h2">{mode === "signin" ? "Bem-vindo de volta" : "Crie sua conta"}</h1>
            <div className="-mt-4"><BouncingBall size={32} /></div>
          </div>

          {mode === "signin" ? (
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-full border border-border bg-background p-1">
              {(["aluno", "equipe"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => { playPop(); setAudience(opt); }}
                  className={`rounded-full px-3 py-2 text-xs font-bold transition ${
                    audience === opt
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt === "aluno" ? "Sou aluno" : "Professor / Admin"}
                </button>
              ))}
            </div>
          ) : (
            <div className="mb-5 rounded-2xl border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
              Cadastro disponível apenas para <span className="font-semibold text-foreground">alunos</span>. Professores e equipe entram somente por convite do administrador.
            </div>
          )}

          {isLocalAuth ? (
            <div className="mb-5 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-xs text-foreground">
              <p className="font-bold">Login local</p>
              <p className="mt-1 text-muted-foreground">
                Use <span className="font-semibold text-foreground">{LOCAL_DEV_EMAIL}</span> /{" "}
                <span className="font-semibold text-foreground">{LOCAL_DEV_PASSWORD}</span>. O mesmo login entra como aluno ou equipe.
              </p>
            </div>
          ) : null}

          <button
            onClick={handleGoogle}
            className="btn-bounce mb-4 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-secondary"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/>
            </svg>
            Continuar com Google
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> ou e-mail <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {referralCode && mode === "signup" && (
              <div className="rounded-xl border border-primary bg-primary/10 px-3 py-2 text-xs text-primary">
                🎉 Você está se cadastrando pela indicação <span className="font-bold">{referralCode}</span>
              </div>
            )}
            {mode === "signup" && (
              <Field label="Nome completo">
                <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
              </Field>
            )}
            <Field label="E-mail">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Senha">
              <PasswordInput required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            </Field>
            <button
              type="submit"
              disabled={loading}
              className="btn-bounce mt-2 min-h-11 w-full rounded-full bg-primary py-3 font-bold text-primary-foreground disabled:opacity-40"
            >
              {loading ? "..." : mode === "signin" ? "Entrar" : "Criar conta"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" ? "Ainda não tem conta?" : "Já tem conta?"}{" "}
            <button
              onClick={() => { playPop(); setMode(mode === "signin" ? "signup" : "signin"); }}
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

const inputCls = "w-full border border-input bg-background px-4 py-2.5 text-sm font-medium outline-none focus:border-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block type-eyebrow">{label}</span>
      {children}
    </label>
  );
}
