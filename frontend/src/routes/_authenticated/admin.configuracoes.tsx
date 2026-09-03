import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CircleDollarSign,
  Clock3,
  Eye,
  Facebook,
  Globe,
  Instagram,
  Loader2,
  MessageCircle,
  Music2,
  Save,
  Shield,
  Users,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import { PageHeader } from "@/components/PageHeader";
import { safeExternalHttpUrl } from "@/lib/url";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  component: ConfigPage,
});

const PROF_FIELDS = [
  { key: "phone", label: "Telefone" },
  { key: "birth_date", label: "Data de nascimento" },
  { key: "blood_type", label: "Tipo sanguíneo" },
  { key: "address", label: "Endereço" },
  { key: "emergency_contact_name", label: "Contato de emergência (nome)" },
  { key: "emergency_contact_phone", label: "Contato de emergência (telefone)" },
  { key: "medical_notes", label: "Observações médicas" },
] as const;
type ProfField = (typeof PROF_FIELDS)[number]["key"];

type BookingProduct = {
  id: string;
  booking_type: string;
  display_name: string;
  price_cents: number;
  student_capacity: number;
  requires_professor: boolean;
  sort_order: number;
  active: boolean;
};

type Socials = {
  instagram: string;
  facebook: string;
  youtube: string;
  tiktok: string;
  website: string;
};

const SOCIAL_KEYS: (keyof Socials)[] = ["instagram", "facebook", "youtube", "tiktok", "website"];

function ConfigPage() {
  const [whatsapp, setWhatsapp] = useState("");
  const [whatsappMsg, setWhatsappMsg] = useState("");
  const [socials, setSocials] = useState<Socials>({
    instagram: "",
    facebook: "",
    youtube: "",
    tiktok: "",
    website: "",
  });
  const [profVis, setProfVis] = useState<Record<ProfField, boolean>>(
    Object.fromEntries(PROF_FIELDS.map((f) => [f.key, false])) as Record<ProfField, boolean>,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSocials, setSavingSocials] = useState(false);
  const [savingProf, setSavingProf] = useState(false);
  const [products, setProducts] = useState<BookingProduct[]>([]);
  const [productDrafts, setProductDrafts] = useState<Record<string, string>>({});
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [cancellationNoticeHours, setCancellationNoticeHours] = useState(24);
  const [savingCancellation, setSavingCancellation] = useState(false);

  useEffect(() => {
    (async () => {
      const profKeys = PROF_FIELDS.map((f) => `prof_visible_${f.key}`);
      const keys = [
        "whatsapp_number",
        "whatsapp_message",
        "cancellation_notice_hours",
        ...SOCIAL_KEYS.map((k) => `social_${k}`),
        ...profKeys,
      ];
      const [{ data }, { data: productRows }] = await Promise.all([
        (supabase as any).from("site_settings").select("key, value").in("key", keys),
        supabase
          .from("pricing")
          .select(
            "id, booking_type, display_name, price_cents, student_capacity, requires_professor, sort_order, active",
          )
          .order("sort_order"),
      ]);
      const map = Object.fromEntries(((data as any[]) ?? []).map((r) => [r.key, r.value ?? ""]));
      setWhatsapp(map["whatsapp_number"] ?? "");
      setWhatsappMsg(map["whatsapp_message"] ?? "");
      const noticeHours = Number(map["cancellation_notice_hours"] ?? 24);
      setCancellationNoticeHours(
        Number.isInteger(noticeHours) && noticeHours >= 0 && noticeHours <= 720 ? noticeHours : 24,
      );
      setSocials({
        instagram: map["social_instagram"] ?? "",
        facebook: map["social_facebook"] ?? "",
        youtube: map["social_youtube"] ?? "",
        tiktok: map["social_tiktok"] ?? "",
        website: map["social_website"] ?? "",
      });
      setProfVis(
        Object.fromEntries(
          PROF_FIELDS.map((f) => [f.key, String(map[`prof_visible_${f.key}`] ?? "") === "true"]),
        ) as Record<ProfField, boolean>,
      );
      const loadedProducts = (productRows ?? []) as BookingProduct[];
      setProducts(loadedProducts);
      setProductDrafts(
        Object.fromEntries(
          loadedProducts.map((product) => [
            product.id,
            (product.price_cents / 100).toFixed(2).replace(".", ","),
          ]),
        ),
      );
      setLoading(false);
    })();
  }, []);

  const saveProduct = async (product: BookingProduct) => {
    playPop();
    const rawValue = (productDrafts[product.id] ?? "").trim();
    const normalized = rawValue.includes(",")
      ? rawValue.replace(/\./g, "").replace(",", ".")
      : rawValue;
    const priceCents = Math.round(Number(normalized) * 100);
    if (!Number.isInteger(priceCents) || priceCents <= 0 || priceCents > 10_000_000) {
      toast.error("Informe um valor válido maior que zero.");
      return;
    }

    setSavingProductId(product.id);
    const { data, error } = await supabase
      .from("pricing")
      .update({ price_cents: priceCents, active: product.active })
      .eq("id", product.id)
      .select("id, price_cents, active")
      .maybeSingle();
    setSavingProductId(null);
    if (error || !data) {
      toast.error("Não foi possível salvar este produto.");
      return;
    }
    setProducts((current) =>
      current.map((item) =>
        item.id === product.id
          ? { ...item, price_cents: data.price_cents, active: data.active }
          : item,
      ),
    );
    setProductDrafts((current) => ({
      ...current,
      [product.id]: (data.price_cents / 100).toFixed(2).replace(".", ","),
    }));
    toast.success(`${product.display_name} atualizado`);
  };

  const saveProfVis = async () => {
    playPop();
    setSavingProf(true);
    const rows = PROF_FIELDS.map((f) => ({
      key: `prof_visible_${f.key}`,
      value: profVis[f.key] ? "true" : "false",
    }));
    const { error } = await (supabase as any)
      .from("site_settings")
      .upsert(rows, { onConflict: "key" });
    setSavingProf(false);
    if (error) {
      toast.error("Não foi possível salvar as permissões");
      return;
    }
    toast.success("Permissões dos professores atualizadas");
  };

  const save = async () => {
    playPop();
    setSaving(true);
    const clean = whatsapp.replace(/[^\d+]/g, "");
    const { error } = await (supabase as any).from("site_settings").upsert(
      [
        { key: "whatsapp_number", value: clean },
        { key: "whatsapp_message", value: whatsappMsg.trim() },
      ],
      { onConflict: "key" },
    );
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar");
      return;
    }
    setWhatsapp(clean);
    toast.success("WhatsApp atualizado");
  };

  const saveCancellationPolicy = async () => {
    playPop();
    if (
      !Number.isInteger(cancellationNoticeHours) ||
      cancellationNoticeHours < 0 ||
      cancellationNoticeHours > 720
    ) {
      toast.error("Informe um prazo entre 0 e 720 horas.");
      return;
    }
    setSavingCancellation(true);
    const { error } = await (supabase as any)
      .from("site_settings")
      .upsert([{ key: "cancellation_notice_hours", value: String(cancellationNoticeHours) }], {
        onConflict: "key",
      });
    setSavingCancellation(false);
    if (error) {
      toast.error("Não foi possível salvar a regra de cancelamento.");
      return;
    }
    toast.success("Prazo de cancelamento atualizado");
  };

  const saveSocials = async () => {
    playPop();
    const invalid = SOCIAL_KEYS.find((key) => {
      const value = socials[key]?.trim();
      return value && !safeExternalHttpUrl(value);
    });
    if (invalid) {
      toast.error("Use apenas links completos iniciados por http:// ou https://.");
      return;
    }
    setSavingSocials(true);
    const rows = SOCIAL_KEYS.map((k) => ({
      key: `social_${k}`,
      value: safeExternalHttpUrl(socials[k]) ?? "",
    }));
    const { error } = await (supabase as any)
      .from("site_settings")
      .upsert(rows, { onConflict: "key" });
    setSavingSocials(false);
    if (error) {
      toast.error("Não foi possível salvar as redes");
      return;
    }
    toast.success("Redes sociais atualizadas");
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin · Configurações"
        title="Configurações"
        subtitle="Dados públicos exibidos para os alunos e leads na landing page."
      />

      <section className="plane">
        <div className="mb-4 flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <CircleDollarSign className="h-4 w-4" />
          </span>
          <div>
            <h2 className="type-h3">Produtos e valores</h2>
            <p className="type-micro text-muted-foreground">
              Defina quanto cada aluno paga por uma vaga. Alterações não mudam reservas ou Pix já
              criados.
            </p>
          </div>
        </div>

        <div className="divide-y divide-border border-y border-border">
          {products
            .filter(
              (product) =>
                product.booking_type !== "teste" ||
                import.meta.env.VITE_ENABLE_TEST_BOOKING_TYPE === "true",
            )
            .map((product) => (
              <div
                key={product.id}
                className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end"
              >
                <div className="min-w-0">
                  <div className="font-semibold">{product.display_name}</div>
                  <div className="mt-1 flex items-center gap-1.5 type-micro text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {product.student_capacity === 1
                      ? "1 aluno por horário"
                      : `Até ${product.student_capacity} alunos por horário`}
                  </div>
                </div>
                <label className="block">
                  <span className="mb-1 block type-micro text-muted-foreground">
                    Valor por aluno
                  </span>
                  <span className="flex items-center rounded-lg border border-input bg-background px-3">
                    <span className="text-sm text-muted-foreground">R$</span>
                    <input
                      inputMode="decimal"
                      value={productDrafts[product.id] ?? ""}
                      onChange={(event) =>
                        setProductDrafts((current) => ({
                          ...current,
                          [product.id]: event.target.value,
                        }))
                      }
                      className="min-w-0 flex-1 bg-transparent px-2 py-2 text-right text-sm outline-none"
                      aria-label={`Valor de ${product.display_name}`}
                    />
                  </span>
                </label>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={product.active}
                      onChange={(event) =>
                        setProducts((current) =>
                          current.map((item) =>
                            item.id === product.id
                              ? { ...item, active: event.target.checked }
                              : item,
                          ),
                        )
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    Disponível
                  </label>
                  <button
                    type="button"
                    onClick={() => void saveProduct(product)}
                    disabled={savingProductId === product.id}
                    className="btn-bounce inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-60"
                    title={`Salvar ${product.display_name}`}
                    aria-label={`Salvar ${product.display_name}`}
                  >
                    {savingProductId === product.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
        </div>
      </section>

      <section className="plane">
        <div className="mb-4 flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Clock3 className="h-4 w-4" />
          </span>
          <div>
            <h2 className="type-h3">Cancelamento de aulas com crédito</h2>
            <p className="type-micro text-muted-foreground">
              Dentro do prazo, o aluno recupera o crédito. Depois do prazo, a vaga é liberada, mas o
              crédito não retorna.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:max-w-md sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="mb-1 block type-micro text-muted-foreground">
              Antecedência mínima em horas
            </span>
            <input
              type="number"
              min={0}
              max={720}
              step={1}
              value={cancellationNoticeHours}
              onChange={(event) => setCancellationNoticeHours(Number(event.target.value))}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveCancellationPolicy()}
            disabled={savingCancellation}
            className="btn-bounce inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {savingCancellation ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar prazo
          </button>
        </div>
        <p className="mt-2 type-micro text-muted-foreground">
          {cancellationNoticeHours === 0
            ? "O crédito será devolvido até o início da aula."
            : cancellationNoticeHours % 24 === 0
              ? `Equivale a ${cancellationNoticeHours / 24} ${cancellationNoticeHours === 24 ? "dia" : "dias"}.`
              : `O aluno precisa avisar com pelo menos ${cancellationNoticeHours} horas.`}
        </p>
      </section>

      <section className="plane">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <MessageCircle className="h-4 w-4" />
          </span>
          <div>
            <h2 className="type-h3">WhatsApp de contato</h2>
            <p className="type-micro text-muted-foreground">
              Aparece como botão "Falar no WhatsApp" abaixo do formulário de pré-cadastro.
            </p>
          </div>
        </div>
        <label className="mb-1 block type-eyebrow text-muted-foreground">
          Número com DDI e DDD (ex.: 5551999999999)
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="5551999999999"
            className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
          />
        </div>
        <p className="mt-2 type-micro text-muted-foreground">
          Deixe em branco para esconder o botão da landing page.
        </p>

        <label className="mt-4 mb-1 block type-eyebrow text-muted-foreground">
          Mensagem padrão enviada ao clicar
        </label>
        <textarea
          value={whatsappMsg}
          onChange={(e) => setWhatsappMsg(e.target.value)}
          placeholder="Olá! Vim pelo site e gostaria de saber mais sobre as aulas."
          rows={3}
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
        />

        <button
          onClick={save}
          disabled={saving}
          className="btn-bounce mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar WhatsApp
        </button>
      </section>

      <section className="plane">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Instagram className="h-4 w-4" />
          </span>
          <div>
            <h2 className="type-h3">Redes sociais</h2>
            <p className="type-micro text-muted-foreground">
              Links que aparecem no rodapé da landing page. Deixe em branco para esconder.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SocialField
            icon={<Instagram className="h-4 w-4" />}
            label="Instagram"
            placeholder="https://instagram.com/seuperfil"
            value={socials.instagram}
            onChange={(v) => setSocials({ ...socials, instagram: v })}
          />
          <SocialField
            icon={<Facebook className="h-4 w-4" />}
            label="Facebook"
            placeholder="https://facebook.com/suapagina"
            value={socials.facebook}
            onChange={(v) => setSocials({ ...socials, facebook: v })}
          />
          <SocialField
            icon={<Youtube className="h-4 w-4" />}
            label="YouTube"
            placeholder="https://youtube.com/@seucanal"
            value={socials.youtube}
            onChange={(v) => setSocials({ ...socials, youtube: v })}
          />
          <SocialField
            icon={<Music2 className="h-4 w-4" />}
            label="TikTok"
            placeholder="https://tiktok.com/@seuperfil"
            value={socials.tiktok}
            onChange={(v) => setSocials({ ...socials, tiktok: v })}
          />
          <SocialField
            icon={<Globe className="h-4 w-4" />}
            label="Site"
            placeholder="https://seusite.com.br"
            value={socials.website}
            onChange={(v) => setSocials({ ...socials, website: v })}
          />
        </div>

        <button
          onClick={saveSocials}
          disabled={savingSocials}
          className="btn-bounce mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {savingSocials ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salvar redes sociais
        </button>
      </section>

      <section className="plane">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Shield className="h-4 w-4" />
          </span>
          <div>
            <h2 className="type-h3">Dados visíveis para professores</h2>
            <p className="type-micro text-muted-foreground">
              Por padrão, professores veem apenas nome, foto, nível e bio dos alunos. Marque abaixo
              o que deseja liberar.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {PROF_FIELDS.map((f) => (
            <label
              key={f.key}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm"
            >
              <span className="inline-flex items-center gap-2">
                <Eye className="h-4 w-4 text-muted-foreground" /> {f.label}
              </span>
              <input
                type="checkbox"
                checked={profVis[f.key]}
                onChange={(e) => setProfVis({ ...profVis, [f.key]: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
            </label>
          ))}
        </div>

        <button
          onClick={saveProfVis}
          disabled={savingProf}
          className="btn-bounce mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {savingProf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar permissões
        </button>
      </section>
    </div>
  );
}

function SocialField({
  icon,
  label,
  placeholder,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 type-eyebrow text-muted-foreground">
        {icon} {label}
      </span>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
      />
    </label>
  );
}
