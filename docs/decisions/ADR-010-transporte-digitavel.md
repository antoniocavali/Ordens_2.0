# ADR-010 — Transporte digitado, sem cadastro

**Status**: aceito (24/09/2026)
**Contexto**: Fases 3 e 7 (cadastros mestres e logística)

## Contexto

A primeira versão tratava transporte como cadastro: `carrier_profiles`, `drivers` e `vehicles`, mais um
cadastro de `locations`. O agendamento e a carga apontavam para essas tabelas por FK (transportadora,
motorista, cavalo, carreta 1, carreta 2).

Na operação real da Cooperfarms isso não se sustenta:

- O caminhão chega na portaria com um documento em mãos; quem agenda não tem como cadastrar antes o
  motorista e cada implemento da composição, e um cadastro incompleto trava o carregamento.
- Motorista e veículo costumam ser de terceiros e mudam a cada viagem. Manter cadastro disso é custo
  permanente sem retorno.
- As três posições fixas (cavalo, carreta 1, carreta 2) não cobrem rodotrem com dolly.
- Com grupos de acesso (organizações), um cadastro compartilhado de motoristas exigiria decidir a quem
  cada motorista pertence — e um motorista serve a vários grupos.

## Decisão

Transportadora, motorista, composição de veículos e local de carregamento passam a ser **campos
digitados**, no formato do documento apresentado pelo motorista:

- `appointments` e `loads` recebem `carrier_name`, `driver_name`, `driver_cpf`, `driver_rg`,
  `driver_phone`, `driver_birth_date`, `driver_cnh`, `driver_cnh_category`, `driver_cnh_expires_at`,
  `driver_cnh_restrictions` e `vehicles jsonb` — uma lista `{plate, description, type, axles, renavam}`
  na ordem em que engata, sem limite de posições. `plates[]` continua derivado da lista (busca e portaria).
- `loading_orders` recebe `loading_location_*` (nome, endereço, cidade, UF) e `preferred_carrier_name`.
- A carga copia o transporte do agendamento e continua editável até a confirmação do carregamento.
- `GET /transport/suggestions` devolve o que o grupo de quem pergunta já digitou (transportadoras,
  motoristas por CPF, veículos por placa). A leitura passa pelo RLS, então a sugestão nunca cruza grupos.
  Escolher uma sugestão preenche os demais campos — não há retrabalho de digitação, e os relatórios
  continuam agrupando por nome de transportadora.
- Os menus Transportadoras, Motoristas, Veículos e Locais saem da navegação, junto com seus endpoints,
  com as permissões `carrier.read`/`carrier.manage` e com os lookups correspondentes.

Validações preservadas, agora sobre o dado digitado: CPF e RENAVAM com dígito/tamanho conferidos, placa
normalizada no padrão brasileiro, placa não repetida na composição, CNH vencida na data do carregamento
impede confirmar o agendamento, e motorista + ao menos um veículo são exigidos para confirmar o
agendamento e para iniciar o carregamento.

## Consequências

- Perdemos a validação de coerência "motorista/veículo pertencem à transportadora escolhida": sem
  cadastro, não existe esse vínculo. Na prática ela só valia quando o cadastro estava correto.
- O mesmo motorista pode aparecer escrito de formas diferentes. As sugestões por CPF e placa reduzem
  isso; a chave prática de agrupamento passa a ser o CPF do motorista e a placa do veículo.
- `drivers`, `vehicles`, `carrier_profiles` e `locations` continuam no banco nesta etapa. A migração
  `20260929002700_transporte_digitavel` copia os dados existentes para os campos novos e deixa as
  tabelas fora de uso, o que permite voltar atrás; a remoção definitiva fica para uma limpeza posterior.
- `business_partners` com papel `CARRIER` continua existindo, mas só para dar acesso ao sistema a uma
  transportadora (grupo do tipo Transportadora) — não para identificar o transporte da carga.

## Alternativas consideradas

- **Manter o cadastro e permitir criação rápida no agendamento**: continuaria exigindo dono do registro
  por grupo e não resolveria a composição variável.
- **Cadastro só de transportadora, resto digitado**: a transportadora é justamente o dado que menos se
  repete em frete de terceiros; manter a tabela só por ela não se paga.
