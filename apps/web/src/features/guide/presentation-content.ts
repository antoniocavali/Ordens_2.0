/**
 * Roteiro da apresentação institucional (/apresentacao). Cada capítulo tem um texto e uma sequência de
 * telas reais (public/guia). Sem números de ganho: só o que o sistema faz.
 */
export interface PresentationFrame {
  file: string;
  label: string;
  text: string;
}

export interface PresentationSlide {
  id: string;
  nav: string;
  kicker: string;
  title: string;
  intro: string;
  frames: PresentationFrame[];
  closing?: boolean;
}

const f = (file: string, label: string, text: string): PresentationFrame => ({ file, label, text });

export const SLIDES: PresentationSlide[] = [
  {
    id: 'abertura',
    nav: 'Abertura',
    kicker: 'Cooperfarms · Ordens de Carregamento',
    title: 'Do pedido ao caminhão na estrada, em um só lugar.',
    intro: 'Matriz, Fazendas e Compradores trabalham na mesma ordem, cada um vendo a sua parte e sabendo de quem é a vez.',
    frames: [
      f('matriz-visao-geral', 'Matriz', 'A operação inteira: pendências, volumes e cargas do dia.'),
      f('fazenda-visao-geral', 'Fazenda', 'As ordens publicadas para a fazenda e o que falta carregar.'),
      f('comprador-visao-geral', 'Comprador', 'As próprias solicitações e as cargas a caminho.'),
    ],
  },
  {
    id: 'ordem',
    nav: 'A ordem',
    kicker: '01 · Organização',
    title: 'Uma ordem reúne tudo o que a operação precisa saber.',
    intro: 'Vendedor, fazenda, comprador, produto, quantidade, janela e transporte ficam em um único registro, com histórico de versões.',
    frames: [
      f('matriz-ordens', 'Todas as ordens', 'Lista com situação, quantidades e busca por número, placa ou parceiro.'),
      f('matriz-nova-ordem', 'Lançamento', 'O formulário salva o rascunho sozinho e ajusta as fazendas ao vendedor escolhido.'),
      f('matriz-ordem-publicada', 'Publicação', 'Publicada, a ordem aparece para a Fazenda e o Comprador e já autoriza carregar.'),
    ],
  },
  {
    id: 'comprador',
    nav: 'Comprador',
    kicker: '02 · Portal do Comprador',
    title: 'O Comprador pede. A Matriz define a origem.',
    intro: 'A solicitação chega pronta ao Faturamento, que escolhe vendedor e fazenda, informa o contrato e publica.',
    frames: [
      f('comprador-nova-solicitacao', 'Solicitação', 'O Comprador informa produto, quantidade, janela, destino e transporte.'),
      f('comprador-solicitacao-enviada', 'Em análise', 'Enviada, a solicitação aguarda o Faturamento e fica somente para leitura.'),
      f('matriz-definir-fazenda', 'Faturamento', 'Vendedor, fazenda e contrato definidos; a ordem é publicada para a Fazenda.'),
    ],
  },
  {
    id: 'fazenda',
    nav: 'Fazenda',
    kicker: '03 · Na fazenda',
    title: 'Chegou o caminhão? Um clique cria a carga.',
    intro: 'Sem liberação nem agendamento. A Fazenda informa a chegada, pesa, anexa a nota e conclui a sua parte.',
    frames: [
      f('fazenda-ordem', 'Chegada', '"Informar chegada do caminhão" cria a carga com o transporte da ordem.'),
      f('fazenda-carga-pesagem', 'Pesagem', 'Peso bruto e tara informados; o líquido é calculado.'),
      f('fazenda-carga-documentos', 'Nota fiscal', 'PDF e XML conferidos: o sistema lê a nota e libera a validação fiscal.'),
      f('fazenda-etapa-concluida', 'Etapa concluída', 'A ordem avisa que a parte da Fazenda terminou e que a carga está com a Matriz.'),
    ],
  },
  {
    id: 'matriz',
    nav: 'Faturamento',
    kicker: '04 · Faturamento e saída',
    title: 'O caminhão só sai depois da nota da Matriz.',
    intro: 'A próxima etapa aparece no topo da ordem. A Matriz anexa a própria nota, fatura e libera para trânsito.',
    frames: [
      f('matriz-proxima-etapa', 'Próxima etapa', 'O botão no topo mostra o que fazer e em qual carga.'),
      f('matriz-carga-nota-matriz', 'Nota da Matriz', 'PDF e XML da nota ao Comprador, conferidos pelo sistema.'),
      f('matriz-carga-liberar', 'Liberação', 'Faturada, a carga é liberada para trânsito.'),
      f('matriz-carga-concluida', 'Concluída', 'Liberar para trânsito encerra a carga, com todo o histórico registrado.'),
    ],
  },
  {
    id: 'documentos',
    nav: 'Documentos',
    kicker: '05 · Documentos e notas fiscais',
    title: 'Cada parte acessa só o que é seu.',
    intro: 'A Matriz vê tudo. A Fazenda vê a nota que emitiu. O Comprador vê a nota que a Matriz emitiu para ele.',
    frames: [
      f('matriz-documentos', 'Central de Documentos', 'Todos os arquivos das ordens e cargas, em um só lugar.'),
      f('matriz-nfe', 'Notas Fiscais', 'NF-e lidas dos XML, com emitente, valor e situação.'),
      f('comprador-documentos', 'Visão do Comprador', 'Somente os documentos gerados pela Matriz para ele.'),
    ],
  },
  {
    id: 'gestao',
    nav: 'Gestão',
    kicker: '06 · Gestão',
    title: 'Números da operação, sem planilha paralela.',
    intro: 'Tempo de ciclo, relatórios exportáveis e ocorrências acompanhadas até a solução.',
    frames: [
      f('matriz-gestao-ciclo', 'Gestão do ciclo', 'Tempo da publicação à conclusão, por etapa, commodity, fazenda e comprador.'),
      f('matriz-relatorios', 'Relatórios', 'Prévia na tela e exportação em Excel, CSV ou PDF.'),
      f('matriz-ocorrencias', 'Ocorrências', 'Problemas de qualidade, peso ou documento, com prazo e responsável.'),
    ],
  },
  {
    id: 'atendimento',
    nav: 'Atendimento',
    kicker: '07 · Atendimento',
    title: 'Fazenda e Comprador falam com a Matriz sem sair do sistema.',
    intro: 'Conversas organizadas em filas de Faturamento e Suporte, com equipe e indicadores.',
    frames: [
      f('comprador-atendimento', 'Pelo portal', 'O usuário abre a conversa na própria tela em que está.'),
      f('matriz-atendimento-suporte', 'Filas', 'Cada atendente vê e assume as conversas da sua fila.'),
      f('matriz-atendimento-indicadores', 'Indicadores', 'Volume, tempo de resposta e de resolução.'),
    ],
  },
  {
    id: 'seguranca',
    nav: 'Segurança',
    kicker: '08 · Acessos e rastreabilidade',
    title: 'Cada pessoa com o seu acesso. Cada ação com o seu registro.',
    intro: 'Papéis por tipo de usuário, verificação em duas etapas e uma trilha de auditoria que não pode ser alterada.',
    frames: [
      f('matriz-papeis', 'Papéis e permissões', 'Papéis prontos por perfil e papéis personalizados quando preciso.'),
      f('matriz-seguranca', 'Política de segurança', 'Regras de senha e verificação em duas etapas, por organização ou papel.'),
      f('matriz-auditoria', 'Auditoria', 'Quem fez o quê, quando, com o antes e o depois.'),
    ],
  },
  {
    id: 'encerramento',
    nav: 'Começar',
    kicker: 'Cooperfarms · Ordens de Carregamento',
    title: 'Uma base comum para carregar, faturar e acompanhar.',
    intro: 'Entre com a sua conta para começar. O Guia de uso, dentro do sistema, mostra o passo a passo do seu perfil.',
    frames: [f('matriz-ordem-cargas', 'A operação', 'Ordens, cargas e documentos, com cada etapa registrada.')],
    closing: true,
  },
];
