/**
 * Conteúdo do Guia de uso (/guia), dividido por tipo de usuário. As capturas ficam em public/guia e são
 * geradas por scripts/guia/capturas.spec.ts. Ao mudar uma tela ou uma regra, ajuste o texto aqui.
 */

export interface GuideShot {
  /** Nome do arquivo em public/guia, sem extensão. */
  file: string;
  alt: string;
}

export interface GuideTask {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  shot?: GuideShot;
  /** Observação curta: regra, limite ou cuidado. */
  note?: string;
}

export type GuideGroup = 'Matriz' | 'Fazenda' | 'Comprador' | 'Para todos';

export interface GuideProfile {
  slug: string;
  name: string;
  group: GuideGroup;
  /** Códigos de papel que caem neste capítulo (para abrir o guia no perfil de quem está logado). */
  roleCodes: string[];
  tagline: string;
  does: string[];
  doesNot: string[];
  /** Itens que aparecem no menu lateral deste perfil. */
  menu: string[];
  tasks: GuideTask[];
}

const shot = (file: string, alt: string): GuideShot => ({ file, alt });

// ───────────────────────────── Tarefas comuns ─────────────────────────────

const overview = (file: string, who: string): GuideTask => ({
  id: 'visao-geral',
  title: 'Começar pela Visão geral',
  summary: `A primeira tela mostra o que precisa da sua atenção e os números ${who}.`,
  steps: [
    'Ao entrar, você cai na Visão geral. O quadro "Precisa da sua atenção" lista as pendências; clique em uma delas para abrir a lista já filtrada.',
    'Use Hoje, 7 dias ou 30 dias e o filtro de commodity para mudar o período dos indicadores.',
    'O botão Ordens, no canto direito, leva à lista completa.',
  ],
  shot: shot(file, 'Visão geral com pendências e indicadores'),
});

const findOrders = (file: string): GuideTask => ({
  id: 'ordens',
  title: 'Encontrar e acompanhar ordens',
  summary: 'A lista de Ordens de Carregamento é o ponto de partida de todo o trabalho.',
  steps: [
    'No menu, abra Operação › Ordens de Carregamento.',
    'Filtre por situação nas abas do topo e use a busca para achar por número, placa ou parceiro. Ctrl+K busca de qualquer tela.',
    'Clique em uma linha para abrir a ordem. As abas Resumo, Cargas, Ocorrências, Versões, Visualizações e Documentos reúnem tudo sobre ela.',
    'O quadro Quantidades mostra o total da ordem, o que já foi carregado, o que foi liberado para trânsito e o saldo a carregar.',
  ],
  shot: shot(file, 'Lista de Ordens de Carregamento'),
});

const createOrder: GuideTask = {
  id: 'nova-ordem',
  title: 'Lançar uma ordem',
  summary: 'A ordem reúne vendedor, fazenda, comprador, produto, quantidade, janela e transporte.',
  steps: [
    'Clique em Nova Ordem, no topo de qualquer tela.',
    'Escolha o Vendedor: a lista de fazendas passa a mostrar só as dele. Depois informe Comprador, commodity, quantidade e unidade.',
    'Preencha a janela de carregamento, o destino e o transporte (transportadora, motorista e placas são digitados, com sugestões do que já foi usado).',
    'O rascunho é salvo sozinho enquanto você digita; o rodapé mostra o horário do último salvamento. Você pode fechar e voltar depois.',
  ],
  shot: shot('matriz-nova-ordem', 'Formulário de nova ordem'),
  note: 'Publicar sem destino é permitido, mas o sistema pede confirmação.',
};

const publishOrder: GuideTask = {
  id: 'publicar',
  title: 'Publicar a ordem para a Fazenda',
  summary: 'Só depois de publicada a ordem aparece para a Fazenda e para o Comprador.',
  steps: [
    'Abra o rascunho e confira os dados no Resumo.',
    'Clique em Publicar. A Fazenda e o Comprador são avisados.',
    'A ordem publicada já autoriza carregar: não existe liberação nem agendamento. A Fazenda só informa a chegada de cada caminhão.',
    'Alterar um campo importante depois de publicar gera uma nova versão; a aba Visualizações mostra se cada parte já viu a versão atual.',
  ],
  shot: shot('matriz-ordem-publicada', 'Ordem publicada, com resumo e quantidades'),
  note: 'Se a dupla checagem estiver ligada em Configurações › Workflow, quem lançou a ordem não a publica: outra pessoa precisa publicar.',
};

const requestPublish: GuideTask = {
  id: 'solicitar-publicacao',
  title: 'Pedir a publicação',
  summary: 'O Operador prepara a ordem; a publicação é feita por Gestor, Administrador ou Faturamento.',
  steps: [
    'Com o rascunho pronto, clique em Solicitar publicação.',
    'A ordem fica marcada como aguardando publicação e quem publica recebe o aviso.',
    'Você é avisado quando ela for publicada.',
  ],
  shot: shot('matriz-ordem-rascunho', 'Rascunho de ordem aguardando publicação'),
};

const assignFarm: GuideTask = {
  id: 'definir-fazenda',
  title: 'Tratar a solicitação do Comprador',
  summary: 'O Comprador pede; o Faturamento define de onde sai o produto e publica.',
  steps: [
    'As solicitações enviadas aparecem em Ordens com a situação "Aguardando faturamento" e no quadro de pendências da Visão geral.',
    'Abra a solicitação e clique em Definir fazenda.',
    'Escolha o vendedor e a fazenda. Contrato é um campo digitável: escreva o número, se houver. Preço, tolerância e observações são opcionais.',
    'Clique em Salvar e publicar para a Fazenda. Se algo estiver errado no pedido, use Devolver ao Comprador e informe o motivo: a solicitação volta para ele ajustar.',
  ],
  shot: shot('matriz-definir-fazenda', 'Definição de vendedor, fazenda e contrato'),
};

const matrizLoad: GuideTask = {
  id: 'faturar-carga',
  title: 'Faturar a carga e liberar para trânsito',
  summary: 'Depois que a Fazenda conclui a validação fiscal, a carga passa para a Matriz.',
  steps: [
    'Abra a ordem. Quando há uma carga esperando por você, o botão da próxima etapa aparece no topo, com o número da carga (por exemplo, "Registrar faturamento da Matriz C01").',
    'Clique nele. A carga abre com a faixa "Sua vez" dizendo o que falta.',
    'Em "Nota da Matriz para o Comprador", anexe o PDF e o XML da nota emitida pela Matriz e aguarde a conferência (alguns segundos).',
    'Clique em Registrar faturamento da Matriz e, em seguida, em Liberar para trânsito. Esse último passo conclui a carga.',
  ],
  shot: shot('matriz-carga-nota-matriz', 'Carga com a nota da Matriz anexada'),
  note: 'O XML precisa ser da nota emitida pela Matriz. Um XML emitido pelo vendedor é tratado como nota da Fazenda.',
};

const nextStep: GuideTask = {
  id: 'proxima-etapa',
  title: 'Saber com quem está cada carga',
  summary: 'A ordem e a carga dizem de quem é a vez.',
  steps: [
    'No topo da ordem, o botão da próxima etapa aparece quando a vez é sua. Etapas simples andam com um clique; as que pedem dados abrem a carga no ponto certo.',
    'Quando a vez é de outra parte, a ordem mostra uma faixa: "Com a Fazenda" ou "Com a Matriz", com o que ela precisa fazer.',
    'Na aba Cargas, filtre por Chegada, Carregamento, Faturamento ou Trânsito para ver em que etapa cada caminhão está.',
  ],
  shot: shot('matriz-proxima-etapa', 'Botão da próxima etapa no topo da ordem'),
};

const orderLifecycle: GuideTask = {
  id: 'encerrar',
  title: 'Suspender, concluir ou cancelar uma ordem',
  summary: 'Ações de gestão, sempre com motivo registrado.',
  steps: [
    'Suspender bloqueia novas chegadas de caminhão até a retomada; as cargas em andamento continuam. Retomar devolve a ordem ao andamento.',
    'Concluir ordem encerra a ordem quando não há carga em andamento. Se sobrar saldo, o sistema pede o motivo.',
    'Cancelar ordem exige que não haja carga em andamento; o que não foi carregado fica como cancelado e o histórico permanece.',
  ],
  shot: shot('matriz-ordem-cargas', 'Cargas de uma ordem'),
};

const deleteOrder: GuideTask = {
  id: 'excluir',
  title: 'Excluir um rascunho ou uma ordem',
  summary: 'Para o que foi lançado por engano. Apaga a ordem com tudo dentro e não tem volta.',
  steps: [
    'Abra a ordem e clique em Excluir.',
    'Informe o motivo e digite o número da ordem para confirmar.',
    'A ordem some de todas as telas, junto com cargas, notas fiscais, ocorrências e anexos. Na Auditoria ficam quem excluiu, quando e o motivo.',
  ],
  shot: shot('matriz-excluir-ordem', 'Confirmação de exclusão de ordem'),
  note: 'Para encerrar uma ordem mantendo o histórico, use Cancelar em vez de Excluir.',
};

const documents = (file: string, rule: string): GuideTask => ({
  id: 'documentos',
  title: 'Consultar documentos e notas fiscais',
  summary: rule,
  steps: [
    'Em Documentos › Central de Documentos estão os arquivos anexados às ordens e cargas. Clique para baixar.',
    'Em Documentos › Notas Fiscais estão as NF-e lidas dos XML, com número, emitente, valor e situação.',
    'Dentro da ordem, a aba Documentos mostra só o que pertence a ela.',
  ],
  shot: shot(file, 'Central de Documentos'),
});

const occurrences = (canManage: boolean): GuideTask => ({
  id: 'ocorrencias',
  title: canManage ? 'Registrar e acompanhar ocorrências' : 'Acompanhar ocorrências',
  summary: 'Problemas de qualidade, peso, documento ou atraso ficam registrados na ordem.',
  steps: canManage
    ? [
        'Na ordem, abra a aba Ocorrências e registre o problema: tipo, título e descrição. Você pode ligar a ocorrência a uma carga.',
        'Em Operação › Ocorrências você acompanha todas, com prazo e situação.',
        'Ao resolver, registre o que foi feito. O histórico fica na ordem.',
      ]
    : ['Em Operação › Ocorrências você vê as ocorrências das suas ordens, com a situação de cada uma.', 'Dentro da ordem, a aba Ocorrências mostra as que pertencem a ela.'],
  shot: shot('matriz-ocorrencias', 'Lista de ocorrências'),
});

const registry: GuideTask = {
  id: 'cadastros',
  title: 'Manter cadastros',
  summary: 'Compradores, vendedores, fazendas e commodities.',
  steps: [
    'Em Cadastros, abra Compradores, Vendedores ou Fazendas. O botão no topo da lista inclui um novo; clique em uma linha para editar.',
    'Cada fazenda pertence a um vendedor: é isso que faz a lista de fazendas se ajustar ao escolher o vendedor na ordem.',
    'Transportadora, motorista, veículo e local de destino não têm cadastro: são digitados na ordem e na carga.',
  ],
  shot: shot('matriz-fazendas', 'Cadastro de fazendas'),
};

const commodities: GuideTask = {
  id: 'commodities',
  title: 'Manter commodities',
  summary: 'Os produtos que podem ser usados nas ordens.',
  steps: ['Em Comercial › Commodities, inclua ou edite os produtos e suas unidades.', 'Uma commodity inativa deixa de aparecer nas ordens novas, sem afetar as existentes.'],
  shot: shot('matriz-commodities', 'Cadastro de commodities'),
};

const cycle: GuideTask = {
  id: 'ciclo',
  title: 'Acompanhar o ciclo da operação',
  summary: 'Quanto tempo a ordem leva da publicação à conclusão, e onde ela demora.',
  steps: [
    'Abra Gestão › Gestão do ciclo e escolha o período (30, 90, 180 dias ou 12 meses) e, se quiser, a commodity.',
    'Os quadros mostram o ciclo médio, o pior caso e o tempo até a primeira carga; "Etapas do ciclo" separa cada trecho.',
    'Compare por commodity, fazenda ou comprador e veja as ordens mais demoradas e as abertas há mais tempo.',
  ],
  shot: shot('matriz-gestao-ciclo', 'Gestão do ciclo'),
};

const reports: GuideTask = {
  id: 'relatorios',
  title: 'Gerar relatórios',
  summary: 'Prévia na tela e exportação em Excel, CSV ou PDF.',
  steps: [
    'Abra Gestão › Relatórios, escolha o relatório e o período (até 366 dias).',
    'A tela mostra uma prévia. Use Exportar para baixar o arquivo.',
    'Períodos grandes são gerados em segundo plano: você recebe um aviso no sino quando o arquivo fica pronto, e o link vale por 7 dias.',
  ],
  shot: shot('matriz-relatorios', 'Relatórios'),
};

const audit: GuideTask = {
  id: 'auditoria',
  title: 'Consultar a auditoria',
  summary: 'Quem fez o quê, e quando. O registro não pode ser alterado nem apagado.',
  steps: ['Abra Gestão › Auditoria.', 'Filtre por ação, pessoa ou período.', 'Abra um registro para ver o antes e o depois da alteração.'],
  shot: shot('matriz-auditoria', 'Trilha de auditoria'),
};

const createUsers: GuideTask = {
  id: 'usuarios',
  title: 'Criar usuários',
  summary: 'Conta nova com senha provisória, trocada no primeiro acesso.',
  steps: [
    'Abra Gestão › Usuários e clique em Criar usuário.',
    'Informe nome, e-mail, o grupo de acesso (Matriz, uma fazenda ou um comprador) e o papel.',
    'Defina a senha provisória e entregue-a à pessoa. No primeiro acesso o sistema exige a troca.',
  ],
  shot: shot('matriz-usuarios', 'Usuários'),
  note: 'Você só atribui papéis cujas permissões já possui.',
};

const manageUsers: GuideTask = {
  id: 'gerir-usuarios',
  title: 'Administrar usuários e acessos',
  summary: 'Convites, papéis, senha provisória e desativação.',
  steps: [
    'Em Gestão › Usuários, use Convidar usuário (a pessoa recebe um link por e-mail, válido por 72 horas) ou Criar usuário (com senha provisória).',
    'Clique em um usuário para trocar o papel, definir uma senha provisória, exigir a verificação em duas etapas ou desativar o acesso.',
    'Em Gestão › Grupos de acesso ficam a Matriz, as fazendas e os compradores aos quais os usuários pertencem.',
  ],
  shot: shot('matriz-usuarios', 'Usuários'),
  note: 'A Matriz sempre mantém ao menos um Administrador ativo, e ninguém desativa o próprio acesso.',
};

const roles: GuideTask = {
  id: 'papeis',
  title: 'Criar papéis personalizados',
  summary: 'Quando os papéis do sistema não atendem, monte um com as permissões exatas.',
  steps: [
    'Abra Gestão › Papéis e permissões. Os papéis do sistema são fixos e servem de consulta.',
    'Clique em Novo papel (ou duplique um existente), escolha o tipo de organização e marque as permissões.',
    'Atribua o papel ao usuário em Gestão › Usuários. A mudança vale na próxima ação da pessoa.',
  ],
  shot: shot('matriz-papeis', 'Papéis e permissões'),
};

const settings: GuideTask = {
  id: 'configuracoes',
  title: 'Configurar segurança, workflow e parâmetros',
  summary: 'Regras que valem para toda a organização.',
  steps: [
    'Configurações › Segurança: política de senha e exigência da verificação em duas etapas, para todos ou por papel.',
    'Configurações › Workflow: liga ou desliga a dupla checagem na publicação de ordens.',
    'Configurações › Parâmetros: cópia automática do XML da nota da Fazenda para uma pasta de rede. Informe a pasta, teste a conexão e, se a pasta mudar, use Sincronizar para copiar de novo os XML já recebidos.',
  ],
  shot: shot('matriz-parametros', 'Parâmetros da cópia de XML'),
};

const supportManage: GuideTask = {
  id: 'atendimento-gestao',
  title: 'Organizar o atendimento',
  summary: 'Filas, equipe e indicadores das conversas com Fazendas e Compradores.',
  steps: [
    'Atendimento › Visão geral mostra todas as conversas e quem está com cada uma.',
    'Em Equipe, defina quem atende a fila de Faturamento e a de Suporte.',
    'Em Indicadores, acompanhe volume, tempo de primeira resposta e de resolução.',
  ],
  shot: shot('matriz-atendimento-equipe', 'Equipe do atendimento'),
};

const supportAttend: GuideTask = {
  id: 'atender',
  title: 'Atender conversas',
  summary: 'Fazendas e Compradores falam com a Matriz pelo próprio sistema.',
  steps: [
    'No menu Atendimento, abra a fila que você atende (Faturamento ou Suporte).',
    'Assuma uma conversa em "Aguardando atendente" e responda. Você pode anexar arquivos e ligar a conversa a uma ordem.',
    'Se o assunto for de outra fila, direcione a conversa. Ao terminar, marque como resolvida.',
  ],
  shot: shot('atendente-fila', 'Fila de atendimento'),
  note: 'As filas que você atende são definidas pela supervisão em Atendimento › Equipe.',
};

const askSupport = (file: string): GuideTask => ({
  id: 'falar-com-a-matriz',
  title: 'Falar com a Matriz',
  summary: 'Dúvidas de faturamento ou do sistema, sem sair da tela.',
  steps: [
    'Clique no balão de conversa, no canto inferior direito.',
    'Use Nova conversa, escolha o assunto (Faturamento ou Suporte) e escreva. Você pode anexar arquivos.',
    'As respostas chegam ali mesmo e no sino de avisos. O histórico das suas conversas fica na lista.',
  ],
  shot: shot(file, 'Janela de atendimento'),
});

// ───────────────────────────── Fazenda ─────────────────────────────

const farmArrival: GuideTask = {
  id: 'chegada',
  title: 'Informar a chegada do caminhão',
  summary: 'É o que cria a carga. Um clique, sem agendamento nem limite de quantidade.',
  steps: [
    'Abra a ordem publicada para a sua fazenda.',
    'Clique em Informar chegada do caminhão. A carga nasce com a numeração da ordem (C01, C02…) e já abre na tela.',
    'O transporte vem preenchido com o que foi informado na ordem. Se o motorista ou a placa forem outros, corrija na própria carga, antes da pesagem.',
  ],
  shot: shot('fazenda-ordem', 'Ordem aberta pela Fazenda, com o botão de chegada'),
  note: 'Não há limite de quantidade: carregue o que chegou. A ordem mostra o total carregado.',
};

const farmLoading: GuideTask = {
  id: 'carregamento',
  title: 'Carregar e pesar',
  summary: 'Início do carregamento, peso bruto e tara.',
  steps: [
    'Na carga, clique em Iniciar carregamento.',
    'Informe o Peso bruto e a Tara em quilos. O peso líquido é calculado.',
    'Clique em Confirmar carregamento. A partir daqui o transporte fica travado e a carga passa a aguardar a documentação fiscal.',
  ],
  shot: shot('fazenda-carga-pesagem', 'Pesagem da carga'),
};

const farmDocs: GuideTask = {
  id: 'validacao-fiscal',
  title: 'Anexar a nota e concluir a validação fiscal',
  summary: 'O último passo da Fazenda. Depois dele, a carga passa para a Matriz.',
  steps: [
    'Na carga, anexe o PDF e o XML da nota fiscal emitida pela fazenda. O sistema lê o XML e confere emitente, placa e peso.',
    'Quando os dois estiverem conferidos, o botão Concluir validação fiscal é habilitado. Clique nele.',
    'A carga fecha e aparece o aviso "Etapa da Fazenda concluída". Na ordem, a faixa verde confirma que a carga agora está com a Matriz.',
  ],
  shot: shot('fazenda-carga-documentos', 'Carga com a documentação pronta para validar'),
  note: 'Se o XML for recusado (nota de outro emitente, por exemplo), envie o arquivo correto: vale sempre o mais recente.',
};

const farmDone: GuideTask = {
  id: 'etapa-concluida',
  title: 'Conferir que a sua parte terminou',
  summary: 'Depois da validação fiscal não há mais nada a fazer na carga.',
  steps: [
    'Na ordem, a faixa "Etapa da Fazenda concluída" mostra a carga e o que a Matriz ainda vai fazer.',
    'Na aba Cargas, a etapa aparece como "Aguardando faturamento da Matriz" e, ao final, como "Concluída".',
    'Chegou outro caminhão da mesma ordem? Clique de novo em Informar chegada do caminhão.',
  ],
  shot: shot('fazenda-etapa-concluida', 'Faixa de etapa da Fazenda concluída'),
};

const farmUsers: GuideTask = {
  id: 'usuarios-fazenda',
  title: 'Administrar os usuários da fazenda',
  summary: 'O Administrador da Fazenda cuida dos acessos da própria equipe.',
  steps: [
    'Abra Gestão › Usuários. Você vê só as pessoas da sua fazenda.',
    'Use Convidar usuário para incluir alguém e escolha o papel: Operador Fazenda ou Administrador Fazenda.',
    'Clique em um usuário para trocar o papel ou desativar o acesso. A fazenda sempre mantém ao menos um Administrador ativo.',
  ],
  shot: shot('fazenda-usuarios', 'Usuários da fazenda'),
};

// ───────────────────────────── Comprador ─────────────────────────────

const buyerRequest: GuideTask = {
  id: 'solicitar',
  title: 'Solicitar uma ordem',
  summary: 'Você informa o que precisa; a Matriz define de qual fazenda sai.',
  steps: [
    'Em Ordens de Carregamento, clique em Nova solicitação.',
    'Informe commodity, quantidade, janela de carregamento, destino, frete e, se já souber, o transporte (transportadora, motorista e placas).',
    'Salve como rascunho para continuar depois, ou clique em Enviar ao Faturamento.',
  ],
  shot: shot('comprador-nova-solicitacao', 'Formulário de nova solicitação'),
  note: 'Enviar sem destino é permitido, mas o sistema pede confirmação.',
};

const buyerFollow: GuideTask = {
  id: 'acompanhar-solicitacao',
  title: 'Acompanhar, ajustar ou cancelar a solicitação',
  summary: 'Depois de enviada, a solicitação fica em análise no Faturamento.',
  steps: [
    'Enquanto está em "Aguardando faturamento", a solicitação fica somente para leitura.',
    'Se o Faturamento devolver, ela volta a rascunho com o motivo: ajuste e envie de novo.',
    'Você pode cancelar o rascunho ou a solicitação enviada enquanto a fazenda não foi definida. Depois disso, fale com a Matriz.',
  ],
  shot: shot('comprador-solicitacao-enviada', 'Solicitação aguardando faturamento'),
};

const buyerTrack: GuideTask = {
  id: 'acompanhar-ordem',
  title: 'Acompanhar o carregamento',
  summary: 'Da publicação à liberação para trânsito.',
  steps: [
    'Publicada a ordem, você recebe o aviso e passa a ver vendedor e fazenda.',
    'Na ordem, o quadro Quantidades mostra o carregado e o liberado para trânsito; a aba Cargas mostra cada caminhão e a etapa em que está.',
    'A Visão geral lista em "A caminho" as cargas liberadas nos últimos dias.',
  ],
  shot: shot('comprador-ordem', 'Ordem vista pelo Comprador'),
};

// ───────────────────────────── Capítulos ─────────────────────────────

const MATRIZ_MENU_BASE = ['Visão geral', 'Ordens de Carregamento', 'Ocorrências', 'Central de Documentos', 'Notas Fiscais', 'Commodities', 'Compradores', 'Vendedores', 'Fazendas', 'Gestão do ciclo', 'Preferências'];
const MATRIZ_DOCS = 'A Matriz acessa todos os documentos e notas fiscais.';

export const GUIDE_PROFILES: GuideProfile[] = [
  {
    slug: 'primeiros-passos',
    name: 'Primeiros passos',
    group: 'Para todos',
    roleCodes: [],
    tagline: 'Entrar, proteger a conta e se localizar na tela. Vale para todos os perfis.',
    does: ['Entrar com e-mail e senha', 'Ativar a verificação em duas etapas', 'Escolher o tema e os avisos por e-mail', 'Falar com a Matriz pelo atendimento'],
    doesNot: [],
    menu: [],
    tasks: [
      {
        id: 'entrar',
        title: 'Entrar no sistema',
        summary: 'Endereço: ordens.cooperfarms.digital.',
        steps: [
          'Informe seu e-mail e sua senha e clique em Entrar.',
          'Primeiro acesso por convite: abra o link recebido por e-mail (vale 72 horas) e crie sua senha.',
          'Primeiro acesso com senha provisória: entre com ela e o sistema pedirá uma senha nova.',
          'Esqueceu a senha? Use "Esqueci minha senha" na tela de entrada para receber o link de redefinição.',
        ],
        shot: shot('login', 'Tela de entrada'),
        note: 'Depois de várias tentativas erradas o acesso é bloqueado por alguns minutos.',
      },
      {
        id: 'seguranca',
        title: 'Proteger a sua conta',
        summary: 'Senha, verificação em duas etapas e sessões abertas ficam em Preferências.',
        steps: [
          'Abra Configurações › Preferências (ou clique no seu nome, no canto superior direito).',
          'Ative a verificação em duas etapas com um aplicativo autenticador e guarde os códigos de recuperação. Sua organização pode exigir isso.',
          'Em Sessões você vê onde a conta está aberta e pode encerrar as outras.',
          'Troque a senha quando quiser; as outras sessões são encerradas na hora.',
        ],
        shot: shot('preferencias', 'Preferências da conta'),
      },
      {
        id: 'tela',
        title: 'Conhecer a tela',
        summary: 'Menu à esquerda, busca e avisos no topo.',
        steps: [
          'O menu lateral mostra só o que o seu perfil pode acessar. Use Recolher para ganhar espaço.',
          'A busca do topo (Ctrl+K) encontra ordens e telas.',
          'O sino reúne os avisos: ordem publicada, solicitação devolvida, relatório pronto, resposta do atendimento.',
          'O ícone de sol ou lua troca entre tema claro, escuro e o do sistema.',
        ],
        shot: shot('matriz-visao-geral', 'Visão geral da Matriz'),
      },
      {
        id: 'avisos',
        title: 'Escolher os avisos por e-mail',
        summary: 'O aviso no sino é sempre criado; o e-mail é opcional.',
        steps: ['Em Preferências, ligue ou desligue os e-mails de forma geral.', 'Escolha os tipos que quer receber. Os que pedem ação já vêm ligados.'],
      },
      askSupport('comprador-atendimento'),
    ],
  },
  {
    slug: 'ciclo-da-carga',
    name: 'Ciclo da ordem e da carga',
    group: 'Para todos',
    roleCodes: [],
    tagline: 'O caminho completo, do pedido ao caminhão liberado, e quem faz cada passo.',
    does: ['Entender as etapas', 'Saber de quem é a vez', 'Saber o que cada parte enxerga'],
    doesNot: [],
    menu: [],
    tasks: [
      {
        id: 'ordem',
        title: '1. A ordem nasce',
        summary: 'Por dois caminhos: a Matriz lança, ou o Comprador solicita.',
        steps: [
          'Matriz: lança a ordem com vendedor, fazenda e comprador e publica.',
          'Comprador: envia a solicitação; o Faturamento define vendedor e fazenda (e o número do contrato, se houver) e publica.',
          'Publicada, a ordem aparece para a Fazenda e para o Comprador e já autoriza carregar.',
        ],
        shot: shot('matriz-ordem-publicada', 'Ordem publicada'),
      },
      {
        id: 'fazenda',
        title: '2. A Fazenda carrega',
        summary: 'Chegada, carregamento, pesagem e nota fiscal.',
        steps: [
          'Informar chegada do caminhão: cria a carga (Aguardando carregamento).',
          'Iniciar carregamento → informar peso bruto e tara → Confirmar carregamento.',
          'Anexar PDF e XML da nota da fazenda → Concluir validação fiscal. A parte da Fazenda termina aqui.',
        ],
        shot: shot('fazenda-carga-chegada', 'Carga criada pela chegada do caminhão'),
      },
      {
        id: 'matriz',
        title: '3. A Matriz fatura e libera',
        summary: 'O caminhão só sai depois do faturamento da Matriz.',
        steps: [
          'Anexar PDF e XML da nota emitida pela Matriz ao Comprador → Registrar faturamento da Matriz.',
          'Liberar para trânsito: conclui a carga. Só a Matriz faz esse passo.',
          'Quando não há mais o que carregar, a ordem é concluída.',
        ],
        shot: shot('matriz-carga-liberar', 'Carga faturada, pronta para liberar'),
      },
      {
        id: 'quem-ve',
        title: 'O que cada parte enxerga',
        summary: 'Cada organização vê só o que é dela.',
        steps: [
          'Matriz: todas as ordens, cargas, documentos e notas.',
          'Fazenda: as ordens publicadas para ela, as cargas delas e a nota que ela mesma emitiu. Não vê a nota da Matriz ao Comprador.',
          'Comprador: as próprias solicitações e ordens, e a nota que a Matriz emitiu para ele. Não vê a nota da Fazenda nem preço.',
        ],
        shot: shot('comprador-documentos', 'Documentos vistos pelo Comprador'),
      },
    ],
  },
  {
    slug: 'administrador-matriz',
    name: 'Administrador Matriz',
    group: 'Matriz',
    roleCodes: ['MATRIZ_ADMIN'],
    tagline: 'Acesso completo: opera, gerencia e configura o sistema.',
    does: ['Tudo o que o Gestor faz', 'Convidar, editar e desativar usuários; definir senha provisória', 'Criar papéis personalizados e grupos de acesso', 'Configurar segurança, workflow e parâmetros'],
    doesNot: ['Desativar o próprio acesso', 'Alterar ou apagar a auditoria'],
    menu: [...MATRIZ_MENU_BASE, 'Atendimento', 'Relatórios', 'Auditoria', 'Usuários', 'Papéis e permissões', 'Grupos de acesso', 'Segurança', 'Workflow', 'Parâmetros'],
    tasks: [overview('matriz-visao-geral', 'da operação'), findOrders('matriz-ordens'), createOrder, publishOrder, assignFarm, nextStep, matrizLoad, orderLifecycle, deleteOrder, documents('matriz-documentos', MATRIZ_DOCS), occurrences(true), registry, commodities, cycle, reports, audit, manageUsers, roles, settings, supportManage],
  },
  {
    slug: 'gestor-matriz',
    name: 'Gestor Matriz',
    group: 'Matriz',
    roleCodes: ['MATRIZ_MANAGER'],
    tagline: 'Conduz a operação: publica, fatura, encerra e acompanha os números.',
    does: ['Lançar, publicar, suspender, concluir, cancelar e excluir ordens', 'Tratar solicitações do Comprador', 'Faturar cargas e liberar para trânsito', 'Relatórios, auditoria e gestão do atendimento', 'Criar usuários com senha provisória'],
    doesNot: ['Editar ou desativar usuários existentes', 'Criar papéis ou grupos de acesso', 'Alterar segurança, workflow e parâmetros'],
    menu: [...MATRIZ_MENU_BASE, 'Atendimento', 'Relatórios', 'Auditoria', 'Usuários'],
    tasks: [overview('gestor-visao-geral', 'da operação'), findOrders('matriz-ordens'), createOrder, publishOrder, assignFarm, nextStep, matrizLoad, orderLifecycle, deleteOrder, documents('matriz-documentos', MATRIZ_DOCS), occurrences(true), registry, commodities, cycle, reports, audit, createUsers, supportManage],
  },
  {
    slug: 'operador-matriz',
    name: 'Operador Matriz',
    group: 'Matriz',
    roleCodes: ['MATRIZ_OPERATOR'],
    tagline: 'O dia a dia: prepara ordens, acompanha cargas, fatura e libera caminhões.',
    does: ['Lançar e editar ordens e pedir a publicação', 'Informar chegada pela Fazenda, quando preciso', 'Faturar cargas e liberar para trânsito', 'Registrar ocorrências e anexar documentos', 'Manter compradores, vendedores e fazendas', 'Atender conversas das filas em que foi incluído'],
    doesNot: ['Publicar, suspender, cancelar ou excluir ordens', 'Tratar solicitações do Comprador', 'Relatórios, auditoria e usuários'],
    menu: [...MATRIZ_MENU_BASE, 'Atendimento (filas que atende)'],
    tasks: [overview('operador-visao-geral', 'da operação'), findOrders('matriz-ordens'), createOrder, requestPublish, nextStep, matrizLoad, documents('matriz-documentos', MATRIZ_DOCS), occurrences(true), registry, cycle, supportAttend],
  },
  {
    slug: 'faturamento',
    name: 'Faturamento',
    group: 'Matriz',
    roleCodes: ['MATRIZ_BILLING'],
    tagline: 'Recebe os pedidos do Comprador, define a origem e publica.',
    does: ['Tratar solicitações do Comprador: definir vendedor, fazenda e contrato; publicar ou devolver', 'Lançar e publicar ordens da Matriz', 'Consultar cargas, documentos e notas', 'Atender a fila de Faturamento'],
    doesNot: ['Avançar etapas da carga ou anexar notas (é feito por Operador, Gestor ou Administrador)', 'Suspender, cancelar ou excluir ordens', 'Alterar cadastros', 'Relatórios, auditoria e usuários'],
    menu: [...MATRIZ_MENU_BASE, 'Atendimento (filas que atende)'],
    tasks: [
      overview('faturamento-visao-geral', 'da operação'),
      { ...findOrders('faturamento-solicitacoes'), summary: 'As solicitações do Comprador chegam com a situação "Aguardando faturamento".' },
      assignFarm,
      createOrder,
      publishOrder,
      { ...nextStep, title: 'Acompanhar as cargas', summary: 'Você consulta as cargas e vê com quem cada uma está.' },
      documents('matriz-documentos', MATRIZ_DOCS),
      occurrences(false),
      supportAttend,
    ],
  },
  {
    slug: 'atendente',
    name: 'Atendente',
    group: 'Matriz',
    roleCodes: ['MATRIZ_SUPPORT_AGENT'],
    tagline: 'Responde Fazendas e Compradores e consulta a operação para ajudar.',
    does: ['Atender as conversas das filas em que foi incluído', 'Consultar ordens, cargas, documentos e ocorrências', 'Ver os indicadores do atendimento'],
    doesNot: ['Lançar ou alterar ordens e cargas', 'Alterar cadastros', 'Relatórios, auditoria e usuários'],
    menu: [...MATRIZ_MENU_BASE, 'Atendimento (filas que atende)', 'Indicadores'],
    tasks: [overview('atendente-visao-geral', 'da operação'), supportAttend, findOrders('matriz-ordens'), { ...nextStep, title: 'Ver em que etapa está uma carga', summary: 'Útil para responder "onde está meu caminhão?".' }, documents('matriz-documentos', MATRIZ_DOCS), occurrences(false)],
  },
  {
    slug: 'consulta-matriz',
    name: 'Somente leitura Matriz',
    group: 'Matriz',
    roleCodes: ['MATRIZ_VIEWER'],
    tagline: 'Consulta toda a operação, sem alterar nada.',
    does: ['Consultar ordens, cargas, documentos, notas e ocorrências', 'Consultar cadastros e a gestão do ciclo'],
    doesNot: ['Lançar, editar ou publicar ordens', 'Avançar cargas ou anexar documentos', 'Atender conversas'],
    menu: MATRIZ_MENU_BASE,
    tasks: [overview('matriz-visao-geral', 'da operação'), findOrders('matriz-ordens'), { ...nextStep, title: 'Ver em que etapa está cada carga', summary: 'A ordem e a carga dizem com quem está a vez.' }, documents('matriz-documentos', MATRIZ_DOCS), occurrences(false), cycle],
  },
  {
    slug: 'administrador-fazenda',
    name: 'Administrador Fazenda',
    group: 'Fazenda',
    roleCodes: ['FARM_ADMIN'],
    tagline: 'Carrega, documenta e cuida dos acessos da própria fazenda.',
    does: ['Tudo o que o Operador Fazenda faz', 'Convidar e gerenciar os usuários da fazenda', 'Atualizar os dados da fazenda'],
    doesNot: ['Ver ordens de outras fazendas', 'Ver a nota da Matriz ao Comprador', 'Faturar ou liberar a carga para trânsito', 'Lançar ou alterar ordens'],
    menu: ['Visão geral', 'Ordens de Carregamento', 'Ocorrências', 'Central de Documentos', 'Notas Fiscais', 'Fazendas', 'Usuários', 'Preferências'],
    tasks: [overview('fazenda-visao-geral', 'da sua fazenda'), findOrders('fazenda-ordens'), farmArrival, farmLoading, farmDocs, farmDone, documents('fazenda-documentos', 'A Fazenda acessa só o que é dela: a nota que emitiu e os arquivos que enviou.'), occurrences(true), farmUsers, askSupport('comprador-atendimento')],
  },
  {
    slug: 'operador-fazenda',
    name: 'Operador Fazenda',
    group: 'Fazenda',
    roleCodes: ['FARM_OPERATOR'],
    tagline: 'Informa a chegada do caminhão, carrega, pesa e anexa a nota.',
    does: ['Informar a chegada do caminhão', 'Iniciar e confirmar o carregamento, com peso bruto e tara', 'Anexar PDF e XML da nota e concluir a validação fiscal', 'Registrar ocorrências', 'Falar com a Matriz pelo atendimento'],
    doesNot: ['Ver ordens de outras fazendas', 'Ver a nota da Matriz ao Comprador', 'Faturar ou liberar a carga para trânsito', 'Gerenciar usuários'],
    menu: ['Visão geral', 'Ordens de Carregamento', 'Ocorrências', 'Central de Documentos', 'Notas Fiscais', 'Fazendas', 'Preferências'],
    tasks: [overview('fazenda-visao-geral', 'da sua fazenda'), findOrders('fazenda-ordens'), farmArrival, farmLoading, farmDocs, farmDone, documents('fazenda-documentos', 'A Fazenda acessa só o que é dela: a nota que emitiu e os arquivos que enviou.'), occurrences(true), askSupport('comprador-atendimento')],
  },
  {
    slug: 'comprador',
    name: 'Comprador',
    group: 'Comprador',
    roleCodes: ['BUYER_USER'],
    tagline: 'Solicita ordens, acompanha o carregamento e baixa a nota.',
    does: ['Criar, editar e enviar solicitações de ordem', 'Cancelar a solicitação antes da análise', 'Acompanhar ordens e cargas', 'Baixar a nota que a Matriz emitiu', 'Falar com a Matriz pelo atendimento'],
    doesNot: ['Ver ordens de outros compradores', 'Ver preço, valor ou a nota da Fazenda', 'Escolher vendedor ou fazenda', 'Alterar a solicitação depois de enviada'],
    menu: ['Visão geral', 'Ordens de Carregamento', 'Ocorrências', 'Central de Documentos', 'Notas Fiscais', 'Preferências'],
    tasks: [overview('comprador-visao-geral', 'das suas ordens'), buyerRequest, buyerFollow, buyerTrack, documents('comprador-documentos', 'O Comprador acessa só o que a Matriz gerou para ele: a nota da Matriz, em PDF e XML.'), occurrences(false), askSupport('comprador-atendimento')],
  },
];

export const GUIDE_GROUPS: GuideGroup[] = ['Para todos', 'Matriz', 'Fazenda', 'Comprador'];

export const guideProfile = (slug: string) => GUIDE_PROFILES.find((p) => p.slug === slug);

/** Capítulo do perfil de quem está logado (pelo papel; na falta, pelo tipo de organização). */
export function profileForUser(roles: readonly string[] | undefined, scope: string | undefined): GuideProfile | undefined {
  const byRole = GUIDE_PROFILES.find((p) => p.roleCodes.some((r) => roles?.includes(r)));
  if (byRole) return byRole;
  if (scope === 'FARM') return guideProfile('operador-fazenda');
  if (scope === 'BUYER') return guideProfile('comprador');
  if (scope === 'MATRIZ') return guideProfile('consulta-matriz');
  return undefined;
}
