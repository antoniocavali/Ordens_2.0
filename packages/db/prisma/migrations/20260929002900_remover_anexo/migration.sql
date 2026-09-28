-- Remoção de anexo com motivo: quem anexa o arquivo errado precisa tirá-lo da conferência fiscal
-- sem apagar o rastro. O registro continua na tabela (e o objeto, no storage) marcado como REMOVED,
-- com quem removeu, quando e por quê — documento fiscal não some do histórico.

alter type upload_status add value if not exists 'REMOVED';

alter table file_uploads
  add column removed_at timestamptz,
  add column removed_by uuid,
  add column remove_reason text;
