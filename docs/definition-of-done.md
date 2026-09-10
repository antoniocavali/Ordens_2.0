# Definição de Pronto

Uma funcionalidade **não** está pronta porque a API responde ou porque existe uma tela. Está pronta quando todos os itens abaixo estão completos:

- [ ] **Domínio**: regras explícitas, estados via máquina de estados, decimais corretos, sem regra comercial inventada (dúvidas em `open-questions.md`).
- [ ] **Permissão**: `@RequirePermission()` em todos os endpoints; catálogo atualizado em `@ordens/contracts`; matriz em `docs/permissions.md`.
- [ ] **Isolamento**: tabela com `tenant_id` + RLS (tenant e organização quando aplicável); testes negativos rodando como `ordens_app`.
- [ ] **Auditoria**: alterações relevantes gravam `audit_events` (e versão/outbox quando aplicável) na mesma transação.
- [ ] **Erros**: erros de domínio com código estável e mensagem amigável; nada de stack/SQL para o usuário; detalhes em log estruturado.
- [ ] **UX**: estados de loading, vazio, erro e sucesso; teclado e ARIA; dark/light; responsivo; `prefers-reduced-motion`; revisão "parece TMS premium 2026?".
- [ ] **Testes**: unitários do domínio, integração da API (permissão + isolamento), E2E Playwright para fluxos críticos.
- [ ] **Docs**: OpenAPI atualizado; docs de arquitetura alteradas quando o desenho mudou.
- [ ] **CI verde**: lint, typecheck, testes, build, docker build, scans.
