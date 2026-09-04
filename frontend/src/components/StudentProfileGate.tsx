import { useEffect, useState } from "react";
import { Loader2, LogOut, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import logoFullColor from "@/assets/brand/on-tennis-full-color.png";
import { supabase } from "@/integrations/supabase/client";
import {
  formatBrazilPhone,
  isValidPersonName,
  normalizeBrazilPhone,
  normalizePersonName,
} from "@/lib/contact";
import { playPop } from "@/lib/sfx";

type GateState = "loading" | "complete" | "incomplete" | "error";

export function StudentProfileGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("loading");
  const [userId, setUserId] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setState("loading");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setState("error");
      return;
    }

    const id = authData.user.id;
    setUserId(id);
    const [{ data: roles, error: rolesError }, { data: profile, error: profileError }] =
      await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", id),
        supabase.from("profiles").select("full_name, phone").eq("id", id).maybeSingle(),
      ]);

    if (rolesError || profileError) {
      setState("error");
      return;
    }

    if ((roles ?? []).some((entry) => entry.role === "admin" || entry.role === "professor")) {
      setState("complete");
      return;
    }

    const name = profile?.full_name ?? "";
    const normalizedPhone = profile?.phone ?? "";
    setFullName(name);
    setPhone(formatBrazilPhone(normalizedPhone));
    setState(
      isValidPersonName(name) && Boolean(normalizeBrazilPhone(normalizedPhone))
        ? "complete"
        : "incomplete",
    );
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    playPop();
    const name = normalizePersonName(fullName);
    const normalizedPhone = normalizeBrazilPhone(phone);
    if (!isValidPersonName(name)) {
      toast.error("Informe seu nome completo.");
      return;
    }
    if (!normalizedPhone) {
      toast.error("Informe um WhatsApp válido com DDD.");
      return;
    }

    setSaving(true);
    const payload = { full_name: name, phone: normalizedPhone };
    const { data, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    setSaving(false);
    if (error || !data) {
      toast.error("Não foi possível salvar seus dados. Tente novamente.");
      return;
    }
    setState("complete");
    toast.success("Dados salvos.");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.assign("/auth");
  };

  if (state === "complete") return <>{children}</>;

  return (
    <div className="hero-bg flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <img
          src={logoFullColor}
          alt="On Tennis"
          className="mx-auto mb-6 h-20 w-auto object-contain"
        />
        <div className="plane plane-hero">
          {state === "loading" ? (
            <div
              className="flex min-h-48 items-center justify-center"
              aria-label="Carregando perfil"
            >
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : state === "error" ? (
            <div className="space-y-5 text-center">
              <h1 className="type-h2">Não foi possível abrir seu perfil</h1>
              <p className="text-sm text-muted-foreground">
                Verifique sua conexão e tente novamente.
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="btn-bounce min-h-11 w-full rounded-full bg-primary px-5 py-3 font-bold text-primary-foreground"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <form onSubmit={save} className="space-y-4">
              <div className="flex items-center gap-3">
                <UserRoundCheck className="h-7 w-7 text-primary" />
                <div>
                  <h1 className="type-h2">Complete seus dados</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    O professor usará seu WhatsApp somente para contato sobre as aulas.
                  </p>
                </div>
              </div>
              <Field label="Nome completo">
                <input
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  maxLength={100}
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className={inputClassName}
                />
              </Field>
              <Field label="WhatsApp com DDD">
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  value={phone}
                  onChange={(event) => setPhone(formatBrazilPhone(event.target.value))}
                  placeholder="(11) 99999-9999"
                  className={inputClassName}
                />
              </Field>
              <button
                type="submit"
                disabled={saving}
                className="btn-bounce flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 font-bold text-primary-foreground disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continuar
              </button>
            </form>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            className="mx-auto mt-5 flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" /> Sair da conta
          </button>
        </div>
      </div>
    </div>
  );
}

const inputClassName =
  "w-full border border-input bg-background px-4 py-2.5 text-sm font-medium outline-none focus:border-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block type-eyebrow">{label}</span>
      {children}
    </label>
  );
}
