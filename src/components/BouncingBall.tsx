import ball from "@/assets/tennis-ball.png";
import racket from "@/assets/tennis-racket.png";

/**
 * Bouncing ball + tennis racket entering from the bottom-right corner,
 * as if mid-swing. The ball bounces on the center of the racket strings.
 */
export function BouncingBall({ size = 64 }: { size?: number }) {
  const racketSize = size * 3.4;
  // Strings center inside the racket image (normalized 0–1).
  const stringsCx = 0.38;
  const stringsCy = 0.34;
  // Push the racket further off the bottom-right so the handle exits the frame.
  const offsetX = racketSize * 0.45;
  const offsetY = racketSize * 0.5;
  // Extra tilt so it reads as "coming from outside the screen".
  const tilt = 18; // degrees

  // Ball position = strings center (after racket rotation) + racket offset.
  // We approximate by computing the rotated center around transform origin (85%, 90%).
  const ox = racketSize * 0.85;
  const oy = racketSize * 0.9;
  const cx = stringsCx * racketSize;
  const cy = stringsCy * racketSize;
  const rad = (tilt * Math.PI) / 180;
  const dx = cx - ox;
  const dy = cy - oy;
  const rotatedCx = ox + dx * Math.cos(rad) - dy * Math.sin(rad);
  const rotatedCy = oy + dx * Math.sin(rad) + dy * Math.cos(rad);
  const ballLeft = rotatedCx + offsetX;
  const ballTop = rotatedCy + offsetY;

  return (
    <div
      className="relative select-none overflow-visible"
      style={{ width: racketSize + offsetX * 0.6, height: racketSize + offsetY * 0.5 }}
    >
      <div
        className="absolute"
        style={{
          left: offsetX,
          top: offsetY,
          width: racketSize,
          height: racketSize,
          transform: `rotate(${tilt}deg)`,
          transformOrigin: "85% 90%",
        }}
      >
        <img
          src={racket}
          alt=""
          width={racketSize}
          height={racketSize}
          loading="lazy"
          draggable={false}
          className="animate-racket-hit"
          style={{
            width: racketSize,
            height: racketSize,
            transformOrigin: "85% 90%",
            filter: "drop-shadow(0 14px 22px rgba(0,0,0,0.4))",
          }}
        />
      </div>
      <img
        src={ball}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="animate-bounce-ball absolute"
        style={{
          width: size,
          height: size,
          left: ballLeft,
          top: ballTop,
          marginLeft: -size / 2,
          marginTop: -size / 2,
          filter: "drop-shadow(0 8px 12px oklch(0.7 0.18 130 / 0.55))",
        }}
      />
    </div>
  );
}
