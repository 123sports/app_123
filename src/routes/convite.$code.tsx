import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Gift, Sparkles, Trophy, Loader2, ArrowRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { BouncingBall } from "@/components/BouncingBall";
import { getReferralInfo } from "@/lib/referrals.functions";
import { playPop } from "@/lib/sfx";

export const Route = createFileRoute("/convite/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Você foi convidado! — On Tennis` },
      { name: "description", content: "Aceite o convite e venha jogar no On Tennis." },
      { property: "og:title", content: `Convite especial — On Tennis` },
      { property: "og:description", content: `Use o código ${params.code} e aceite o convite.` },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const fetchInfo = useServerFn(getReferralInfo);

  const { data, isLoading } = useQuery({
    queryKey: ["referral-info", code],
    queryFn: () => fetchInfo({ data: { code } }),
    retry: false,
  });

  const accept = () => {
    playPop();
    // Persist code so it survives any OAuth round-trip on /auth
    try { sessionStorage.setItem("on_tennis_ref", code.toUpperCase()); } catch {}
    navigate({ to: "/auth", search: { ref: code.toUpperCase() } as any });
  };

  return (
    <div className="hero-bg flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <Link to="/" className="mb-8 flex items-center justify-center">
          <Logo className="h-14" />
        </Link>

        <div className="rounded-3xl border border-border bg-card p-8 shadow-soft">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !data?.valid ? (
            <div className="text-center">
              <h1 className="mb-2 text-2xl font-bold">Convite inválido</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Este link de indicação não foi encontrado ou expirou.
              </p>
              <Link
                to="/auth"
                className="btn-bounce inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
              >
                Criar conta mesmo assim <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h1 className="text-2xl font-bold">
                  {data.welcome_title ?? "Você foi convidado! 🎾"}
                </h1>
                <div className="-mt-4"><BouncingBall size={32} /></div>
              </div>

              <div className="mb-5 rounded-2xl border border-primary bg-primary/10 px-4 py-3 text-sm">
                <p className="text-muted-foreground">Indicado por</p>
                <p className="text-lg font-bold text-primary">{data.inviter_name}</p>
              </div>

              {data.welcome_bonus && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-border bg-background p-4">
                  <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="text-sm">
                    <p className="font-semibold">Bônus de boas-vindas</p>
                    <p className="text-muted-foreground">{data.welcome_bonus}</p>
                  </div>
                </div>
              )}

              <div className="mb-6 rounded-2xl border border-border bg-background p-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Seu código de convite
                </p>
                <p className="text-2xl font-bold tracking-widest text-primary">{data.code}</p>
              </div>

              {data.rewards.length > 0 && (
                <div className="mb-6">
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Trophy className="h-4 w-4 text-primary" /> Indicando outros, você também ganha
                  </p>
                  <ul className="space-y-2">
                    {data.rewards.map((r: any, i: number) => (
                      <li key={i} className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm">
                        <span>{r.label} — {r.min_referrals} {r.min_referrals === 1 ? "indicação" : "indicações"}</span>
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-bold text-primary">
                          {r.discount_percent}% off
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={accept}
                className="btn-bounce flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-semibold text-primary-foreground shadow-glow"
              >
                <Gift className="h-4 w-4" /> Aceitar convite e criar conta
              </button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Ao criar sua conta, a indicação é registrada automaticamente.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
