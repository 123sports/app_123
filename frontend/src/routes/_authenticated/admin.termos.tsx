import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2, ScrollText, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { PageHeader } from "@/components/PageHeader";
import { useConfirmation } from "@/hooks/use-confirmation";

export const Route = createFileRoute("/_authenticated/admin/termos")({
  component: AdminTermosPage,
});

type Term = {
  id: string;
  version: string;
  title: string;
  content: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function AdminTermosPage() {
  const requestConfirmation = useConfirmation();
  const [items, setItems] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Term | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("platform_terms")
      .select("*")
      .order("created_at", { ascending: false });
    setItems((data ?? []) as Term[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (t: Term) => {
    playPop();
    if (!t.active) {
      // desativa os demais
      await (supabase as any).from("platform_terms").update({ active: false }).neq("id", t.id);
    }
    await (supabase as any).from("platform_terms").update({ active: !t.active }).eq("id", t.id);
    load();
  };

  const remove = async (t: Term) => {
    const confirmed = await requestConfirmation({
      title: "Remover esta versão?",
      description: `A versão “${t.version}” do termo será removida permanentemente.`,
      confirmLabel: "Remover versão",
      cancelLabel: "Manter versão",
      destructive: true,
    });
    if (!confirmed) return;
    playPop();
    const { error } = await (supabase as any).from("platform_terms").delete().eq("id", t.id);
    if (error) return toast.error(error?.message ?? "Não foi possível remover a versão. Tente de novo.");
    toast.success("Versão removida");
    load();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin · Termos"
        title={<span className="flex items-center gap-2"><ScrollText className="h-6 w-6 text-primary" /> Termo de Aceite</span>}
        subtitle="Cadastre versões do termo de uso. Quando uma versão está ativa, alunos precisam aceitar antes de usar a plataforma."
        actions={
          <button
            onClick={() => { playPop(); setEditing(null); setShowForm(true); }}
            className="btn-bounce inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> Nova versão
          </button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Nenhuma versão cadastrada ainda.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((t) => (
            <article key={t.id} className="plane">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="type-h3">{t.title}</h3>
                    <span className="rounded-full bg-secondary px-2 py-0.5 type-micro font-semibold type-data">v{t.version}</span>
                    {t.active && <span className="rounded-full bg-primary/15 px-2 py-0.5 type-micro font-semibold text-primary">ATIVA</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 type-small text-muted-foreground">{t.content}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => toggleActive(t)} className="btn-bounce inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs">
                    {t.active ? <><X className="h-3 w-3" /> Desativar</> : <><Check className="h-3 w-3" /> Ativar</>}
                  </button>
                  <button onClick={() => { setEditing(t); setShowForm(true); }} className="btn-bounce rounded-full border border-border bg-secondary px-3 py-1.5 text-xs">Editar</button>
                  <button onClick={() => remove(t)} className="btn-bounce inline-flex items-center gap-1 rounded-full border border-destructive/40 px-3 py-1.5 text-xs text-destructive"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {showForm && (
        <TermForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function TermForm({ initial, onClose, onSaved }: { initial: Term | null; onClose: () => void; onSaved: () => void }) {
  const [version, setVersion] = useState(initial?.version ?? "");
  const [title, setTitle] = useState(initial?.title ?? "Termos de Uso");
  const [content, setContent] = useState(initial?.content ?? "");
  const [active, setActive] = useState(initial?.active ?? false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!version.trim() || !title.trim() || !content.trim()) return toast.error("Preencha todos os campos.");
    playPop();
    setSaving(true);
    if (active && !initial?.active) {
      await (supabase as any).from("platform_terms").update({ active: false }).neq("id", initial?.id ?? "00000000-0000-0000-0000-000000000000");
    }
    const payload = { version: version.trim(), title: title.trim(), content: content.trim(), active };
    const { error } = initial
      ? await (supabase as any).from("platform_terms").update(payload).eq("id", initial.id)
      : await (supabase as any).from("platform_terms").insert(payload);
    setSaving(false);
    if (error) return toast.error(error?.message ?? "Não foi possível salvar a versão. Tente de novo.");
    toast.success(initial ? "Versão atualizada" : "Versão criada");
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-border bg-card p-6 sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="type-h3">{initial ? "Editar versão" : "Nova versão de termo"}</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="mb-1 block type-small font-medium text-muted-foreground">Versão *</span>
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Ex: 1.0" className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            </label>
            <label className="block"><span className="mb-1 block type-small font-medium text-muted-foreground">Título *</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block"><span className="mb-1 block type-small font-medium text-muted-foreground">Conteúdo do termo *</span>
            <textarea rows={14} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Redija aqui as regras, políticas de uso, LGPD, cancelamento etc." className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Definir como versão ativa (obriga todos os usuários a aceitarem)
          </label>
          <button onClick={save} disabled={saving} className="btn-bounce mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
