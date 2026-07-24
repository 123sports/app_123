import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * ON COURT — padrão único de listagem de pessoas (aluno, membro, coach…).
 * Linha em lista (não tabela): nome em negrito + meta em tom mudo à esquerda,
 * área livre de "trailing" à direita (stats, data, nota, ações). Divisória
 * simples entre linhas, linha inteira clicável, hover só de BG (sem mover nada).
 *
 * Use SEMPRE que houver listagem de aluno/pessoa, para manter consistência:
 *   <PersonList>
 *     {items.map((p) => (
 *       <PersonRow key={p.id} to="/admin/aluno/$id" params={{ id: p.id }}
 *         name={p.name} meta="+55 …" trailing={<Stat .../>} />
 *     ))}
 *   </PersonList>
 */
export function PersonList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border">{children}</ul>;
}

export function PersonRow({
  to,
  params,
  onClick,
  name,
  meta,
  trailing,
}: {
  to?: string;
  params?: Record<string, string>;
  onClick?: () => void;
  name: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{name}</span>
        {meta ? <span className="mt-0.5 block type-micro text-muted-foreground">{meta}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-5">{trailing}</span> : null}
    </>
  );
  const cls = "-mx-3 flex items-center gap-3 px-3 py-3 transition-colors";
  return (
    <li>
      {to ? (
        <Link to={to as never} params={params as never} onClick={onClick} className={`${cls} hover:bg-accent`}>
          {content}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={`${cls} w-full text-left hover:bg-accent`}>
          {content}
        </button>
      ) : (
        <div className={cls}>{content}</div>
      )}
    </li>
  );
}

/** Célula numérica compacta para a área de trailing (rótulo micro + valor). */
export function PersonStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "danger" | "muted";
}) {
  const color = tone === "danger" ? "text-destructive" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <span className="text-right">
      <span className="block type-micro text-muted-foreground">{label}</span>
      <span className={`type-data text-sm font-bold ${color}`}>{value}</span>
    </span>
  );
}
