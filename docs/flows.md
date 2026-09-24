# Fluxos Operacionais

## Visão geral (Q41)

```mermaid
flowchart LR
  B[Comprador cria solicitação] --> S[Envia ao Faturamento<br/>PENDING_BILLING]
  S --> F[Faturamento complementa dados<br/>define vendedor e fazenda]
  F --> P[Publica para a Fazenda<br/>PUBLISHED]
  M[Matriz cria ordem interna] --> P
  P --> A[Fazenda agenda e registra chegada<br/>CHECKED_IN]
  A --> C[Carga criada → carregamento → pesagem]
  C --> D[PDF + XML da NF-e<br/>documentação validada]
  D --> T[Trânsito → recebimento → conferência<br/>faturamento Matriz → conclusão]
```

## Comprador

```mermaid
flowchart TD
  A[+ Nova solicitação: formulário do portal] --> B[Commodity, quantidade, unidade, janela,<br/>destino, frete, transporte digitado, observações]
  B --> C{Salvar rascunho}
  C -->|editar| B
  C --> D[Enviar ao Faturamento]
  D --> E[audit order.submitted + outbox → aviso ao Faturamento]
  E --> F[Acompanha: Aguardando faturamento — somente leitura]
  F --> G[Notificação: ordem publicada]
  G --> H[Acompanha volumes, cargas, NF-e válidas e timeline]
```

- O comprador da ordem é **derivado da organização ativa** (`organizations.partner_id`); o payload do portal é estrito e recusa vendedor, fazenda, contrato, preço e campos internos.
- Rascunho é visível e editável **só por quem criou**; após o envio, o Comprador apenas acompanha.
- O transporte (transportadora, motorista e veículos) é digitado pelo próprio Comprador e é **opcional** no envio; exigidos para enviar: commodity, quantidade, unidade e janela. O agendamento de cada carga nasce com esse transporte e pode corrigi-lo na portaria.
- **Devolvida pelo Faturamento**: volta a rascunho com o motivo em destaque (notificação a quem criou); o Comprador ajusta e reenvia.
- **Cancelar solicitação** (motivo obrigatório): no rascunho ou depois de enviada, **enquanto a fazenda não foi definida**; depois disso, só a Matriz. `POST /orders/:id/buyer-cancel`.
- Endpoints próprios: `POST /orders/buyer`, `PATCH /orders/buyer/:id`, `POST /orders/:id/submit` (permissão `order.submit`).

## Faturamento da Matriz

```mermaid
flowchart TD
  A[Notificação / fila Aguardando faturamento] --> B[Abre a solicitação]
  B --> C[Definir fazenda: contrato opcional → vendedor → fazenda<br/>preço, tolerância, instruções, observações]
  C --> D[audit order.farm_assigned — continua PENDING_BILLING]
  D --> E[Publicar para a Fazenda]
  E --> F{Valida requisitos, relações, contrato e saldo}
  F -->|ok| G[Versão 1 + audit order.published via BILLING + outbox]
  G --> H[Notificações Fazenda e Comprador]
```

- Permissão `order.billing.manage` (papel **Faturamento**, Gestor e Administrador): `POST /orders/:id/billing/assign`, `POST /orders/:id/billing/publish` e `POST /orders/:id/billing/return` (devolver ao Comprador com motivo; descarta a análise).
- Publicação pelo Faturamento não passa pela dupla checagem da Q40.
- Correções adicionais usam o formulário interno (`order.update`); o comprador de uma solicitação do portal não pode ser trocado.
- A Matriz mantém suspensão, cancelamento, liberações, correções e auditoria.

## Matriz (ordem interna)

```mermaid
flowchart TD
  A[Contrato ativo] --> B[+ Nova Ordem: Drawer]
  B --> C{Autosave rascunho}
  C --> D[Selecionar contrato → filtra vendedor, comprador, commodity]
  D --> E[Vendedor → filtra fazendas]
  E --> F[Quantidade, preço, janela, transporte digitado]
  F --> G[Liberação inicial opcional]
  G --> H[Publicar ou Solicitar publicação Q40]
  H --> I[Versão 1 + audit + outbox order.published]
  I --> J[Notificações Fazenda e Comprador]
  J --> K[Acompanhar faróis e exceções]
  K --> L[Novas liberações parciais]
  L --> M[Agendamentos / Cargas]
  M --> N[Recebimento, conferência, faturamento Matriz]
  N --> O[Conclusão da OC]
  K -->|alteração material| P[Nova versão → faróis amarelos]
```

## Fazenda

```mermaid
flowchart TD
  A[Notificação: ordem publicada para a fazenda] --> B[Abre detalhe → farol verde]
  B --> C[Consulta liberações e saldo liberado]
  C --> D[Agendamento: confirmar motorista e veículo]
  D --> E[Veículo chegou: CHECKED_IN]
  E --> F[Carga criada: Aguardando carregamento]
  F --> G[Em carregamento]
  G --> H[Confirmar carregamento: peso bruto e tara obrigatórios]
  H --> I[Aguardando documentação fiscal]
  I --> J[Anexar PDF da nota + XML da NF-e na carga<br/>upload direto, visibilidade PARTIES]
  J --> K[Worker valida XML → NF-e VALID/DIVERGENT]
  K --> L[Validar documentação fiscal]
  L --> M[Liberar para transporte]
```

- A Fazenda **não enxerga** ordens em rascunho, aguardando faturamento ou sem fazenda definida (RLS).
- "Validar documentação fiscal" e "Liberar para transporte" exigem pesagem, PDF disponível e o XML mais recente processado com NF-e válida ou com divergência; qualquer arquivo em envio/processamento, rejeitado ou infectado bloqueia (`FISCAL_DOCUMENTS_REQUIRED`).
- A Fazenda **não cria nem altera** ordens.

## Autenticação

```mermaid
sequenceDiagram
  participant U as Usuário
  participant A as API
  U->>A: POST /auth/login (email, senha)
  A->>A: rate limit + lockout progressivo
  alt senha inválida
    A-->>U: 401 genérico (sem revelar existência)
  else 2FA ativo ou exigido
    A-->>U: cookie sessão PENDING_2FA (5 min)
    U->>A: POST /auth/2fa/verify (TOTP ou recovery code)
    A-->>U: rotaciona sessão → ACTIVE
  else sem 2FA e política exige
    A-->>U: sessão PENDING_2FA_SETUP → força ativação
  end
```
