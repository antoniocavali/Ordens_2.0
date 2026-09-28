# Mapa de Navegação

## Matriz

```
Visão Geral                         /                     (Central de Controle + "Precisa da sua atenção")
Operação
  ├─ Ordens de Carregamento         /ordens               (grid TMS + Drawer Nova Ordem + Quick View)
  │    └─ Detalhe da OC             /ordens/[id]          (resumo, quantidades, faróis, timeline, cargas, docs)
  ├─ Liberações                     /liberacoes
  ├─ Agendamentos                   /agendamentos         (lista | dia | semana | calendário)
  ├─ Cargas                         /cargas
  └─ Ocorrências                    /ocorrencias
Documentos
  ├─ Central de Documentos          /documentos
  ├─ Notas Fiscais                  /documentos/nfe
  └─ Pendências                     /documentos/pendencias
Comercial
  ├─ Contratos                      /contratos
  └─ Commodities                    /commodities
Cadastros
  ├─ Compradores                    /cadastros/compradores
  ├─ Vendedores                     /cadastros/vendedores
  ├─ Fazendas                       /cadastros/fazendas
Gestão
  ├─ Relatórios                     /gestao/relatorios
  ├─ Auditoria                      /gestao/auditoria
  └─ Usuários                       /gestao/usuarios
Configurações
  ├─ Workflow                       /configuracoes/workflow
  ├─ Notificações                   /configuracoes/notificacoes
  ├─ Segurança                      /configuracoes/seguranca     (política 2FA do tenant)
  └─ Preferências                   /configuracoes/preferencias
Conta (menu do avatar)
  └─ Minha segurança                /conta/seguranca             (senha, 2FA, sessões, histórico)
```

## Fazenda

```
Início            /            (novas ordens, atualizadas, liberações, próximos carregamentos, alertas)
Ordens            /ordens      (somente OCs publicadas vinculadas à organização)
Agendamentos      /agendamentos
Cargas            /cargas
Documentos        /documentos
```

## Comprador (read-only)

```
Início            /            (volumes, saldo, previsões, timeline, ocorrências relevantes)
Ordens            /ordens
Cargas            /cargas
Documentos        /documentos  (somente autorizados)
```

## Rotas públicas

```
/login  /login/2fa  /recuperar-senha  /redefinir-senha?token=…  /convite?token=…
```

## Elementos globais

- **Sidebar** recolhível (ícone + texto / ícones com tooltip), itens filtrados por permissão (apenas UX — a API sempre valida).
- **Header**: breadcrumb, busca global (Ctrl/Cmd+K), criação rápida, notificações, tema, ajuda, avatar, seletor de tenant/organização.
- **Command Palette** (Ctrl/Cmd+K): navegação, ações ("Nova Ordem"), busca futura por OC, contrato, placa, NF-e, motorista.
