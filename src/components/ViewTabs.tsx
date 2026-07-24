import type { ComponentType } from "react";

/**
 * ON COURT — abas de visualização/seção (design-system §7).
 * Padrão único do projeto: texto sobre uma hairline inferior, aba ativa em
 * tinta (text-primary) com uma barra fina embaixo. Ícone é opcional.
 * Usado em Reservas, Financeiro e qualquer troca de visão/seção.
 */
export type ViewTab<K extends string = string> = {
  key: K;
  label: string;
  icon?: ComponentType<{ className?: string }>;
};

export function ViewTabs<K extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: ViewTab<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-1 overflow-x-auto border-b border-border ${className}`}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`relative flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium transition ${
              active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {Icon ? <Icon className="h-4 w-4" /> : null}
            <span>{t.label}</span>
            {active ? <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}
