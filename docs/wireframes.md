# Wireframes

## App shell (desktop)

```
┌────────┬───────────────────────────────────────────────────────────────────────────────┐
│ ◆ Ordens│ Operação / Ordens de Carregamento      [🔍 Buscar OC, placa, NF-e…  ⌘K] [+ ▾] 🔔 ☾ ? (AM)│
│         ├───────────────────────────────────────────────────────────────────────────────┤
│ ◎ Visão │                                                                               │
│ ▾ Operação                                                                              │
│   ▌Ordens│                          (conteúdo da página)                                 │
│   Liberações                                                                            │
│   Agendam.                                                                              │
│   Cargas │                                                                              │
│   Ocorr. │                                                                              │
│ ▸ Documentos                                                                            │
│ ▸ Comercial                                                                             │
│ ▸ Cadastros                                                                             │
│ ▸ Gestão │                                                                              │
│ ─────── │                                                                               │
│ Agro Demo ▾ (tenant/org)                                                                │
│ «  recolher                                                                             │
└────────┴───────────────────────────────────────────────────────────────────────────────┘
```

Sidebar em `--nav-bg` (roxo profundo); recolhida = 64 px com tooltips.

## Central de Ordens

```
Ordens de Carregamento                                             [Exportar] [+ Nova Ordem]
┌────────────┬────────────┬────────────┬────────────┬────────────┬────────────┐
│ Abertas 128│ Liberado   │ Carregado  │ Em trânsito│ Não visual.│ Atrasadas  │
│ ▲ 12 semana│ 18.420 t   │ 9.310 t    │ 1.204 t    │ ● 8        │ ▲ 4        │
│ ▁▂▃▅▆▇     │ ▓▓▓▓░░ 62% │ ▓▓▓░░ 51%  │            │ Fazenda 5  │            │
└────────────┴────────────┴────────────┴────────────┴────────────┴────────────┘
Views: [Todas] [Minhas abertas] [Aguardando Fazenda] [Não visualizadas 8] [Esta semana] [+ view]
[🔍 Buscar nesta lista]  [Status ▾] [Commodity ▾] [Vendedor ▾] [Comprador ▾] [Período ▾] [⚙ Filtros] [☰ Colunas] [Densidade]
┌──┬───────────┬────────┬─────────────┬────────┬─────────────────┬───────────┬──────────────────────────────┬──────┬──────┬──┐
│☐ │ OC        │ Status │ Commodity   │Vendedor│ Fazenda         │ Comprador │ Quantidade  Lib. Carr. Receb │Faz.  │Comp. │⋯ │
├──┼───────────┼────────┼─────────────┼────────┼─────────────────┼───────────┼──────────────────────────────┼──────┼──────┼──┤
│☐ │ 2026/00125│●Public.│ 🌽 Milho    │J. Silva│ Faz. Primavera  │ Coop. ABC │ 1.000 t ▓▓▓▓▓▓▒▒░░░░ 300/120/80│👁 Atual│⚠ v3 │⋯ │
│  │ ext 88121 │        │ Safra 25/26 │        │ Rio Verde · GO  │           │ saldo 700 t · R$ 1,25 mi     │      │      │  │
└──┴───────────┴────────┴─────────────┴────────┴─────────────────┴───────────┴──────────────────────────────┴──────┴──────┴──┘
Mostrando 1–50 de 1.284                                           ‹ 1 2 3 … 26 ›   50/página
```

A barra de progresso segmentada (liberado / agendado / carregado / recebido sobre total) permite entender a OC sem abrir.

Seleção múltipla → barra flutuante de ações em lote. Clique na linha → **Quick View** lateral (420 px); duplo clique/Enter → detalhe.

## Drawer Nova Ordem (760–960 px; até 45% em telas ≥ 1920; full-screen < 768)

```
┌──────────────────────────────────────────────────────────────┐
│ Nova Ordem de Carregamento                       ✕          │
│ Rascunho • ● Salvando…                                        │
│ [Identificação][Comercial][Quantidades][Logística][Docs][Obs]│  ← âncoras (scrollspy)
├──────────────────────────────────────────────────────────────┤
│ IDENTIFICAÇÃO                                                │
│ Nº Ordem          Data             Prioridade                │
│ [Automático]      [10/09/2026]     [ Normal ▼ ]             │
│                                                              │
│ COMERCIAL                                                    │
│ Contrato                                                     │
│ [ 🔍 Pesquisar contrato................................. ]   │
│ Vendedor                         Comprador                   │
│ [ 🔍 João Silva              ]  [ 🔍 Cooperativa ABC     ]  │
│ Fazenda                          Commodity                   │
│ [ 🔍 Fazenda Primavera       ]  [ Milho ▼                ]  │
│    ↳ filtrada por João Silva                                 │
│                                                              │
│ QUANTIDADES E VALORES                                        │
│ Quantidade   Unidade    Preço/t      Valor estimado          │
│ [ 500,000 ]  [ t ▼ ]    [ 1.250 ]    R$ 625.000,00           │
│                                                              │
│ LOGÍSTICA                                                    │
│ Período carregamento        Transportadora preferencial      │
│ [ 15/09 — 30/09 ]           [ 🔍 Pesquisar...            ]  │
│ Quantidade inicial liberada                                  │
│ [ 150,000 t ]                                                │
│                                                              │
│ DOCUMENTOS E INSTRUÇÕES                                      │
│ [ Arraste arquivos ou clique para selecionar ]               │
│ Observações Fazenda                                          │
│ [.........................................................]  │
├──────────────────────────────────────────────────────────────┤
│ Último salvamento 08:41   [Cancelar] [Salvar rascunho] [Publicar OC] │
└──────────────────────────────────────────────────────────────┘
```

Regras: alteração de Vendedor com Fazenda incompatível → Fazenda é limpa **com aviso inline** ("Fazenda Primavera não pertence a Maria Souza — selecione novamente"), nunca silenciosamente. ESC/fechar com alterações não salvas → confirmação. Atalhos: `Ctrl+S` salvar rascunho, `Ctrl+Enter` publicar.

## Quick View

```
┌──────────────────────────────────────┐
│ OC 2026/00125  ●Publicada  v3     ✕ │
│ Milho · 1.000 t · R$ 1,25 mi         │
│ ▓▓▓▓▓▓▒▒░░░░  Lib 300 · Carr 120    │
│ Fazenda  👁 Versão atual (Ana, 09:12)│
│ Comprador ⚠ Visualizou v2           │
│ ── Pendências ──                     │
│ ⚠ 2 cargas sem NF-e                  │
│ ── Últimos eventos ──                │
│ • Liberação 02 · 150 t · ontem       │
│ • Carga 004 em trânsito · 2h         │
│ [Abrir detalhes →]                    │
└──────────────────────────────────────┘
```

## Detalhe da OC

Cabeçalho com número, status, versão, faróis e ações (Nova liberação, Editar, Publicar alterações, Cancelar). Abaixo, grid 2 colunas: esquerda tabs (Resumo · Liberações · Agendamentos · Cargas · Documentos · Versões · Auditoria); direita coluna fixa com quantidades (funil), partes envolvidas e timeline.

## Dashboard Matriz

```
Boa tarde, Antonio                                      [Hoje ▾] [Todas commodities ▾]
┌ Precisa da sua atenção ─────────────────────────────────────────────────────┐
│ ⚠ 8 OCs não visualizadas pela Fazenda  → │ ✕ 3 XMLs rejeitados → │ ⏱ 4 cargas atrasadas → │
│ ▲ 2 OCs acima da tolerância → │ 🚚 5 agendamentos sem transportadora → │ 📄 6 documentos pendentes → │
└─────────────────────────────────────────────────────────────────────────────┘
[KPIs: abertas | publicadas hoje | aguardando visualização | contratado | liberado | carregado | trânsito | recebido | saldo | valor]
┌ Funil de volume (contratado→liberado→agendado→carregado→recebido) ┐ ┌ Cargas hoje (timeline por hora) ┐
┌ Evolução diária/semanal (área)                                   ┐ ┌ Por commodity (barras)           ┐
┌ Top fazendas | compradores (tabela compacta com sparkline)       ┐ ┌ Performance transportadoras      ┐
```

## Mobile

- Sidebar vira bottom sheet/menu; header compacto.
- Grid de ordens vira **lista de cards** com colunas prioritárias (OC, status, commodity, fazenda, barra de progresso, faróis) e expansão para detalhes.
- Drawer ocupa 100% com rodapé fixo.
