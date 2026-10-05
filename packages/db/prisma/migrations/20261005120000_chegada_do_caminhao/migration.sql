-- A carga passa a nascer quando a Fazenda informa a chegada do caminhão, sem liberação nem
-- agendamento antes e sem quantidade prevista por caminhão: o que vale é o peso da pesagem.
-- A coluna continua existindo para as cargas antigas; as novas gravam zero.
alter table loads drop constraint loads_expected_qty_check;
alter table loads add constraint loads_expected_qty_check check (expected_qty >= 0);
alter table loads alter column expected_qty set default 0;
