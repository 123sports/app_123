import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, ImageIcon, X, Save, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/loja")({
  component: AdminLojaPage,
});

type Item = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  category: string | null;
  condition: string;
  image_path: string | null;
  whatsapp: string | null;
  active: boolean;
  created_at: string;
  stock_quantity: number | null;
  track_stock: boolean;
};

const CATEGORIES = ["Raquete", "Bolinhas", "Vestuário", "Acessórios", "Calçados", "Cordas", "Outro"];

function AdminLojaPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Item | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("marketplace_items")
      .select("*")
      .order("created_at", { ascending: false });
    const list = (data ?? []) as Item[];
    setItems(list);
    const urls: Record<string, string> = {};
    await Promise.all(
      list.filter((i) => i.image_path).map(async (i) => {
        const { data: s } = await supabase.storage.from("marketplace").createSignedUrl(i.image_path!, 3600);
        if (s?.signedUrl) urls[i.id] = s.signedUrl;
      }),
    );
    setImgs(urls);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const remove = async (it: Item) => {
    if (!confirm(`Remover "${it.title}"?`)) return;
    playPop();
    if (it.image_path) await supabase.storage.from("marketplace").remove([it.image_path]);
    const { error } = await (supabase as any).from("marketplace_items").delete().eq("id", it.id);
    if (error) return toast.error("Erro ao remover");
    toast.success("Item removido");
    load();
  };

  const toggleActive = async (it: Item) => {
    playPop();
    await (supabase as any).from("marketplace_items").update({ active: !it.active }).eq("id", it.id);
    load();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin · Loja"
        title="Loja / Classificados"
        subtitle="Anuncie equipamentos e acessórios para seus alunos."
        actions={
          <button
            onClick={() => { playPop(); setEditing(null); setShowForm(true); }}
            className="btn-bounce inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> Novo item
          </button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <div className="plane plane-hero border-dashed text-center type-small text-muted-foreground">
          Nenhum item anunciado ainda.
        </div>
      ) : (
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <article key={it.id} className="flex h-full flex-col overflow-hidden bg-card/30">
              <div className="aspect-video bg-muted">
                {imgs[it.id] ? (
                  <img src={imgs[it.id]} alt={it.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-8 w-8" /></div>
                )}
              </div>
              <div className="flex-1 space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="type-h3">{it.title}</h3>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 type-micro font-semibold ${it.condition === "novo" ? "bg-primary/15 text-primary" : "bg-secondary text-foreground"}`}>
                    {it.condition === "novo" ? "Novo" : "Usado"}
                  </span>
                </div>
                {it.category && <p className="type-micro text-muted-foreground">{it.category}</p>}
                <p className="type-data text-lg font-bold text-primary">{(it.price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                {it.track_stock && (
                  <p className={`type-micro type-data font-medium ${(it.stock_quantity ?? 0) > 0 ? "text-muted-foreground" : "text-destructive"}`}>
                    Estoque: {it.stock_quantity ?? 0} un.
                  </p>
                )}
                {!it.active && <p className="type-micro font-medium text-muted-foreground">• Inativo</p>}
                <div className="flex flex-wrap gap-2 pt-2">
                  <button onClick={() => { setEditing(it); setShowForm(true); }} className="btn-bounce inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs"><Pencil className="h-3 w-3" /> Editar</button>
                  <button onClick={() => toggleActive(it)} className="btn-bounce rounded-full border border-border bg-secondary px-3 py-1.5 text-xs">{it.active ? "Desativar" : "Ativar"}</button>
                  <button onClick={() => remove(it)} className="btn-bounce inline-flex items-center gap-1 rounded-full border border-destructive/40 px-3 py-1.5 text-xs text-destructive"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {showForm && (
        <ItemForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ItemForm({ initial, onClose, onSaved }: { initial: Item | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(initial ? (initial.price_cents / 100).toFixed(2).replace(".", ",") : "");
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
  const [condition, setCondition] = useState(initial?.condition ?? "novo");
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [trackStock, setTrackStock] = useState(initial?.track_stock ?? false);
  const [stock, setStock] = useState(initial?.stock_quantity != null ? String(initial.stock_quantity) : "0");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return toast.error("Informe o título");
    const cents = Math.round(parseFloat(price.replace(",", ".") || "0") * 100);
    if (!cents || cents < 0) return toast.error("Informe um preço válido");
    playPop();
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setSaving(false); return; }

    let image_path = initial?.image_path ?? null;
    if (file) {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${u.user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("marketplace").upload(path, file, { upsert: false });
      if (upErr) { setSaving(false); return toast.error("Falha ao enviar imagem"); }
      if (initial?.image_path) await supabase.storage.from("marketplace").remove([initial.image_path]);
      image_path = path;
    }

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      price_cents: cents,
      category,
      condition,
      whatsapp: whatsapp.replace(/[^\d+]/g, "") || null,
      active,
      image_path,
      created_by: u.user.id,
      track_stock: trackStock,
      stock_quantity: trackStock ? Math.max(0, parseInt(stock || "0", 10)) : null,
    };

    const { error } = initial
      ? await (supabase as any).from("marketplace_items").update(payload).eq("id", initial.id)
      : await (supabase as any).from("marketplace_items").insert(payload);

    setSaving(false);
    if (error) return toast.error("Erro ao salvar");
    toast.success(initial ? "Item atualizado" : "Item publicado");
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-card p-6 sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="type-h3">{initial ? "Editar item" : "Novo item"}</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <Field label="Título"><input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Ex.: Raquete Wilson Pro Staff" /></Field>
          <Field label="Descrição">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input" placeholder="Detalhes, estado de conservação, peso..." />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preço (R$)"><input value={price} onChange={(e) => setPrice(e.target.value)} className="input" placeholder="0,00" inputMode="decimal" /></Field>
            <Field label="Condição">
              <select value={condition} onChange={(e) => setCondition(e.target.value)} className="input">
                <option value="novo">Novo</option>
                <option value="usado">Usado</option>
              </select>
            </Field>
          </div>
          <Field label="Categoria">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label={<span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" /> WhatsApp para contato (opcional)</span>}>
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="input" placeholder="5551999999999" />
          </Field>
          <Field label="Imagem">
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Ativo (visível para os alunos)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} /> Controlar estoque
          </label>
          {trackStock && (
            <Field label="Quantidade em estoque">
              <input value={stock} onChange={(e) => setStock(e.target.value.replace(/[^\d]/g, ""))} className="input" inputMode="numeric" placeholder="0" />
            </Field>
          )}
          <button onClick={save} disabled={saving} className="btn-bounce mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
          </button>
        </div>
        <style>{`.input{width:100%;border-radius:0.75rem;border:1px solid hsl(var(--input));background:hsl(var(--background));padding:0.625rem 0.75rem;font-size:0.875rem;}`}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
