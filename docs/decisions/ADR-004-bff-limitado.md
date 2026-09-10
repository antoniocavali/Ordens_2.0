# ADR-004 — Next.js como BFF limitado

**Status**: Aceito · 2026-09-10

## Decisão
- Browser chama `/api/*` na mesma origem do web; Next.js faz **rewrite** para a API. Cookies first-party, sem CORS no browser.
- O BFF **não** contém regra de negócio nem autorização (a API decide).
- **Uploads pesados não passam pelo BFF**: browser ↔ S3/MinIO via presigned URLs.
- **SSE/WebSockets** (fase de tempo real) usarão rota dedicada no reverse proxy/ingress (ex.: `/realtime/*` → API), sem depender do rewrite do Next.js, que não é adequado para conexões longas em todos os runtimes.
- Server Components podem chamar a API internamente repassando o cookie da requisição.

## Consequências
+ Simplicidade de cookies/CSRF; API continua utilizável por integrações.
− Em produção o ingress precisa rotear `/realtime` e, opcionalmente, `/api` direto para a API.
