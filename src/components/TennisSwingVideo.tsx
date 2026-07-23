import videoAsset from "@/assets/tennis-swing.mp4.asset.json";

/**
 * Realistic tennis player completing a forehand swing.
 *
 * Background removal: `mix-blend-mode: screen` makes pure black contribute
 * nothing to the composite, effectively making the studio background fully
 * transparent over the hero gradient. Heavy contrast + slight brightness
 * reduction crushes JPEG-encoded near-black noise down to true black so the
 * rectangle edges fully disappear without needing a mask.
 */
export function TennisSwingVideo({ className = "" }: { className?: string }) {
  return (
    <video
      src={videoAsset.url}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      aria-hidden
      className={`pointer-events-none select-none ${className}`}
      style={{
        mixBlendMode: "screen",
        filter: "contrast(1.45) brightness(0.92) saturate(1.1)",
      }}
    />
  );
}
