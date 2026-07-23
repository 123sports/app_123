import tennisPlayer from "@/assets/tennis-player.png";

export function TennisPlayer({ size = 180 }: { size?: number }) {
  return (
    <div
      className="pointer-events-none select-none"
      style={{ width: size, height: size }}
    >
      <img
        src={tennisPlayer}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        loading="lazy"
        className="h-full w-full object-contain animate-tennis-swing drop-shadow-[0_10px_20px_rgba(0,0,0,0.15)]"
        style={{ transformOrigin: "60% 80%" }}
      />
    </div>
  );
}
