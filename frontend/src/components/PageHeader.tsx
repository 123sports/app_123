import type { ReactNode } from "react";

/**
 * ON COURT — cabeçalho de página padrão (design-system/DESIGN-SYSTEM.md §7).
 * Lei #1: todo título de página usa este componente — um papel, um lugar.
 *
 *   eyebrow  → rótulo de contexto (ex.: "Admin · Financeiro"), UPPERCASE
 *   title    → título único da página (type-h1)
 *   subtitle → apoio opcional
 *   actions  → botões/controles alinhados à direita
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="type-eyebrow">{eyebrow}</p> : null}
        <h1 className="type-h1 mt-1">{title}</h1>
        {subtitle ? <p className="type-small mt-1 text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
