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
