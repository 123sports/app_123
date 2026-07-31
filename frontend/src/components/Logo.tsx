import logoAsset from "@/assets/brand/on-tennis-app-light.png";

export function Logo({ className = "h-24" }: { className?: string }) {
  return (
    <img
      src={logoAsset}
      alt="On Tennis — Olimpio Neto Treinamento Esportivo"
      className={`${className} w-auto max-w-none object-contain drop-shadow-xl`}
    />
  );
}
