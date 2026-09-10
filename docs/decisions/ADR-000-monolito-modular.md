# ADR-000 — Monólito modular + worker

**Status**: Aceito · 2026-09-10

## Contexto
MVP com equipe pequena, domínio ainda em descoberta, necessidade de transações que cruzam ordem, liberação, auditoria e outbox.

## Decisão
Um processo NestJS (API) organizado em módulos com fronteiras explícitas, um processo worker (BullMQ) e o web Next.js. Um único PostgreSQL. Sem microsserviços nem Kubernetes no MVP; Docker Compose em dev e imagens OCI para qualquer orquestrador em produção.

## Consequências
+ Transações ACID simples entre agregados; deploy e depuração simples.
+ Outbox e módulos com interfaces permitem extração futura.
− Escala vertical/horizontal do monólito inteiro; aceitável para o volume previsto.
