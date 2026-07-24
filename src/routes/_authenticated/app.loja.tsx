import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, ImageIcon, MessageCircle, X, ShoppingCart, Plus, Minus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/app/loja")({
  component: AlunoLojaPage,
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
  stock_quantity: number | null;
  track_stock: boolean;
};

type CartLine = { id: string; qty: number };

const CART_KEY = "ontennis_cart_v1";

function loadCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch { return []; }
}
function saveCart(lines: CartLine[]) {
  if (typeof window !== "undefined") localStorage.setItem(CART_KEY, JSON.stringify(lines));
}

function AlunoLojaPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("todos");
  const [open, setOpen] = useState<Item | null>(null);
  const [defaultWhats, setDefaultWhats] = useState<string>("");
  const [cart, setCart] = useState<CartLine[]>(loadCart());
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => { saveCart(cart); }, [cart]);

  useEffect(() => {
    (async () => {
      const [{ data }, { data: cfg }] = await Promise.all([
        (supabase as any).from("marketplace_items").select("*").eq("active", true).order("created_at", { ascending: false }),
        (supabase as any).from("site_settings").select("value").eq("key", "whatsapp_number").maybeSingle(),
      ]);
      const list = (data ?? []) as Item[];
      setItems(list);
      setDefaultWhats(cfg?.value ?? "");
      const urls: Record<string, string> = {};
      await Promise.all(list.filter((i) => i.image_path).map(async (i) => {
        const { data: s } = await supabase.storage.from("marketplace").createSignedUrl(i.image_path!, 3600);
        if (s?.signedUrl) urls[i.id] = s.signedUrl;
      }));
      setImgs(urls);
      setLoading(false);
    })();
  }, []);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean) as string[]));
  const visible = filter === "todos" ? items : items.filter((i) => i.category === filter);
  const cartCount = cart.reduce((n, l) => n + l.qty, 0);

  const addToCart = (item: Item) => {
    playPop();
    const outOfStock = item.track_stock && (item.stock_quantity ?? 0) <= 0;
    if (outOfStock) { toast.error("Produto sem estoque"); return; }
    setCart((prev) => {
      const existing = prev.find((l) => l.id === item.id);
      const currentQty = existing?.qty ?? 0;
      if (item.track_stock && currentQty + 1 > (item.stock_quantity ?? 0)) {
        toast.error(`Só temos ${item.stock_quantity} un. em estoque`);
        return prev;
      }
      if (existing) return prev.map((l) => l.id === item.id ? { ...l, qty: l.qty + 1 } : l);
      return [...prev, { id: item.id, qty: 1 }];
    });
    toast.success("Adicionado ao carrinho");
  };

  const updateQty = (id: string, delta: number) => {
    playPop();
    setCart((prev) => {
      return prev.flatMap((l) => {
        if (l.id !== id) return [l];
        const item = itemMap.get(id);
        const newQty = l.qty + delta;
        if (newQty <= 0) return [];
        if (item?.track_stock && newQty > (item.stock_quantity ?? 0)) {
          toast.error(`Só temos ${item.stock_quantity} un. em estoque`);
          return [l];
        }
        return [{ ...l, qty: newQty }];
      });
    });
  };

  const removeLine = (id: string) => { playPop(); setCart((prev) => prev.filter((l) => l.id !== id)); };
  const clearCart = () => { playPop(); setCart([]); };

  return (
    <div className="stack-app">
      <PageHeader
        eyebrow="Loja"
        title="Loja"
        subtitle="Equipamentos e acessórios anunciados pelo seu professor."
        actions={
          <button
            onClick={() => { playPop(); setCartOpen(true); }}
            className="btn-bounce relative inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent"
          >
            <ShoppingCart className="h-4 w-4" /> Carrinho
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1 type-micro type-data font-bold text-primary-foreground">
                {cartCount}
              </span>
            )}
          </button>
        }
      />

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <FilterPill active={filter === "todos"} onClick={() => setFilter("todos")}>Todos</FilterPill>
          {categories.map((c) => (
            <FilterPill key={c} active={filter === c} onClick={() => setFilter(c)}>{c}</FilterPill>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center type-small text-muted-foreground">
          Ainda não há itens anunciados.
        </div>
      ) : (
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((it) => {
            const soldOut = it.track_stock && (it.stock_quantity ?? 0) <= 0;
            return (
              <article key={it.id} className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-left transition hover:border-primary">
                <button type="button" onClick={() => { playPop(); setOpen(it); }} className="btn-bounce flex-1 w-full text-left">
                  <div className="aspect-video bg-muted">
                    {imgs[it.id] ? (
                      <img src={imgs[it.id]} alt={it.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-8 w-8" /></div>
                    )}
                  </div>
                  <div className="space-y-1 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="type-h3 leading-tight">{it.title}</h3>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 type-micro font-semibold ${it.condition === "novo" ? "bg-primary/15 text-primary" : "bg-secondary text-foreground"}`}>
                        {it.condition === "novo" ? "Novo" : "Usado"}
                      </span>
                    </div>
                    {it.category && <p className="type-small text-muted-foreground">{it.category}</p>}
                    <p className="pt-1 text-lg font-bold text-primary type-data">{(it.price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                    {it.track_stock && (
                      <p className={`type-small type-data ${soldOut ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {soldOut ? "Sem estoque" : `${it.stock_quantity} em estoque`}
                      </p>
                    )}
                  </div>
                </button>
                <div className="border-t border-border p-3">
                  <button
                    onClick={() => addToCart(it)}
                    disabled={soldOut}
                    className="btn-bounce inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Adicionar ao carrinho
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {open && (
        <ItemModal
          item={open}
          img={imgs[open.id]}
          defaultWhats={defaultWhats}
          onClose={() => setOpen(null)}
          onAddToCart={() => { addToCart(open); setOpen(null); }}
        />
      )}

      {cartOpen && (
        <CartDrawer
          cart={cart}
          itemMap={itemMap}
          imgs={imgs}
          defaultWhats={defaultWhats}
          onClose={() => setCartOpen(false)}
          onQty={updateQty}
          onRemove={removeLine}
          onClear={clearCart}
        />
      )}
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={() => { playPop(); onClick(); }} className={`btn-bounce rounded-full border px-4 py-1.5 text-xs font-medium ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-secondary"}`}>
      {children}
    </button>
  );
}

function ItemModal({ item, img, defaultWhats, onClose, onAddToCart }: { item: Item; img?: string; defaultWhats: string; onClose: () => void; onAddToCart: () => void }) {
  const phone = item.whatsapp || defaultWhats;
  const msg = encodeURIComponent(`Olá! Tenho interesse no item "${item.title}" anunciado na loja.`);
  const link = phone ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${msg}` : null;
  const soldOut = item.track_stock && (item.stock_quantity ?? 0) <= 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-card sm:rounded-3xl">
        <div className="relative">
          <div className="aspect-video bg-muted">
            {img ? <img src={img} alt={item.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-10 w-10" /></div>}
          </div>
          <button onClick={onClose} className="absolute right-3 top-3 rounded-full bg-background/80 p-2 hover:bg-background"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="type-h2">{item.title}</h2>
            <span className={`shrink-0 rounded-full px-2 py-0.5 type-micro font-semibold ${item.condition === "novo" ? "bg-primary/15 text-primary" : "bg-secondary text-foreground"}`}>
              {item.condition === "novo" ? "Novo" : "Usado"}
            </span>
          </div>
          {item.category && <p className="type-small text-muted-foreground">{item.category}</p>}
          <p className="text-2xl font-bold text-primary type-data">{(item.price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          {item.track_stock && (
            <p className={`type-small type-data ${soldOut ? "text-destructive font-medium" : "text-muted-foreground"}`}>
              {soldOut ? "Sem estoque" : `${item.stock_quantity} un. em estoque`}
            </p>
          )}
          {item.description && <p className="whitespace-pre-line type-small text-muted-foreground">{item.description}</p>}
          <button
            onClick={onAddToCart}
            disabled={soldOut}
            className="btn-bounce inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Adicionar ao carrinho
          </button>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => playPop()} className="btn-bounce inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#25D366] px-5 py-3 text-sm font-semibold text-[#25D366]">
              <MessageCircle className="h-4 w-4" /> Tirar dúvidas no WhatsApp
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function CartDrawer({ cart, itemMap, imgs, defaultWhats, onClose, onQty, onRemove, onClear }: {
  cart: CartLine[];
  itemMap: Map<string, Item>;
  imgs: Record<string, string>;
  defaultWhats: string;
  onClose: () => void;
  onQty: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const lines = cart
    .map((l) => ({ line: l, item: itemMap.get(l.id) }))
    .filter((x): x is { line: CartLine; item: Item } => !!x.item);
  const total = lines.reduce((sum, x) => sum + x.item.price_cents * x.line.qty, 0);

  const checkout = () => {
    if (lines.length === 0) return;
    const phone = defaultWhats;
    if (!phone) { toast.error("WhatsApp da loja não configurado"); return; }
    const body = [
      "Olá! Gostaria de finalizar essa compra na loja On Tennis:",
      "",
      ...lines.map((x) => `• ${x.line.qty}x ${x.item.title} — ${((x.item.price_cents * x.line.qty) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`),
      "",
      `Total: ${(total / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
    ].join("\n");
    const link = `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(body)}`;
    playPop();
    window.open(link, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/80 backdrop-blur" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-md flex-col border-l border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="flex items-center gap-2 type-h3"><ShoppingCart className="h-5 w-5 text-primary" /> Seu carrinho</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {lines.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center type-small text-muted-foreground">
              Seu carrinho está vazio.
            </div>
          ) : (
            <ul className="space-y-3">
              {lines.map(({ line, item }) => (
                <li key={item.id} className="flex gap-3 rounded-2xl border border-border bg-secondary p-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {imgs[item.id] ? (
                      <img src={imgs[item.id]} alt={item.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate type-small font-semibold">{item.title}</div>
                    <div className="type-small type-data text-primary font-bold">
                      {(item.price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => onQty(item.id, -1)} className="rounded-full border border-border p-1 hover:bg-accent"><Minus className="h-3 w-3" /></button>
                      <span className="min-w-[24px] text-center type-small type-data font-semibold">{line.qty}</span>
                      <button onClick={() => onQty(item.id, +1)} className="rounded-full border border-border p-1 hover:bg-accent"><Plus className="h-3 w-3" /></button>
                      <button onClick={() => onRemove(item.id)} className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length > 0 && (
          <div className="space-y-3 border-t border-border p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="text-xl font-bold text-primary type-data">
                {(total / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </span>
            </div>
            <button
              onClick={checkout}
              className="btn-bounce inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-semibold text-white"
            >
              <MessageCircle className="h-4 w-4" /> Finalizar no WhatsApp
            </button>
            <button onClick={onClear} className="w-full text-center type-small text-muted-foreground hover:text-destructive">
              Esvaziar carrinho
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
