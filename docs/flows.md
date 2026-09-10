# Fluxos Operacionais

## Matriz

```mermaid
flowchart TD
  A[Contrato ativo] --> B[+ Nova Ordem: Drawer]
  B --> C{Autosave rascunho}
  C --> D[Selecionar contrato → filtra vendedor, comprador, commodity]
  D --> E[Vendedor → filtra fazendas]
  E --> F[Quantidade, preço, janela, transportadora preferencial]
  F --> G[Liberação inicial opcional]
  G --> H[Publicar]
  H --> I[Versão 1 + audit + outbox order.published]
  I --> J[Notificações Fazenda e Comprador]
  J --> K[Acompanhar faróis e exceções]
  K --> L[Novas liberações parciais]
  L --> M[Agendamentos / Cargas]
  M --> N[Recebimento, conferência, faturamento Matriz]
  N --> O[Conclusão da OC]
  K -->|alteração material| P[Nova versão → faróis amarelos]
```

Pontos de decisão:

- Publicar exige validações de consistência (fazenda pertence ao vendedor; contrato compatível com vendedor/comprador/commodity; saldo contratual suficiente — **regra de bloqueio vs. alerta em aberto**, ver [open-questions.md](decisions/open-questions.md)).
- Alteração material após publicação gera nova versão e exige nova visualização.

## Fazenda

```mermaid
flowchart TD
  A[Notificação: nova OC / nova versão] --> B[Abre detalhe da OC]
  B --> C[Registro de visualização: farol verde]
  C --> D[Consulta liberações e saldo liberado]
  D --> E[Cria/confirma agendamento]
  E --> F[Carga: em carregamento]
  F --> G[Upload XML NF-e direto no storage]
  G --> H[Worker extrai dados → vincula carga]
  H --> I[Faturada pela Fazenda → Carregada]
```

A Fazenda **não cria nem altera** OCs.

## Comprador (read-only)

```mermaid
flowchart TD
  A[Notificação: OC publicada] --> B[Abre detalhe → farol verde]
  B --> C[Acompanha volumes: carregado, em trânsito, recebido, saldo]
  C --> D[Timeline e ocorrências relevantes]
  D --> E[Documentos autorizados: presigned GET auditado]
```

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
