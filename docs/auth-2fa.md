# Autenticação e 2FA

## Senhas

- Hash **Argon2id** (`@node-rs/argon2`): `memoryCost 19456 KiB, timeCost 2, parallelism 1` (mínimo OWASP), parâmetros re-hash transparente quando atualizados.
- Política: mínimo 12 caracteres, verificação contra lista de senhas comuns, sem regras de composição arbitrárias.
- Recuperação: token de 32 bytes, guardado como sha256, expira em 30 min, uso único; resposta idêntica exista ou não o e-mail; e-mail enviado pelo worker via outbox.
- Troca de senha exige senha atual (+ TOTP se ativo) e incrementa `security_version` (derruba outras sessões; a atual é rotacionada).

## TOTP

- `otplib`, SHA-1, 6 dígitos, período 30 s, janela ±1 passo. Compatível com Google/Microsoft Authenticator, Authy.
- Segredo cifrado com **AES-256-GCM** (`TWO_FACTOR_ENC_KEY`, 32 bytes base64, com `key_version` para rotação) em `two_factor_credentials.secret_enc`.
- Proteção contra replay: último `time_step` aceito é armazenado; o mesmo passo não é aceito duas vezes.

### Ativação

1. `POST /auth/2fa/setup` → gera segredo (não confirmado), retorna `otpauth://` URI + QR Code (data URL SVG).
2. `POST /auth/2fa/confirm` com código → confirma, gera **10 recovery codes** (formato `xxxx-xxxx-xx`, exibidos uma única vez, armazenados com Argon2id).
3. `security_version` **não** muda na ativação; sessão atual é rotacionada.

### Login

Sessão `PENDING_2FA` → `POST /auth/2fa/verify { code }` aceita TOTP ou recovery code. Recovery code usado é marcado `used_at` e nunca mais aceito. Tentativas inválidas contam no lockout.

### Desativação / regeneração

Exigem senha + código atual. Desativar incrementa `security_version`. Regenerar recovery codes invalida os anteriores.

## Política por tenant

`tenants.require_2fa` (bool) e `tenants.require_2fa_roles` (lista de códigos de papel). Se a membership ativa exigir 2FA e o usuário não tiver, a sessão fica `PENDING_2FA_SETUP` até ativar.

## Futuro: WebAuthn / Passkeys

Tabela `webauthn_credentials` já criada (credential_id, public_key, sign_count, transports, name). O fluxo de verificação será uma segunda implementação de `SecondFactorVerifier`.

## Auditoria

`auth.login.succeeded`, `auth.login.failed`, `auth.locked`, `auth.logout`, `auth.logout_all`, `auth.password.changed`, `auth.password.reset_requested`, `auth.password.reset`, `auth.2fa.setup_started`, `auth.2fa.enabled`, `auth.2fa.disabled`, `auth.2fa.verified`, `auth.2fa.failed`, `auth.2fa.recovery_code_used`, `auth.2fa.recovery_codes_regenerated`, `auth.session.revoked`, `auth.context.switched`.
