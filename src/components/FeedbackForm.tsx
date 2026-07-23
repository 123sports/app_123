import { useState } from "react";
import { Star, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";

export function FeedbackForm({
  professorId,
  professorName,
  studentId,
  onDone,
}: {
  professorId: string;
  professorName: string;
  studentId: string;
  onDone?: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [publicConsent, setPublicConsent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    playPop();
    if (comment.trim().length > 800) {
      toast.error("Comentário muito longo (máx 800).");
      return;
    }
    setLoading(true);
    const { error } = await (supabase as any).from("professor_feedback").insert({
      professor_id: professorId,
      student_id: anonymous ? null : studentId,
      rating,
      comment: comment.trim() || null,
      is_anonymous: anonymous,
      public_consent: publicConsent,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Erro ao enviar");
      return;
    }
    toast.success("Feedback enviado! Obrigado.");
    setComment("");
    setRating(5);
    setAnonymous(false);
    setPublicConsent(false);
    onDone?.();
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div>
        <div className="text-sm font-semibold">Avaliar {professorName}</div>
        <p className="text-xs text-muted-foreground">Sua opinião ajuda a melhorar as aulas.</p>
      </div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => { playPop(); setRating(n); }}
            className="btn-bounce p-1"
            aria-label={`${n} estrela${n > 1 ? "s" : ""}`}
          >
            <Star className={`h-7 w-7 ${n <= rating ? "fill-primary text-primary" : "text-muted-foreground"}`} />
          </button>
        ))}
      </div>
      <textarea
        rows={3}
        maxLength={800}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Conte como foi sua experiência (opcional)"
        className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"
      />
      <div className="space-y-2 text-xs">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          <span>Enviar anonimamente</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={publicConsent} onChange={(e) => setPublicConsent(e.target.checked)} />
          <span>Autorizo a quadra divulgar este depoimento publicamente</span>
        </label>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="btn-bounce w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
      >
        {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</span> : "Enviar feedback"}
      </button>
    </form>
  );
}
