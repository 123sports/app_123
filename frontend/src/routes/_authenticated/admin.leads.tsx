import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Phone, MapPin, MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useConfirmation } from "@/hooks/use-confirmation";

export const Route = createFileRoute("/_authenticated/admin/leads")({
  component: AdminLeads,
});

type Lead = {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  message: string | null;
  status: string;
  created_at: string;
};

const STATUSES = ["novo", "em_contato", "convertido", "descartado"];

function AdminLeads() {
  const requestConfirmation = useConfirmation();
  const [rows, setRows] = useState<Lead[]>([]);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    const { data, error } = await (supabase as any)
      .from("leads")
      .select("id, name, phone, city, message, status, created_at")
      .order("created_at", { ascending: false });
    if (error) return toast.error(error?.message ?? "Não foi possível carregar os leads. Tente de novo.");
    setRows((data ?? []) as Lead[]);
  };
  useEffect(() => { load(); }, []);

  const update = async (id: string, patch: Partial<Lead>) => {
    const { error } = await (supabase as any).from("leads").update(patch).eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível atualizar o lead. Tente de novo.");
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    toast.success("Lead atualizado");
  };

  const remove = async (id: string) => {
    const confirmed = await requestConfirmation({
      title: "Excluir este contato?",
      description: "Os dados deste possível aluno serão removidos permanentemente.",
      confirmLabel: "Excluir contato",
      cancelLabel: "Manter contato",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await (supabase as any).from("leads").delete().eq("id", id);
    if (error) return toast.error(error?.message ?? "Não foi possível excluir o lead. Tente de novo.");
    setRows((rs) => rs.filter((r) => r.id !== id));
    toast.success("Lead excluído");
  };

  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin · Leads"
        title="Leads"
        subtitle="Pré-cadastros recebidos pela landing page."
        actions={
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-full border border-input bg-background px-3 py-1.5 text-sm"
          >
            <option value="all">Todos status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        }
      />

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          Nenhum lead ainda.
        </div>
      ) : (
        <div className="grid auto-rows-fr gap-4 md:grid-cols-2">
          {filtered.map((l) => (
            <div key={l.id} className="plane h-full">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="type-h3">{l.name}</div>
                  <div className="type-micro text-muted-foreground type-data">
                    {format(new Date(l.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </div>
                </div>
                <button
                  onClick={() => remove(l.id)}
                  className="rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Excluir"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <a href={`tel:${l.phone}`} className="flex items-center gap-2 hover:text-primary">
                  <Phone className="h-4 w-4 text-muted-foreground" /> {l.phone}
                </a>
                {l.city && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" /> {l.city}
                  </div>
                )}
                {l.message && (
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{l.message}</span>
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <select
                  value={l.status}
                  onChange={(e) => update(l.id, { status: e.target.value })}
                  className="flex-1 rounded-full border border-input bg-background px-3 py-1.5 text-sm"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <a
                  href={`https://wa.me/${l.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-bounce rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  WhatsApp
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
