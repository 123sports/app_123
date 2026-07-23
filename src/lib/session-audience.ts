// Persiste o "modo" escolhido no login (aluno x equipe).
// Mesmo se o usuário tiver papel de admin/professor, ao entrar como aluno
// ele NÃO acessa a área administrativa durante esta sessão.

export type Audience = "aluno" | "equipe";
const KEY = "session_audience";

export function setAudience(a: Audience) {
  try {
    localStorage.setItem(KEY, a);
  } catch {
    // Ignore storage failures in private or restricted browser contexts.
  }
}

export function getAudience(): Audience | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "aluno" || v === "equipe" ? v : null;
  } catch { return null; }
}

export function clearAudience() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore storage failures in private or restricted browser contexts.
  }
}
