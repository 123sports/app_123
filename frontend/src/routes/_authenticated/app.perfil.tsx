import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Image as ImageIcon, Trophy, Target, GraduationCap, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/app/perfil")({
  component: Perfil,
});

type Profile = {
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  birth_date: string | null;
  blood_type: string | null;
  years_playing: number | null;
  skill_level: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_notes: string | null;
  bio: string | null;
  dominant_hand: string | null;
  games_won: number;
  aces: number;
  cpf: string | null;
  address: string | null;
  guardian_name: string | null;
  guardian_cpf: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
};

const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Não sei"];
const LEVELS = ["Iniciante", "Intermediário", "Avançado", "Competitivo"];
const HANDS = ["Destro", "Canhoto", "Ambidestro"];

function Perfil() {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [p, setP] = useState<Profile>({
    full_name: "", avatar_url: null, phone: "", birth_date: "", blood_type: "",
    years_playing: null, skill_level: "", emergency_contact_name: "",
    emergency_contact_phone: "", medical_notes: "", bio: "",
    dominant_hand: "", games_won: 0, aces: 0,
    cpf: "", address: "", guardian_name: "", guardian_cpf: "", guardian_email: "", guardian_phone: "",
  });
  const [aulasFeitas, setAulasFeitas] = useState(0);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setUserId(u.user.id);
      setEmail(u.user.email ?? "");
      const { data } = await supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
      if (data) {
        setP({
          full_name: data.full_name, avatar_url: data.avatar_url,
          phone: data.phone, birth_date: data.birth_date,
          blood_type: data.blood_type, years_playing: data.years_playing,
          skill_level: data.skill_level, emergency_contact_name: data.emergency_contact_name,
          emergency_contact_phone: data.emergency_contact_phone, medical_notes: data.medical_notes,
          bio: data.bio,
          dominant_hand: (data as any).dominant_hand ?? "",
          games_won: (data as any).games_won ?? 0,
          aces: (data as any).aces ?? 0,
          cpf: (data as any).cpf ?? "",
          address: (data as any).address ?? "",
          guardian_name: (data as any).guardian_name ?? "",
          guardian_cpf: (data as any).guardian_cpf ?? "",
          guardian_email: (data as any).guardian_email ?? "",
          guardian_phone: (data as any).guardian_phone ?? "",
        });
        if (data.avatar_url) {
          const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(data.avatar_url, 3600);
          setAvatarPreview(signed?.signedUrl ?? null);
        }
      }
      // Conta aulas feitas (presença confirmada)
      const { count } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("user_id", u.user.id)
        .eq("attended", true);
      setAulasFeitas(count ?? 0);
    })();
  }, []);

  const handleAvatar = async (file: File) => {
    if (!userId) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/avatar.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      setP((s) => ({ ...s, avatar_url: path }));
      const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(path, 3600);
      setAvatarPreview(signed?.signedUrl ?? null);
      // Persist avatar_url immediately so it shows across the app without needing "Salvar"
      const { error: upErr } = await supabase.from("profiles").update({ avatar_url: path }).eq("id", userId);
      if (upErr) throw upErr;
      toast.success("Foto atualizada");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível enviar a foto. Tente de novo.");
    } finally {
      setUploading(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    playPop();
    setSaving(true);
    try {
      const payload = {
        id: userId,
        ...p,
        birth_date: p.birth_date || null,
        years_playing: p.years_playing ? Number(p.years_playing) : null,
      };
      const { error } = await supabase.from("profiles").upsert(payload);
      if (error) throw error;
      toast.success("Perfil salvo!");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar o perfil. Tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof Profile, v: any) => setP((s) => ({ ...s, [k]: v }));

  return (
    <div className="animate-float-in space-y-4">
      <PageHeader
        eyebrow="Minha conta"
        title="Meu perfil"
        subtitle="Mantenha seus dados atualizados — eles ajudam em emergências."
      />

      <form onSubmit={save} className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Avatar */}
        <div className="plane text-center">
          <div className="relative mx-auto h-40 w-40">
            <div className="h-full w-full overflow-hidden rounded-full border-4 border-primary bg-secondary">
              {avatarPreview ? (
                <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-muted-foreground">
                  {(p.full_name || "?").slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { playPop(); setPickerOpen((v) => !v); }}
              disabled={uploading}
              className="btn-bounce absolute bottom-1 right-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            {pickerOpen && (
              <div className="absolute bottom-12 right-0 z-20 flex flex-col gap-1 rounded-xl border border-border bg-popover p-2">
                <button
                  type="button"
                  onClick={() => { playPop(); setPickerOpen(false); cameraRef.current?.click(); }}
                  className="btn-bounce flex items-center gap-2 rounded-full px-3 py-2 text-sm hover:bg-accent"
                >
                  <Camera className="h-4 w-4" /> Tirar foto
                </button>
                <button
                  type="button"
                  onClick={() => { playPop(); setPickerOpen(false); fileRef.current?.click(); }}
                  className="btn-bounce flex items-center gap-2 rounded-full px-3 py-2 text-sm hover:bg-accent"
                >
                  <ImageIcon className="h-4 w-4" /> Escolher da galeria
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleAvatar(e.target.files[0])}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleAvatar(e.target.files[0])}
            />
          </div>
          <div className="mt-4 type-h3">{p.full_name || "—"}</div>
          <div className="type-small text-muted-foreground">{email}</div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <Card title="Dados pessoais" hint="Esses dados são usados no contrato de aulas.">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nome completo"><Input value={p.full_name ?? ""} onChange={(v) => set("full_name", v)} /></Field>
              <Field label="CPF"><Input value={p.cpf ?? ""} onChange={(v) => set("cpf", v)} placeholder="000.000.000-00" /></Field>
              <Field label="Telefone"><Input value={p.phone ?? ""} onChange={(v) => set("phone", v)} placeholder="(11) 99999-9999" /></Field>
              <Field label="Data de nascimento"><Input type="date" value={p.birth_date ?? ""} onChange={(v) => set("birth_date", v)} /></Field>
              <Field label="Endereço completo" className="md:col-span-2"><Input value={p.address ?? ""} onChange={(v) => set("address", v)} placeholder="Rua, número, bairro, cidade/UF" /></Field>
              <Field label="Tipo sanguíneo">
                <Select value={p.blood_type ?? ""} onChange={(v) => set("blood_type", v)} options={BLOOD} placeholder="Selecione" />
              </Field>
            </div>
          </Card>

          <Card title="Responsável legal" hint="Obrigatório apenas para alunos menores de 18 anos.">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nome do responsável"><Input value={p.guardian_name ?? ""} onChange={(v) => set("guardian_name", v)} /></Field>
              <Field label="CPF do responsável"><Input value={p.guardian_cpf ?? ""} onChange={(v) => set("guardian_cpf", v)} placeholder="000.000.000-00" /></Field>
              <Field label="E-mail do responsável"><Input value={p.guardian_email ?? ""} onChange={(v) => set("guardian_email", v)} /></Field>
              <Field label="Telefone do responsável"><Input value={p.guardian_phone ?? ""} onChange={(v) => set("guardian_phone", v)} /></Field>
            </div>
          </Card>


          {/* Conquistas / gamificação */}
          <div className="plane plane-hero">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="type-h3">Minhas conquistas</h2>
            </div>
            <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile icon={GraduationCap} label="Aulas feitas" value={aulasFeitas} />
              <StatTile icon={Trophy} label="Jogos ganhos" value={p.games_won} />
              <StatTile icon={Target} label="Aces" value={p.aces} />
              <StatTile icon={Sparkles} label="Anos jogando" value={p.years_playing ?? 0} />
            </div>
          </div>

          <Card title="Sobre o jogo">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Há quanto tempo joga? (anos)">
                <Input type="number" min="0" value={String(p.years_playing ?? "")} onChange={(v) => set("years_playing", v)} />
              </Field>
              <Field label="Nível">
                <Select value={p.skill_level ?? ""} onChange={(v) => set("skill_level", v)} options={LEVELS} placeholder="Selecione" />
              </Field>
              <Field label="Mão dominante">
                <Select value={p.dominant_hand ?? ""} onChange={(v) => set("dominant_hand", v)} options={HANDS} placeholder="Selecione" />
              </Field>
              <Field label="Jogos ganhos">
                <Input type="number" min="0" value={String(p.games_won ?? 0)} onChange={(v) => set("games_won", Number(v) || 0)} />
              </Field>
              <Field label="Aces">
                <Input type="number" min="0" value={String(p.aces ?? 0)} onChange={(v) => set("aces", Number(v) || 0)} />
              </Field>
              <Field label="Bio" className="md:col-span-2">
                <Textarea value={p.bio ?? ""} onChange={(v) => set("bio", v)} placeholder="Conte um pouco sobre você como jogador" />
              </Field>
            </div>
          </Card>

          <Card title="Emergência" hint="Quem chamar caso aconteça algo durante o treino.">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nome do contato"><Input value={p.emergency_contact_name ?? ""} onChange={(v) => set("emergency_contact_name", v)} /></Field>
              <Field label="Telefone do contato"><Input value={p.emergency_contact_phone ?? ""} onChange={(v) => set("emergency_contact_phone", v)} /></Field>
              <Field label="Observações médicas / alergias" className="md:col-span-2">
                <Textarea value={p.medical_notes ?? ""} onChange={(v) => set("medical_notes", v)} placeholder="Alergias, medicações, condições relevantes" />
              </Field>
            </div>
          </Card>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="btn-bounce rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? "Salvando..." : "Salvar perfil"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="plane">
      <h2 className="type-h3">{title}</h2>
      {hint && <p className="mt-1 type-micro text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block type-micro text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Input(props: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string; min?: string }) {
  return (
    <input
      {...props}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
    />
  );
}
function Textarea(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      rows={3}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
    />
  );
}
function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
    >
      <option value="">{placeholder ?? "—"}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function StatTile({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="plane plane-compact h-full">
      <div className="mb-2 flex items-center gap-2 type-micro text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" />
        {label}
      </div>
      <div className="type-data text-2xl font-bold">{value}</div>
    </div>
  );
}
