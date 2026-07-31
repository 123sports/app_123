import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { playPop } from "@/lib/sfx";

type Terms = { id: string; version: string; title: string; content: string };

export function TermsGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [needsAccept, setNeedsAccept] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setLoading(false); return; }
      setUserId(u.user.id);
      const { data: t } = await (supabase as any)
        .from("platform_terms")
        .select("id, version, title, content")
        .eq("active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!t) { setLoading(false); return; }
      setTerms(t as Terms);
      const { data: acc } = await (supabase as any)
        .from("user_terms_acceptance")
        .select("id")
        .eq("user_id", u.user.id)
        .eq("terms_id", t.id)
        .maybeSingle();
      setNeedsAccept(!acc);
      setLoading(false);
    })();
  }, []);

  const accept = async () => {
    if (!terms || !userId || !checked) return;
    playPop();
    setSaving(true);
    const { error } = await (supabase as any)
      .from("user_terms_acceptance")
      .insert({ user_id: userId, terms_id: terms.id });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Termos aceitos. Obrigado!");
    setNeedsAccept(false);
  };

  if (loading) return <>{children}</>;
  if (!needsAccept || !terms) return <>{children}</>;

  return (
    <>
      {children}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 p-4 backdrop-blur">
        <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-border bg-card shadow-glow">
          <div className="flex items-center gap-3 border-b border-border p-5">
            <div className="rounded-full bg-primary/15 p-2 text-primary"><ShieldCheck className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold">{terms.title}</h2>
              <p className="text-xs text-muted-foreground">Versão {terms.version} · leia e aceite para continuar</p>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
              {terms.content}
            </div>
          </div>
          <div className="space-y-3 border-t border-border p-5">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span>Li e concordo com os termos acima.</span>
            </label>
            <button
              onClick={accept}
              disabled={!checked || saving}
              className="btn-bounce inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Aceitar e continuar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
