-- Login por passkey (WebAuthn). A tabela webauthn_credentials já existe (reservada na fundação,
-- com RLS own_rows); aqui entram o resultado de login e se a credencial é sincronizada entre aparelhos.
alter type login_result add value if not exists 'PASSKEY_SUCCESS';
alter type login_result add value if not exists 'PASSKEY_FAILED';

alter table webauthn_credentials add column backed_up boolean not null default false;
