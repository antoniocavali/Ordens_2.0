# Mapa de Navegação

## Matriz

```
Visão Geral                         /                     (Central de Controle + "Precisa da sua atenção")
Operação
  ├─ Ordens de Carregamento         /ordens               (grid TMS + Drawer Nova Ordem + Quick View)
  │    └─ Detalhe da OC             /ordens/[id]          (resumo, quantidades, faróis, timeline, cargas, docs;
  │                                                        "Informar chegada do caminhão" cria a carga; ?carga=<id> abre uma)
  └─ Ocorrências                    /ocorrencias
Documentos
  ├─ Central de Documentos          /documentos
  ├─ Notas Fiscais                  /documentos/nfe
  └─ Pendências                     /documentos/pendencias
Comercial
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
Início            /            (novas ordens, atualizadas, caminhões na fazenda, alertas)
Ordens            /ordens      (somente OCs publicadas vinculadas à organização; cargas dentro de cada ordem)
Documentos        /documentos
```

## Comprador (read-only)

```
Início            /            (volumes, saldo, previsões, timeline, ocorrências relevantes)
Ordens            /ordens      (cargas dentro de cada ordem)
Documentos        /documentos  (somente autorizados)
```

## Rotas públicas

```
/login  /login/2fa  /recuperar-senha  /redefinir-senha?token=…  /convite?token=…
/apresentacao      apresentação institucional (sem login; link na tela de entrada)
```

## Ajuda (todos os perfis, com login)

```
Guia de uso        /guia             (capítulos por tipo de usuário; destaca o perfil de quem está logado)
                   /guia/<perfil>    (passo a passo, com capturas de tela)
```

**Primeiro acesso:** com a conta liberada (depois da troca de senha e da 2FA, se exigidas), a pessoa é levada uma
única vez ao capítulo do próprio papel (`/guia/<perfil>?boas-vindas=1`). A marca fica na conta
(`user_preferences.data.guideSeenAt`, gravada por `POST /me/guide-seen`), não no navegador. As contas do seed de
demonstração já nascem marcadas.

O texto do guia fica em `apps/web/src/features/guide/guide-content.ts` e o roteiro da apresentação em
`presentation-content.ts`. As capturas (`apps/web/public/guia/*.webp`) são geradas contra o ambiente local de
demonstração:

```
cd apps/web
E2E_PASSWORD=<senha demo> WEB_URL=http://localhost:3020 npx playwright test --config playwright.guia.config.ts
```

Ao mudar uma tela ou uma regra, ajuste o texto e gere as capturas de novo. Um teste unitário falha se o guia
citar uma captura que não existe ou se um papel de Matriz, Fazenda ou Comprador ficar sem capítulo.

## Elementos globais

- **Sidebar** recolhível (ícone + texto / ícones com tooltip), itens filtrados por permissão (apenas UX — a API sempre valida).
- **Header**: breadcrumb, busca global (Ctrl/Cmd+K), criação rápida, notificações, tema, ajuda (abre o Guia de uso), avatar, seletor de tenant/organização.
- **Command Palette** (Ctrl/Cmd+K): navegação, ações ("Nova Ordem"), busca futura por OC, contrato, placa, NF-e, motorista.
