# ADR-009 — Stack, ORM e tipos numéricos

**Status**: Aceito · 2026-09-10

## Decisão
- **TypeScript 5.9.3** (não 7.x): o compilador nativo 7 ainda não oferece a API/`emitDecoratorMetadata` usada pelo ecossistema NestJS/Swagger.
- **NestJS 12** (ESM, `module: nodenext`), build com SWC em dev e `tsc` para typecheck/produção.
- **Prisma 7** com `@prisma/adapter-pg`: schema declarativo + SQL cru nas migrations para RLS, grants, triggers e índices parciais/trigram. Prisma foi mantido por produtividade e tipagem; consultas analíticas pesadas usam `$queryRaw` tipado.
- **Zod 4** em `@ordens/contracts`, compartilhado entre web, API e worker.
- Quantidades `numeric(18,4)`, valores `numeric(18,2)`, preços `numeric(18,6)`; `Prisma.Decimal`/`decimal.js` no código; **serializados como string** na API; o front formata com `Intl.NumberFormat` sem converter para float em cálculos.
- Next.js 16 + React 19 + Tailwind 4 + Radix + Motion + TanStack Query/Table.
