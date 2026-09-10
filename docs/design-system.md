# Design System — "Ordens"

Direção: SaaS B2B premium, TMS moderno, tecnológico e elegante. Denso sem ser poluído. Roxo/violeta como identidade usada **estrategicamente** (ação primária, seleção, foco, navegação), neutros frios para superfícies.

Fonte de verdade: `packages/ui/src/styles/tokens.css` (CSS custom properties) mapeada no `@theme` do Tailwind 4. Nenhum componente usa cor literal.

## Cores (tokens semânticos)

| Token | Light | Dark | Uso |
|---|---|---|---|
| `--bg` | `#F5F5F8` | `#0A0A11` | fundo da aplicação |
| `--surface` | `#FFFFFF` | `#12121B` | cards, tabelas, drawer |
| `--surface-2` | `#F0EFF5` | `#191825` | cabeçalho de tabela, inputs, hover |
| `--surface-3` | `#E8E6F0` | `#221F31` | elementos elevados/selecionados |
| `--border` | `#E3E1EB` | `#26243A` | bordas suaves (usar pouco) |
| `--border-strong` | `#CFCCDB` | `#353249` | divisores relevantes |
| `--text` | `#15131F` | `#ECEAF4` | texto principal |
| `--text-muted` | `#5F5B73` | `#A19DB5` | secundário (≥ 4.5:1 sobre surface) |
| `--text-subtle` | `#8A86A0` | `#77738C` | placeholders, metadados |
| `--primary` | `#6D28D9` | `#9F7AEA` | ação primária, foco, seleção |
| `--primary-hover` | `#5B21B6` | `#B196F0` | |
| `--primary-fg` | `#FFFFFF` | `#0F0A1E` | texto sobre primary |
| `--primary-soft` | `#EFE9FC` | `#231A3D` | fundo de item ativo, badges |
| `--accent` (indigo) | `#4F46E5` | `#818CF8` | gráficos, links secundários |
| `--success` | `#047857` | `#34D399` | |
| `--success-soft` | `#E3F5EE` | `#0F2A22` | |
| `--warning` | `#B45309` | `#FBBF24` | |
| `--warning-soft` | `#FDF1E2` | `#2E2210` | |
| `--danger` | `#BE123C` | `#FB7185` | |
| `--danger-soft` | `#FCE8EE` | `#321520` | |
| `--info` | `#0369A1` | `#38BDF8` | |
| `--info-soft` | `#E4F2FA` | `#0E2533` | |
| `--nav-bg` | `#1B1033` | `#0E0A1A` | sidebar roxo profundo |
| `--nav-fg` | `#D9D2EE` | `#C9C2DE` | |
| `--nav-active` | `#2E1C55` | `#1F1638` | |
| `--ring` | `#8B5CF6` | `#A78BFA` | focus-visible |

Dark mode tem **tokens próprios** (não inversão). Contraste validado WCAG AA para texto e 3:1 para ícones e bordas de controles.

## Tipografia

- **Inter** (UI) com `font-feature-settings: "cv11","ss01","tnum"` em números; **JetBrains Mono** para códigos (nº OC, chave NF-e, placas).
- Escala: `xs 12/16`, `sm 13/20` (padrão de tabelas), `base 14/22` (padrão UI), `md 16/24`, `lg 18/26`, `xl 22/30`, `2xl 28/36`, `3xl 34/42`.
- Pesos: 400, 500 (labels), 600 (títulos), 700 (KPIs).
- Números sempre tabulares e alinhados à direita em tabelas.

## Espaçamento, raio, sombra

- Grid base 4 px: `1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40, 12=48`.
- Raio: `sm 6`, `md 8` (inputs, botões), `lg 12` (cards), `xl 16` (drawer, modais), `full` (badges/avatares).
- Sombra (light): `xs 0 1px 2px rgb(20 16 40 / .05)`, `sm 0 1px 3px rgb(20 16 40 / .08), 0 1px 2px rgb(20 16 40 / .04)`, `lg 0 12px 32px -8px rgb(20 16 40 / .18)`, `drawer -24px 0 64px -12px rgb(20 16 40 / .28)`. Dark: sombras mais profundas + borda `--border` para separar planos.

## Motion

| Token | Valor | Uso |
|---|---|---|
| `--dur-fast` | 120 ms | hover, pressed |
| `--dur-base` | 200 ms | dropdowns, tabs, tooltips |
| `--dur-slow` | 320 ms | drawer, page transition |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | entradas |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | trocas |

Drawer: spring `stiffness 380, damping 38`. Contadores KPI animam ≤ 600 ms. `prefers-reduced-motion: reduce` → durações 0, sem transform, mantém opacidade.

## Componentes base

`Button` (primary, secondary, ghost, outline, danger; sm/md/lg; loading) · `IconButton` · `Input`, `Textarea`, `NumberInput` (decimal pt-BR, sem float) · `Select` (lista curta) · `Combobox` assíncrono (debounce 250 ms, paginação infinita, teclado, estado vazio, "filtrado por…") · `DatePicker`, `DateRange` · `Checkbox`, `Switch`, `RadioGroup` · `Badge`, `StatusBadge` (ícone + texto) · `Farol` · `Card`, `KpiCard` · `Tabs` · `Tooltip` · `DropdownMenu`, `ContextMenu` · `Dialog`, `Drawer`, `Sheet` · `Toast` · `DataGrid` · `EmptyState` · `Skeleton` · `Progress` · `UploadDropzone`, `UploadQueue` · `Timeline` · `CommandPalette` · `Avatar` · `Kbd` · `SectionHeader` · `FormSection`.

## Regras

1. Status sempre com **ícone + texto + cor**; nunca cor isolada.
2. Bordas com parcimônia: separar planos com superfície e sombra, não com linhas em tudo.
3. Inputs com fundo `--surface-2`, sem borda pesada; foco com ring violeta 2 px.
4. Densidade: linhas de tabela 40 px (confortável) / 32 px (compacta), selecionável.
5. Roxo não é fundo de página; é sinal.
6. Toda tela passa pela pergunta: **"Isso parece um SaaS/TMS premium de 2026 ou um CRUD administrativo?"**
