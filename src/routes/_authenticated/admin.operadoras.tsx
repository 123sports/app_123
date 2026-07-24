import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/operadoras")({
  component: AdminOperadoras,
});

function AdminOperadoras() {
  const [list, setList] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [fee, setFee] = useState("");

  const load = async () => {
    const { data } = await supabase.from("card_operators").select("*").order("name");
    setList(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name) return toast.error("Nome obrigatório");
    const { error } = await supabase.from("card_operators").insert({
      name, fee_percent: Number(fee.replace(",", ".")) || 0,
    });
    if (error) return toast.error(error?.message ?? "Não foi possível adicionar a operadora. Tente de novo.");
    setName(""); setFee(""); load();
    toast.success("Operadora adicionada");
  };

  const del = async (id: string) => {
    const { error } = await supabase.from("card_operators").delete().eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível remover a operadora. Tente de novo.");
    setList((l) => l.filter((o) => o.id !== id));
  };

  const toggle = async (id: string, active: boolean) => {
    await supabase.from("card_operators").update({ active }).eq("id", id);
    setList((l) => l.map((o) => o.id === id ? { ...o, active } : o));
  };

  const updateFee = async (id: string, fee_percent: number) => {
    await supabase.from("card_operators").update({ fee_percent }).eq("id", id);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin · Operadoras"
        title="Operadoras de cartão"
        subtitle="Cadastre as operadoras e suas taxas para cálculo correto."
      />

      <div className="plane">
        <div className="mb-4 grid gap-4 sm:grid-cols-[1fr_140px_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex: Cielo, Stone, PagBank)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <input value={fee} onChange={(e) => setFee(e.target.value)} placeholder="Taxa %" inputMode="decimal"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-right" />
          <button onClick={add} className="btn-bounce inline-flex items-center gap-1 rounded-full bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
            <Plus className="h-4 w-4" /> Adicionar
          </button>
        </div>
        <ul className="divide-y divide-border">
          {list.map((o) => (
            <li key={o.id} className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <div className="type-h3">{o.name}</div>
                <div className="type-small text-muted-foreground">Taxa: <span className="type-data">{o.fee_percent}%</span></div>
              </div>
              <input
                type="number" step="0.01" defaultValue={o.fee_percent}
                onBlur={(e) => updateFee(o.id, Number(e.currentTarget.value))}
                className="w-20 rounded-md border border-input bg-background px-2 py-1 text-right text-sm"
              />
              <button
                onClick={() => toggle(o.id, !o.active)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${o.active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {o.active ? "Ativa" : "Inativa"}
              </button>
              <button onClick={() => del(o.id)} className="btn-bounce text-destructive hover:opacity-70">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
          {list.length === 0 && <p className="py-6 text-center type-small text-muted-foreground">Nenhuma operadora.</p>}
        </ul>
      </div>
    </div>
  );
}
