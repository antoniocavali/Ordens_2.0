-- Novo fluxo de ordens (Q41), parte 1: valores de enum.
-- Separado das políticas e dados: um valor novo de enum não pode ser usado na mesma transação em que foi criado.

alter type order_status add value if not exists 'PENDING_BILLING' after 'DRAFT';

create type order_origin as enum ('MATRIZ', 'BUYER');
