# ON COURT — Design System da plataforma On Tennis

> Baseado na engenharia reversa de **paulkalkbrenner.net** (23/07/2026): sistema
> techno-brutalista, monocromático, tipografia grotesca única em peso 700,
> display gigante, zero sombras, motion com easing assinatura. Este documento
> traduz esse DNA para a plataforma On Tennis (landing + app do aluno + admin)
> e resolve as inconsistências mapeadas na auditoria de UI de 23/07/2026.

**Arquivos do pacote**

| Arquivo | Papel |
|---|---|
| `tokens.css` | Tokens canônicos (`--on-*`), modos DAY/NIGHT, base + foco |
| `theme.tailwind.css` | Ponte Tailwind v4 (`@theme` + utilities `type-*`, `plane`, `btn-on`…) |
| `motion.css` + `motion.js` | Runtime de animação sem dependências (`OnMotion.scan()`) |
| `styleguide.html` | Styleguide vivo — abra no navegador |

---

## 1. Personalidade

O PK é "preciso, industrial, com energia contida". O On Tennis herda isso e
soma o universo da quadra: **saibro, linhas de giz, o flash verde-ácido da
bolinha**. A tradução:

- **Disciplina monocromática.** O par de trabalho é tinta sobre superfície.
  Cor de marca não é decoração — é um **flash**, um por tela.
- **Uma voz tipográfica.** Uma grotesca única, peso 700 como identidade
  (títulos, botões, navegação). Peso 500 existe apenas para dados densos.
- **Plano como uma quadra.** Zero sombras, zero gradientes decorativos,
  blocos retos. Profundidade vem de inversão de cor e escala. A única curva
  do sistema é o **pill** — botões, chips e avatares, redondos como a bola.
- **Movimento decidido.** Arranque lento, chegada firme
  (`cubic-bezier(.625,.05,0,1)`). Nada balança à toa: o app anima na entrada
  e no toque; a landing coreografa o scroll.

O que **sai** do visual atual: Fredoka/Quicksand (arredondadas), fundo
verde-petróleo com gradientes radiais, `shadow-glow`/`shadow-soft`,
`rounded-xl/2xl/3xl` em blocos, animações "fofas" (bounce de bola em sino).
O que **fica**: o verde da marca (agora com papel disciplinado), o tom de voz
PT-BR caloroso, o feedback sonoro (`playPop`) como camada opcional.

---

## 2. Cor

### Primitivos

| Token | Valor | Origem |
|---|---|---|
| `--on-ink` | `#0b120c` | Quase-preto com undertone verde (herda o ink `#003333`) |
| `--on-surface` | `#c8cbc3` | "Saibro-cinza" — o `#c5c5c5` do PK puxado para o verde |
| `--on-light` | `#ffffff` | |
| `--on-button` | `#10150f` | Fundo do pill primário sobre claro |
| `--on-ink-60/-30/-20/-10/-5` | rgba da tinta | Texto secundário, hairlines, washes |
| `--on-light-70/-30/-20/-10/-5` | rgba da luz | Idem sobre escuro |

### Acentos — regra do flash

| Token | Valor | Papel semântico |
|---|---|---|
| `--on-accent-acid` | `#ccff33` | Flash da marca no escuro — CTA, ativo |
| `--on-accent-lime` | `#99cc00` | Verde da marca sobre claro |
| `--on-accent-clay` | `#ff6831` | Saibro — pendências, alertas |
| `--on-accent-sky` | `#33ccff` | Informativo — raro |
| `--on-danger` | `#e5484d` | Destrutivo/erro (funcional, não decorativo) |

**Regras** (herdadas do PK, agora com semântica de produto):

1. **Um acento por tela/seção.** Se o CTA é ácido, badges da mesma vista são
   monocromáticos (tinta/luz esmaecida). Exceção: estados funcionais
   (danger/clay) coexistem com o acento porque comunicam, não decoram.
2. Acento **nunca** em texto corrido; apenas superfícies pequenas (botão,
   chip, indicador) ou números de destaque.
3. Par de contraste fixo: ácido/lime sempre com tinta por cima
   (`--on-accent-fg`), nunca branco.

### Modos de superfície

| Modo | Uso | bg | fg | panel |
|---|---|---|---|---|
| **DAY** (`:root`) | Landing, e-mails, contratos/impressão | `surface` | `ink` | `light` |
| **NIGHT** (`.on-night`) | App do aluno e admin | `ink` | `light` | `#141a13` |

Como o PK inverte seções (nav clara → seção escura), a plataforma inverte
contextos: **marketing vive no dia, o produto vive na noite**. A landing pode
alternar seções DAY/NIGHT livremente; dentro do app não se mistura.
O `ThemeToggle` atual morre — modo é decisão do contexto, não preferência.

---

## 3. Tipografia

**Família única:** [Archivo](https://fonts.google.com/specimen/Archivo)
variável (100–900), self-hosted — grotesca industrial, eixo largo, boa
substituta livre da ABC Diatype Plus do PK. Fallback: `"Helvetica Neue",
Arial, sans-serif`.

**Pesos: dois.** `700` é a voz (tudo que é UI); `500` é o corpo de dados
(tabelas, formulários longos, textos legais). Nada de 400/600 espalhados.

### Escala — 8 papéis, e só

| Papel | Token | Tamanho | lh | ls | Uso |
|---|---|---|---|---|---|
| Display | `--on-fs-display` | clamp(56→180px) | .8 | −.05em | **Só landing** (herói, número-show) |
| H1 | `--on-fs-1` | clamp(32→48px) | .9 | −.03em | Título de página — **um por página** |
| H2 | `--on-fs-2` | 24px | .9 | −.03em | Título de seção |
| H3 | `--on-fs-3` | 18px | .9 | −.03em | Título de card |
| Eyebrow | `--on-fs-eyebrow` | 13px CAPS | 1.1 | +.04em | Rótulo de seção/grupo (RESERVAS, CONTRATOS) |
| Body | `--on-fs-body` | 16px | 1.2 | 0 | Padrão |
| Small | `--on-fs-small` | 14px | 1.2 | 0 | Meta, células de tabela |
| Micro | `--on-fs-micro` | **12px — piso absoluto** | 1.1 | +.04em em CAPS | Badges, hints |

Utilities prontas: `type-display`, `type-h1`, `type-h2`, `type-h3`,
`type-eyebrow`, `type-body`, `type-small`, `type-micro`, `type-data`
(peso 500 + `tabular-nums`).

**Regras**

1. `text-[8px]`–`text-[11px]` são proibidos. O menor tipo do sistema é 12px.
2. Título de página é **sempre** `type-h1`. Acabaram os H1 em 3 tamanhos.
3. Números que se comparam (KPIs, tabelas, preços) usam `type-data`.
4. Textos longos (termos, contratos) usam `--on-lh-reading` (1.4).
5. UPPERCASE abre tracking (+.04em); display/headings fecham (−.03/−.05em).

---

## 4. Espaçamento e layout

Duas escalas, como no PK:

- **Gaps** (dentro de componentes): `4 · 8 · 12 · 16 · 20 · 24 · 32`
  (`--on-gap-1…8`). Padrão dominante: 8/12.
- **Ritmo de seção**: app `24` entre blocos e `48` de respiro de página
  (`--on-space-app`, `--on-space-page`); landing `80 · 120 · 200`
  (`--on-space-land-*`) — os saltos grandes criam o "ar" PK.

**Padding interno — uma regra por contexto** (mata o p-3/4/5/6/8 aleatório):

| Contexto | Token | Valor |
|---|---|---|
| Card padrão | `--on-pad-card` | 20px |
| Item de lista / célula densa | `--on-pad-card-compact` | 12px |
| Card hero / destaque | `--on-pad-hero` | 32px |

**Containers:** app **e** admin usam `--on-container-app` (1152px) com
`padding-block` 48px — um shell, uma métrica (mata o max-w-6xl vs 7xl).
Landing flui até 2560px como o PK.

**Grid:** landing usa 8 colunas (`--pk-grid-cols` herdado); app usa grids
livres do Tailwind, mas gaps só da escala.

---

## 5. Bordas, raios, sombras

- **Sombras: nenhuma.** `shadow-glow` e `shadow-soft` morrem. Elevação =
  plano mais claro (`--on-panel`) ou inversão (`plane-inverse`).
- **Raios: dois.** `0` para blocos, cards, inputs, tabelas, dialogs;
  `pill` (999px) para botões, chips, badges, avatares. `rounded-md/lg/xl/2xl/3xl`
  são remapeados para `0` na ponte Tailwind — o lint pega o resto.
- **Hairline:** `1px` em `--on-hairline` (20% da tinta). Divisores fortes
  usam `--on-hairline-strong` (tinta cheia), como os CTAs de bloco do PK.

---

## 6. Motion

### Tokens

| Token | Valor | Uso |
|---|---|---|
| `--on-ease` | `cubic-bezier(.625,.05,0,1)` | **Assinatura** — entradas, transições |
| `--on-ease-click` | `cubic-bezier(.4,0,.2,1)` | Press |
| `--on-ease-natural` | `cubic-bezier(.32,.12,.2,1)` | Retornos |
| `--on-ease-focus` | `cubic-bezier(.32,.72,0,1)` | Anel de foco |
| `--on-ease-expo-io` | `cubic-bezier(.87,0,.13,1)` | Menus, expansões (accordion, drawer) |
| `--on-ease-expo-out` | `cubic-bezier(.16,1,.3,1)` | Saídas rápidas (toast out) |
| `--on-dur` / `--on-dur-half` / `--on-dur-micro` | `.7s / .35s / .18s` | Landing / app / controles |
| `--on-char-stagger` | `.02s` | Delay por letra (botões) |
| `--on-stagger-item` | `40ms` | Delay por item de lista (máx. 8) |
| Escalas | hover `1.03` app · `1.065` landing · press `.955` | |

### Orçamento de motion por superfície

A regra mais importante: **quanto mais denso o contexto, menos movimento.**

| Superfície | O que anima | O que NÃO anima |
|---|---|---|
| **Landing** | Kit completo PK: reveals once @80%, revelação pixelada em mídia, marquee (prova social/parceiros), grain, parallax sutil, botões letra-a-letra, display com entrada por linha | Nada compete com o herói: um efeito-assinatura por seção |
| **App (aluno)** | Entrada de rota (rise .35s), stagger de listas (40ms, máx. 8), odometer nos KPIs, press/hover em controles, toasts | Coreografia de scroll, parallax, pixel, grain |
| **Admin** | Entrada de rota (fade .35s), press/hover, skeleton | Stagger acima de 6 itens, odometer em tabelas, qualquer efeito de landing |

### Receitas (implementadas em `motion.js` + `motion.css`)

- **`[data-reveal]`** — entrada once a 80% da viewport: rise 24px + fade,
  `.7s` assinatura (landing) / `.35s` (app). Idêntico ao padrão dos 16
  ScrollTriggers `once:true` do PK.
- **`[data-reveal-stagger]`** — cascata de filhos, 40ms/item, teto de 8
  (o resto entra junto — sem "trenzinho" em tabela de 100 linhas).
- **`[data-char-button]`** — fórmula PK verbatim: cada letra rola
  verticalmente com delay `(char − 1) × .02s`. Landing e CTAs hero apenas.
- **`[data-px-reveal]`** — cortina pixelada 25×4 na cor do fundo, delays
  aleatórios 0–.35s, corte seco. Mídia da landing; candidata à transição
  de rota da landing.
- **`[data-odometer]`** — número rola até o valor (ease-out quártico, .7s),
  formatação pt-BR. KPIs do dashboard.
- **`[data-marquee]`** — loop infinito, pausa fora da viewport.
- **`.on-press`** — hover scale + press scale com brightness. Substitui o
  `btn-bounce` atual (mantém o `touch-action: manipulation` que ele tinha).
- **`.on-route-enter`** — transição de rota do app (TanStack: aplicar no
  container ao montar).
- **`.on-skeleton`** — shimmer para estados de carregamento (mata o flash
  de lista vazia).
- **Som:** `playPop` vira camada opcional atrelada ao press (`.on-press`),
  desligada quando `prefers-reduced-motion` ou mute do usuário.

Tudo respeita `prefers-reduced-motion: reduce` (reveals ficam visíveis,
efeitos decorativos somem).

---

## 7. Componentes

Estados obrigatórios em tudo: default / hover / active / **focus-visible**
(anel `--on-focus-ring`) / disabled (opacity .4) / loading quando aplicável.

### Botão (pill — a única curva do sistema)

| Variante | DAY | NIGHT | Uso |
|---|---|---|---|
| **Primário** | tinta `#10150f`, texto luz | **ácido**, texto tinta | 1 por vista |
| **Secundário** | transparente + hairline forte | idem | Ações de apoio |
| **Ghost** | transparente, texto tinta | transparente, texto luz | Barras, tabelas |
| **Destrutivo** | `--on-danger`, texto luz | idem | Confirmado por dialog |

Tamanhos: `44px` padrão / `36px` denso (admin). Padding `.75em 1.25em`.
Micro-interação: `.on-press`. Landing/CTAs hero: + `data-char-button`.
Implementação: variantes CVA sobre o `Button` do shadcn existente — os 123
`<button>` crus migram para ele.

### CTA de bloco (padrão PK)

Largura total, altura alta (min 120px), hairline forte, conteúdo central
uppercase, hover inverte (fundo tinta ↔ texto luz). Uso: "Ver agenda
completa", "Reservar horário" no fim de seções.

### Card / Plano (`plane`)

Fundo `--on-panel`, hairline, raio 0, padding `--on-pad-card`. Variantes:
`plane-hero` (padding 32), `plane-compact` (12), `plane-inverse` (inversão
total — o "card preto" do PK), acento (fundo ácido, tinta — máx. 1 por vista).
Sem hover-lift por padrão; se clicável, `.on-press` (scale, não translateY).

### PageHeader (obrigatório em toda página — mata o caos de H1)

```
[eyebrow] CONTEXTO           ← type-eyebrow (ex.: ADMIN · FINANCEIRO)
[h1]      Título da página   ← type-h1
[small]   Subtítulo opcional ← type-small, fg-muted
```

### KPI / Stat

Eyebrow em cima, número em `type-data` gigante (`--on-fs-1`/`--on-fs-2`),
`[data-odometer]`. Delta positivo = lime/ácido; negativo = clay. Sem ícones
decorativos — o número é o herói (padrão display do PK).

### Formulário

Inputs retos, fundo `--on-panel`, hairline; label = eyebrow acima do campo;
foco = anel ácido (não muda a borda); erro = hairline `--on-danger` + hint
`type-micro`. Altura 44px (36 no admin). Select usa o do kit — nativo
proibido no desktop. Corpo de formulário longo em peso 500.

### Tabela (admin)

Header `type-eyebrow`; células `type-small` + `type-data` para números;
linhas separadas por hairline, hover `--on-wash`; ações em ghost 36px;
selects inline do kit compactos. Empty state: bloco hairline tracejado +
eyebrow + CTA. Skeleton nas 3 primeiras linhas durante fetch.

### Navegação

- **App (aluno):** header 64px, logo `h-10` (o `h-32` atual morre), máx.
  **6 itens** + "Mais" (dropdown: Loja, Indicações, Avaliar prof.) + sino +
  avatar. Ativo = pill ácido. Mobile: drawer com `--on-ease-expo-io`.
- **Admin:** sidebar com grupos titulados por eyebrow — OPERAÇÃO (Dashboard,
  Reservas, Bloqueios, Match Aberto) · AULAS (Planos, Contratos, Termo Padrão,
  Config., Termo de Aceite) · PESSOAS (Alunos, Leads, Avaliações, Feedbacks,
  Equipe, Dados dos Coaches) · NEGÓCIO (Financeiro, Operadoras, Gamificação,
  Indicações, Loja) · SISTEMA (Configurações, Pitch). Item ativo = pill.
- **Landing:** nav PK — barra fixa, hairline embaixo, links `type-small`,
  inversão de cor por seção via callback de scroll.

### Badge / Chip

Pill, `type-micro` CAPS. Status: pago = lime/ácido · pendente = clay ·
cancelado = fg-muted · confirmada = hairline + tinta. Fundo chapado ou
hairline — sem `/20` translúcidos variados.

### Dialog / Drawer

Reto, hairline forte, backdrop `rgba(11,18,12,.6)`. Entrada: rise 16px +
fade `.35s` assinatura; saída `--on-ease-expo-out`. Título `type-h2`.
Confirmação destrutiva: botão destrutivo + secundário (nunca dois cheios).

### Toast

Reto, `plane-inverse` (contraste máximo), texto `type-small`, hairline do
acento semântico à esquerda (3px). Entra com rise, sai com expo-out.

### Calendário (agenda/reservas)

Células retas com hairline; dia atual = anel hairline forte; selecionado =
célula ácida com tinta; ocupado = wash + `type-micro`; bloqueado = hachura
diagonal `--on-ink-10`. Contagem de reservas: chip pill micro.

---

## 8. Leis de consistência (lint social)

1. Título de página = `PageHeader`. Sem exceção.
2. Nenhum tamanho de fonte fora dos 8 papéis; piso 12px.
3. Padding de card: 12/20/32. Escolha um, não invente.
4. Raio: 0 ou pill. Nada entre.
5. Sombra: nenhuma.
6. Um acento por vista (estados funcionais não contam).
7. Botão/input sempre do kit — `<button>`/`<input>`/`<select>` crus proibidos em rotas.
8. Toda entrada de lista/página usa os padrões de motion do DS — nunca animação ad-hoc.
9. `focus-visible` em tudo (o token base já dá — não sobrescrever com `outline: none`).
10. Mensagem de erro para humanos em PT-BR — nunca `error.message` cru do Supabase.

---

## 9. Migração (mapa do código atual → DS)

| Hoje (auditoria) | Vira |
|---|---|
| `text-3xl font-bold` / `text-2xl font-bold` (H1s) | `<PageHeader>` (`type-h1`) |
| 20+ variantes de H2 | `type-h2` / `type-eyebrow` |
| `text-[8px]`–`text-[11px]` | `type-micro` (12px) |
| `rounded-xl/2xl/3xl border bg-card p-*` manual | `plane` / `plane-hero` / `plane-compact` |
| `shadow-glow` / `shadow-soft` | remover (inversão/panel dá a ênfase) |
| `btn-bounce` + classes manuais | `Button` do kit + `.on-press` (+ `data-char-button` na landing) |
| `<select>` nativo no admin | `Select` do kit (denso, 36px) |
| `animate-float-in` | `.on-route-enter` / `[data-reveal]` |
| Logo `h-28`/`h-32` no header do app | `h-10`, header 64px |
| Nav do aluno com 10 itens (estoura em 1280px) | 6 itens + menu "Mais" |
| Sidebar admin flat (19 itens) | 5 grupos com eyebrows |
| `max-w-6xl py-8` vs `max-w-7xl py-6` | `page-app` (1152px / 48px) |
| `ThemeToggle` (morto/no-op) | remover — DAY/NIGHT por contexto |
| Fredoka + Quicksand | Archivo variável (700/500) |
| Gradientes radiais `hero-bg` | fundos chapados; textura = grain (landing) |

**Ordem sugerida** (espelha a seção 6 do `animacoes.md` do PK):

1. Tokens + ponte Tailwind (`styles.css` importa os dois; apagar o `@theme` antigo).
2. Archivo self-hosted; `PageHeader`; variantes do `Button`.
3. Shells (headers, sidebar agrupada, `page-app`) — maior impacto visível.
4. Motion runtime no app (`OnMotion.scan` no mount da rota) + `.on-press`.
5. Migração tela a tela (admin denso primeiro — é onde a consistência mais paga).
6. Landing por último, com o kit completo (pixel reveal, marquee, grain, char-buttons).

---

## 10. Acessibilidade

- Contraste: tinta sobre saibro-cinza = ~13:1; luz sobre tinta = ~17:1;
  tinta sobre ácido = ~12:1. Nunca acento sobre acento; `fg-muted` (60%)
  apenas em texto ≥14px.
- Foco visível universal (token base), navegação 100% por teclado nos
  componentes do kit.
- Piso tipográfico 12px; alvos de toque 44px (36px só no admin desktop).
- `prefers-reduced-motion` cobre todo o runtime.
- Botões só-ícone exigem `aria-label` (o `data-char-button` já preserva o
  rótulo automaticamente).
