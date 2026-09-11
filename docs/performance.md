# Desempenho

## Metodologia

- Massa de dados no banco `ordens_test` (nunca no banco de desenvolvimento): ordens publicadas do tenant demo clonadas até **14 mil ordens, 42 mil cargas, 127 mil eventos de histórico, 27 mil agendamentos, 44 mil NF-e, 4,5 mil ocorrências e 14 mil documentos**, todas concentradas em 30 dias (~1.400 cargas/dia em um tenant — cenário deliberadamente extremo).
- Segunda instância da API apontando para `ordens_test` com a role de runtime `ordens_app` (RLS ativo, sem bypass).
- 12 endpoints × 3 perfis (Matriz, Fazenda, Comprador); 1 aquecimento + 5 amostras; mediana (p50).
- Consultas lentas identificadas com `log_min_duration_statement` e confirmadas com `EXPLAIN (ANALYZE, BUFFERS)` como `ordens_owner` com contexto RLS.

## Causas encontradas

1. **Série diária do painel**: juntava `load_status_history`, cuja política RLS consulta `loads` por linha (126 mil buscas). → `loads.loaded_at`/`received_at` gravados nas transições (com preenchimento a partir do histórico) e índices parciais; série calculada em uma passada.
2. **Lista de ordens**: `count(*) over ()` obrigava calcular faróis (subconsultas de visualização) e nomes de todas as ordens antes de paginar. → Sem filtro de farol, pagina ids (com total na mesma passada) e só enriquece a página. Com filtro de farol mantém o caminho anterior (precisa dos sinais de todas as linhas).
3. **Pendências do painel**: juntavam a ordem em cada linha (verificação RLS por linha) mesmo sem filtro de commodity; NF-e rejeitadas usavam subconsulta por nota. → Ordem só com filtro de commodity; NF-e agregadas por carga; visualizações agregadas uma vez.
4. Índices para recorte de Fazenda/Comprador (`seller_org_id`/`buyer_org_id` em cargas e agendamentos), `loads.created_at`, visualizações por (ordem, lado, versão) e documentos por data (migration 0900).

## Resultados (p50, ms)

| Endpoint | Perfil | Antes | Depois |
|---|---|---|---|
| `/orders` (página 1) | Matriz | 382 | 59 |
| `/orders` (página 1) | Fazenda | 260 | 110 |
| `/orders?q=milho` | Matriz | 430 | 124 |
| `/orders?farmSignal=OVERDUE` | Matriz | 583 | 408 |
| `/dashboard?period=7d` | Matriz | 1.253 | 476 |
| `/dashboard?period=30d` | Matriz | 2.031 | 842 |
| `/dashboard?period=30d` | Fazenda | 2.112 | 733 |
| `/dashboard?period=30d` | Comprador | 642 | 477 |
| `/loads` | Matriz | 110 | 103 |
| `/invoices` | Matriz | 55 | 65 |

Demais endpoints (agendamentos, ocorrências, documentos, notificações) ficaram entre 15 e 180 ms antes e depois.

## Pontos conhecidos

- Filtro por farol na lista de ordens continua proporcional ao número de ordens (~0,4 s com 14 mil): exige os sinais de todas as linhas. Alternativa futura: materializar o último farol por ordem.
- Painel de 30 dias ainda percorre as cargas do período (série diária e transportadoras). Alternativa futura, se necessário: agregados diários materializados ou cache curto por organização.
