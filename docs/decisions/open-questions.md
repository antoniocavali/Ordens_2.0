# Questões de Negócio em Aberto

Regras que **não** serão inventadas silenciosamente. Enquanto não houver decisão, o comportamento adotado está indicado e é configurável/isolado.

| # | Questão | Comportamento provisório |
|---|---|---|
| Q1 | Publicar OC acima do saldo contratual bloqueia ou apenas alerta? | Bloqueia com erro `CONTRACT_BALANCE_EXCEEDED`; Gestor/Admin poderá ter override auditado (a confirmar). |
| Q2 | Tolerância de quantidade padrão por commodity/contrato/OC? | Campo `tolerance_pct` na OC, padrão 0%. |
| Q3 | "Administrador Fazenda" representa o vendedor/produtor (várias fazendas) ou uma única propriedade? | Organização `FARM` = vendedor/produtor; enxerga todas as fazendas vinculadas a ela. |
| Q4 | Um tenant pode ter múltiplas Matrizes/filiais com visibilidade separada? | Uma Matriz vê todo o tenant; `app.org_ids` já permite restringir no futuro. |
| Q5 | Numeração da OC: sequência por tenant e ano (`2026/00125`) ou configurável? | `AAAA/NNNNN` por tenant, gerada na criação do rascunho via sequência transacional. |
| Q6 | SLA de visualização (farol vermelho): horas corridas ou úteis? Por tenant ou por perfil? | Horas corridas, por tenant (`view_sla_hours`, padrão 24). |
| Q7 | Liberação possui validade obrigatória? O que ocorre ao expirar com cargas agendadas? | Validade opcional; ao expirar, saldo não consumido deixa de contar; agendamentos existentes geram alerta. |
| Q8 | Quem registra o recebimento/peso no destino: Matriz, Comprador ou integração? | Matriz. |
| Q9 | Comprador pode ver valores/preços da OC? | Não por padrão; visibilidade configurável futura. |
| Q10 | Fazenda pode criar agendamentos ou só confirmar os da Matriz? | Pode criar e confirmar dentro do saldo liberado. |
| Q11 | Alteração de observação visível à Fazenda gera nova versão? | Sim (considerada material). |
| Q12 | Unidade "saca": 60 kg fixo ou por commodity? | Fator por unidade cadastrada (`SC60` = 60 kg); outras configuráveis. |
| Q13 | A NF-e da Fazenda é obrigatória para a carga ir a "Faturada pela Fazenda"? | Sim: exige ao menos uma NF-e da Fazenda vinculada à carga com status Válida ou Com divergência (`INVOICE_REQUIRED`). |
| Q14 | Quem encerra ocorrências? | Matriz abre, resolve, cancela e reabre. Fazenda abre ocorrências das próprias cargas (visíveis a ela) e pode colocá-las em tratamento. Comprador apenas lê as compartilhadas. |
| Q15 | Divergências da NF-e (emitente ≠ vendedor, placa ≠ carga, peso líquido fora da tolerância) bloqueiam? | Não bloqueiam: nota fica "Com divergência" e aparece nas pendências. |
| Q16 | NF-e sem autorização da SEFAZ? | Protocolo com `cStat` ≠ 100 → Rejeitada. XML sem protocolo → aceito com alerta `NO_PROTOCOL`. Assinatura digital não é validada no MVP. |
| Q17 | Divergência de peso na conferência: qual limite gera ocorrência? | Diferença entre recebido (convertido para kg) e peso líquido carregado acima da tolerância da OC (mínimo 0,5%) → ocorrência automática "Divergência de peso", visível à Fazenda. |
| Q18 | Visibilidade padrão de documentos | Enviados pela Matriz: somente Matriz. Pela Fazenda: Matriz e Fazenda. NF-e XML: Matriz, Fazenda e Comprador. A Matriz pode alterar. |
| Q19 | "Faturada pela Matriz" exige NF-e da Matriz anexada? | Não no MVP (NF-e da Matriz é aceita, mas não obrigatória). |
| Q20 | NF-e com unidade comercial diferente da OC | Quantidade da nota é exibida como está; não há conversão automática nem baixa de saldo por NF-e. |
| Q21 | O que é "carga atrasada"? | Carga ainda não carregada (Agendada até Em carregamento) com data de carregamento anterior a hoje, no fuso America/Sao_Paulo. |
| Q22 | Itens de "Precisa da sua atenção" por perfil | Matriz: visualização vencida (Fazenda/Comprador), cargas atrasadas, XML rejeitado sem nota válida, OCs acima da tolerância, ocorrências vencidas e altas/críticas, cargas aguardando NF-e, NF-e com divergência, agendamentos sem transportadora, documentos rejeitados (30 dias), rascunhos. Fazenda: OCs a visualizar, XML rejeitado, cargas atrasadas, cargas aguardando sua NF-e, ocorrências em aberto, agendamentos de hoje. Comprador: OCs a visualizar, NF-e com divergência, ocorrências compartilhadas, cargas a caminho. |
| Q23 | Unidade e valores no painel | Volumes somados em toneladas pelo fator da unidade de cada ordem. Valor carregado apenas para a Matriz e apenas ordens em BRL. |
| Q25 | Quem recebe notificações in-app? | Ordem publicada/nova versão: usuários da Fazenda e do Comprador da ordem. Liberação: Fazenda. XML rejeitado ou NF-e com divergência: quem enviou o arquivo. Ocorrência aberta: responsável; se automática e visível à Fazenda, também os usuários da Fazenda. Carga em trânsito: usuários do Comprador. Sem e-mail no MVP. |
| Q26 | Quem abre conversas de atendimento e quem atende? | Qualquer usuário com `support.use` (todos os perfis) abre conversas. Atendem usuários da Matriz com acesso a alguma fila (ver Q31). No banco, a Matriz vê todas as conversas do tenant; os demais, só as que abriram. O recorte por fila é aplicado na API. |
| Q27 | Como o assistente faz a triagem? | Regras, sem IA externa: botões (Faturamento, Suporte, Falar com atendente) e palavras-chave (nota, boleto, cobrança… → Faturamento; erro, acesso, senha… → Suporte). Pedido de atendente vai direto para a fila. Após 2 tentativas sem identificar o assunto, encaminha ao Suporte. Número de OC citado (AAAA/NNNNN) é vinculado se o usuário puder ver a ordem. |
| Q28 | Transferência entre filas | O atendente transfere entre Faturamento e Suporte; a transferência libera o responsável e devolve a conversa a "Aguardando atendente" na fila de destino. |
| Q29 | Responsável e reabertura | Resposta pública de um atendente em conversa sem responsável assume a conversa; na fila, muda para "Em atendimento". Escolhas feitas nos botões do assistente ficam registradas como mensagem do cliente. Mensagem do cliente em "Aguardando cliente" volta para "Em atendimento"; em "Resolvida", reabre como "Aguardando atendente". Encerrada não reabre (o cliente abre uma nova). |
| Q30 | SLA e notas internas | Sem SLA contratual no MVP: o painel mostra tempo de espera e média de primeira resposta (7 dias) apenas como indicadores. Notas internas nunca são visíveis a quem abriu a conversa (garantido por RLS). |
| Q31 | Times de Faturamento e Suporte | Cada fila é um time: `support.billing` (papel "Atendente Faturamento") e `support.support` (papel "Atendente Suporte") atendem só a própria fila — lista, detalhe, ações e indicadores. O Operador Matriz atende as duas filas. Gestor e Administrador têm `support.manage` (supervisão): todas as filas, conversas ainda com o assistente e visão geral. Um atendente pode transferir para a outra fila; a conversa sai do seu painel. Só pode ser responsável quem atende a fila da conversa. |
| Q32 | Definição dos indicadores de atendimento | Tempos contados a partir da abertura da conversa (inclui a triagem, normalmente segundos). Abertas e 1ª resposta pela data de abertura; resolvidas e tempo de resolução pela data de resolução (última). Taxa de resolução = encaminhadas no período já resolvidas ou encerradas. Desistências = conversas encerradas ainda com o assistente (só na supervisão). Métricas por atendente usam o responsável atual. Comparação com o período anterior de mesmo tamanho. Sem meta de SLA (Q30). |
| Q24 | Performance de transportadoras | Cargas criadas no período, volume líquido e cargas com divergência de peso acima da tolerância. Pontualidade fica fora até existir regra de horário de janela. |
