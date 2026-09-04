import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useConfirmation } from "@/hooks/use-confirmation";

// "Dados dos Coaches" foi unificado dentro de "Equipe" (aba). A rota antiga
// redireciona para manter links/bookmarks funcionando.
export const Route = createFileRoute("/_authenticated/admin/coach-perfis")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/equipe" });
  },
});

type Coach = {
  user_id: string;
  display_name: string;
  cpf_cnpj: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  venue_name: string | null;
  venue_address: string | null;
  is_default: boolean;
  active: boolean;
};

type StaffOption = { id: string; full_name: string | null; email: string };

export function CoachProfilesPanel() {
  const requestConfirmation = useConfirmation();
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [editing, setEditing] = useState<Coach | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: cs } = await supabase.from("coach_profiles").select("*").order("is_default", { ascending: false });
    setCoaches((cs as any) ?? []);
    // staff candidates: admins + professores
    const { data: roles } = await supabase.from("user_roles").select("user_id, role").in("role", ["admin", "professor"] as any);
    const ids = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      // Email não vem do profiles (auth) — usamos full_name + id curto
      const map: StaffOption[] = (profs ?? []).map((p: any) => ({ id: p.id, full_name: p.full_name, email: p.id.slice(0, 8) }));
      setStaff(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const newCoach = (): Coach => ({
    user_id: "",
    display_name: "",
    cpf_cnpj: "",
    email: "",
    phone: "",
    address: "",
    venue_name: "",
    venue_address: "",
    is_default: coaches.length === 0,
    active: true,
  });

  const save = async (c: Coach) => {
    if (!c.user_id) { toast.error("Selecione o usuário (coach)."); return; }
    if (!c.display_name) { toast.error("Informe o nome/razão social."); return; }
    try {
      // Se marcar como padrão, desmarca os demais primeiro
      if (c.is_default) {
        await supabase.from("coach_profiles").update({ is_default: false }).neq("user_id", c.user_id);
      }
      const { error } = await supabase.from("coach_profiles").upsert({
        user_id: c.user_id,
        display_name: c.display_name,
        cpf_cnpj: c.cpf_cnpj || null,
        email: c.email || null,
        phone: c.phone || null,
        address: c.address || null,
        venue_name: c.venue_name || null,
        venue_address: c.venue_address || null,
        is_default: c.is_default,
        active: c.active,
      } as any);
      if (error) throw error;
      toast.success("Ficha do coach salva.");
      setEditing(null);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar a ficha do coach. Tente de novo.");
    }
  };

  const remove = async (user_id: string) => {
    const confirmed = await requestConfirmation({
      title: "Excluir esta ficha?",
      description: "Os dados profissionais deste coach serão removidos desta área.",
      confirmLabel: "Excluir ficha",
      cancelLabel: "Manter ficha",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await supabase.from("coach_profiles").delete().eq("user_id", user_id);
    if (error) toast.error(error?.message ?? "Não foi possível excluir a ficha. Tente de novo.");
    else { toast.success("Excluído"); load(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-small max-w-2xl text-muted-foreground">
          As fichas aqui cadastradas preenchem automaticamente os contratos de aulas (CONTRATADO + LOCAL).
          Defina um coach como padrão para novos contratos.
        </p>
        <Button onClick={() => setEditing(newCoach())}>
          <Plus className="h-4 w-4" /> Nova ficha
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : coaches.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nenhum coach cadastrado. Clique em "Nova ficha" para começar.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 auto-rows-fr">
          {coaches.map((c) => (
            <Card key={c.user_id} className="h-full">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {c.display_name}
                      {c.is_default && <Star className="h-4 w-4 fill-yellow-400 text-yellow-500" />}
                    </CardTitle>
                    <CardDescription>{c.cpf_cnpj ?? "—"} · {c.venue_name ?? "—"}</CardDescription>
                  </div>
                  <span className={`type-micro type-eyebrow rounded-full px-2 py-0.5 ${c.active ? "bg-green-500/20 text-green-700 dark:text-green-300" : "bg-muted text-muted-foreground"}`}>
                    {c.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 type-small text-muted-foreground">
                <div>{c.email ?? "sem e-mail"} · {c.phone ?? "sem telefone"}</div>
                <div className="type-micro">{c.address ?? "sem endereço"}</div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(c)}>Editar</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(c.user_id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <CoachEditor
          coach={editing}
          staff={staff}
          existingIds={coaches.map((c) => c.user_id)}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function CoachEditor({ coach, staff, existingIds, onClose, onSave }: {
  coach: Coach;
  staff: StaffOption[];
  existingIds: string[];
  onClose: () => void;
  onSave: (c: Coach) => void;
}) {
  const [c, setC] = useState<Coach>(coach);
  const isNew = !existingIds.includes(coach.user_id);
  const upd = <K extends keyof Coach>(k: K, v: Coach[K]) => setC((s) => ({ ...s, [k]: v }));

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">{isNew ? "Nova ficha de coach" : `Editando ${c.display_name}`}</CardTitle>
        <CardDescription>Preencha os dados que vão aparecer no contrato.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {isNew ? (
          <div className="md:col-span-2">
            <Label>Usuário (admin/professor)</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={c.user_id}
              onChange={(e) => upd("user_id", e.target.value)}
            >
              <option value="">Selecione…</option>
              {staff.filter((s) => !existingIds.includes(s.id)).map((s) => (
                <option key={s.id} value={s.id}>{s.full_name ?? "(sem nome)"} · {s.email}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Apenas usuários com papel admin ou professor aparecem aqui.</p>
          </div>
        ) : null}
        <div>
          <Label>Nome / Razão social *</Label>
          <Input value={c.display_name} onChange={(e) => upd("display_name", e.target.value)} />
        </div>
        <div>
          <Label>CPF ou CNPJ</Label>
          <Input value={c.cpf_cnpj ?? ""} onChange={(e) => upd("cpf_cnpj", e.target.value)} />
        </div>
        <div>
          <Label>E-mail profissional</Label>
          <Input type="email" value={c.email ?? ""} onChange={(e) => upd("email", e.target.value)} />
        </div>
        <div>
          <Label>Telefone</Label>
          <Input value={c.phone ?? ""} onChange={(e) => upd("phone", e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Endereço profissional</Label>
          <Input value={c.address ?? ""} onChange={(e) => upd("address", e.target.value)} />
        </div>
        <div>
          <Label>Nome do espaço/quadra/clube</Label>
          <Input value={c.venue_name ?? ""} onChange={(e) => upd("venue_name", e.target.value)} />
        </div>
        <div>
          <Label>Endereço do espaço</Label>
          <Input value={c.venue_address ?? ""} onChange={(e) => upd("venue_address", e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={c.is_default} onCheckedChange={(v) => upd("is_default", v)} id="def" />
          <Label htmlFor="def" className="cursor-pointer">Usar como padrão nos contratos</Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={c.active} onCheckedChange={(v) => upd("active", v)} id="act" />
          <Label htmlFor="act" className="cursor-pointer">Ficha ativa</Label>
        </div>

        <div className="md:col-span-2 flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSave(c)}><Save className="h-4 w-4" /> Salvar</Button>
        </div>
      </CardContent>
    </Card>
  );
}
