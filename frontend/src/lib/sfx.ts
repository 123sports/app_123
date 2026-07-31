// Lightweight bouncing-ball pop sound via WebAudio — no asset needed.
let ctx: AudioContext | null = null;

function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function playPop() {
  // Silenciado a pedido do usuário — mantém a função pra não quebrar chamadas existentes.
  return;
}

