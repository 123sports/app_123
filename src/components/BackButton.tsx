import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { playPop } from "@/lib/sfx";

export function BackButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const handleClick = () => {
    playPop();
    // Use browser history if available, else fallback to a sensible default
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
    } else {
      router.navigate({ to: "/app" });
    }
  };
  return (
    <button
      onClick={handleClick}
      aria-label="Voltar"
      className={`btn-bounce inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary ${className}`}
    >
      <ArrowLeft className="h-4 w-4" />
      <span>Voltar</span>
    </button>
  );
}
