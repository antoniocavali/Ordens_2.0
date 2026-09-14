/** Nomes legíveis de ações e entidades da auditoria. Ações desconhecidas aparecem pelo código. */
export const ACTION_LABELS: Record<string, string> = {
  'order.created': 'Ordem criada',
  'order.published': 'Ordem publicada',
  'order.version_created': 'Nova versão da ordem',
  'order.release_created': 'Liberação criada',
  'order.release_cancelled': 'Liberação cancelada',
  'order.status_changed': 'Status da ordem alterado',
  'order.viewed': 'Ordem visualizada',
  'order.invoice_attached': 'NF-e vinculada à ordem',
  'order.invoice_cancelled': 'NF-e da ordem cancelada',
  'order.occurrence_opened': 'Ocorrência aberta na ordem',
  'order.appointment_created': 'Agendamento criado na ordem',
  'order.load_created': 'Carga criada na ordem',
  'order.load_status': 'Status de carga da ordem alterado',
  'tenant.created': 'Empresa criada',
  'auth.2fa.setup_started': 'Configuração de 2FA iniciada',
  'auth.2fa.enabled': 'Verificação em duas etapas ativada',
  'auth.2fa.disabled': 'Verificação em duas etapas desativada',
  'auth.2fa.recovery_codes_regenerated': 'Códigos de recuperação gerados',
  'appointment.created': 'Agendamento criado',
  'appointment.updated': 'Agendamento alterado',
  'appointment.status_changed': 'Status do agendamento alterado',
  'load.created': 'Carga criada',
  'load.updated': 'Carga alterada',
  'load.status_changed': 'Status da carga alterado',
  'occurrence.opened': 'Ocorrência aberta',
  'occurrence.updated': 'Ocorrência alterada',
  'occurrence.status_changed': 'Status da ocorrência alterado',
  'invoice.cancelled': 'NF-e cancelada',
  'document.visibility_changed': 'Visibilidade do documento alterada',
  'document.downloaded': 'Documento baixado',
  'upload.initiated': 'Envio iniciado',
  'upload.completed': 'Envio concluído',
  'upload.available': 'Arquivo disponível',
  'upload.rejected': 'Arquivo rejeitado',
  'upload.infected': 'Arquivo bloqueado (malware)',
  'upload.aborted': 'Envio cancelado',
  'partner.created': 'Parceiro cadastrado',
  'partner.updated': 'Parceiro alterado',
  'location.created': 'Local cadastrado',
  'location.updated': 'Local alterado',
  'location.archived': 'Local arquivado',
  'location.restored': 'Local restaurado',
  'farm.created': 'Fazenda cadastrada',
  'farm.updated': 'Fazenda alterada',
  'contract.created': 'Contrato criado',
  'contract.updated': 'Contrato alterado',
  'commodity.created': 'Commodity cadastrada',
  'support.conversation_started': 'Atendimento aberto',
  'support.conversation_queued': 'Atendimento na fila',
  'support.status_changed': 'Status do atendimento alterado',
  'support.assigned': 'Responsável do atendimento alterado',
  'support.updated': 'Atendimento transferido/alterado',
  'support.team_updated': 'Filas da equipe alteradas',
  'user.invited': 'Usuário convidado',
  'user.created': 'Usuário criado',
  'user.invite_resent': 'Convite reenviado',
  'user.membership_updated': 'Acesso do usuário alterado',
  'user.permissions_granted': 'Permissão individual alterada',
  'user.temporary_password_set': 'Senha provisória definida',
  'role.created': 'Papel criado',
  'role.updated': 'Papel alterado',
  'role.archived': 'Papel arquivado',
  'role.restored': 'Papel restaurado',
  'tenant.security_policy_updated': 'Política de segurança alterada',
  'report.exported': 'Relatório exportado',
  'auth.login.succeeded': 'Login realizado',
  'auth.login.failed': 'Falha de login',
  'auth.locked': 'Acesso bloqueado temporariamente',
  'auth.logout': 'Logout',
  'auth.logout_all': 'Logout de todos os dispositivos',
  'auth.password.changed': 'Senha alterada',
  'auth.password.temporary_replaced': 'Senha provisória substituída',
  'auth.password.reset_requested': 'Redefinição de senha solicitada',
  'auth.password.reset': 'Senha redefinida por link',
  'auth.2fa.verified': 'Verificação em duas etapas concluída',
  'auth.2fa.failed': 'Código de verificação inválido',
  'auth.context.switched': 'Organização ativa alterada',
  'auth.session.revoked': 'Sessão encerrada',
};

export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

/** Filtros por área: prefixo da ação e/ou tipo de entidade. */
export const AUDIT_AREAS: { key: string; label: string; action?: string; entityType?: string }[] = [
  { key: 'orders', label: 'Ordens', action: 'order.' },
  { key: 'appointments', label: 'Agendamentos', action: 'appointment.' },
  { key: 'loads', label: 'Cargas', action: 'load.' },
  { key: 'occurrences', label: 'Ocorrências', action: 'occurrence.' },
  { key: 'documents', label: 'Documentos e envios', action: 'upload.' },
  { key: 'partners', label: 'Parceiros', action: 'partner.' },
  { key: 'farms', label: 'Fazendas', action: 'farm.' },
  { key: 'locations', label: 'Locais', action: 'location.' },
  { key: 'contracts', label: 'Contratos', action: 'contract.' },
  { key: 'support', label: 'Atendimento', action: 'support.' },
  { key: 'users', label: 'Usuários', action: 'user.' },
  { key: 'roles', label: 'Papéis e permissões', action: 'role.' },
  { key: 'auth', label: 'Acesso e segurança', action: 'auth.' },
  { key: 'reports', label: 'Relatórios', action: 'report.' },
];

/** Link para abrir a entidade na plataforma, quando há tela para ela. */
export function entityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case 'loading_order':
      return `/ordens/${entityId}`;
    case 'load':
      return `/cargas?abrir=${entityId}`;
    case 'support_conversation':
      return `/atendimento?conversa=${entityId}`;
    case 'farm':
      return `/cadastros/fazendas?abrir=${entityId}`;
    case 'location':
      return `/cadastros/locais?abrir=${entityId}`;
    case 'role':
      return '/gestao/papeis';
    case 'membership':
    case 'user':
      return '/gestao/usuarios';
    default:
      return null;
  }
}

export const ENTITY_LABELS: Record<string, string> = {
  loading_order: 'Ordem',
  load: 'Carga',
  appointment: 'Agendamento',
  occurrence: 'Ocorrência',
  invoice: 'NF-e',
  file_upload: 'Arquivo',
  support_conversation: 'Atendimento',
  support_team: 'Equipe do atendimento',
  membership: 'Acesso',
  user: 'Usuário',
  partner: 'Parceiro',
  farm: 'Fazenda',
  location: 'Local',
  contract: 'Contrato',
  commodity: 'Commodity',
  driver: 'Motorista',
  vehicle: 'Veículo',
  role: 'Papel',
  tenant: 'Empresa',
  session: 'Sessão',
  report: 'Relatório',
};
