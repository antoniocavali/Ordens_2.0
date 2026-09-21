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

## Passkeys (WebAuthn)

Login sem senha e resistente a phishing, com `@simplewebauthn/server` na API e `@simplewebauthn/browser` na web.

- **RP**: `rpID` = host de `WEB_ORIGIN`; origem esperada = `WEB_ORIGIN`. Atestação `none`.
- **Cadastro** (`POST /auth/passkeys/register/options` → `POST /auth/passkeys/register`): exige a senha atual (uma sessão roubada não planta acesso permanente), passkey descoberta (`residentKey: required`) e verificação no aparelho (`userVerification: required`). Até 10 por usuário. Desafio no Redis por sessão, 5 min, uso único.
- **Login** (`POST /auth/passkeys/login/options` → `POST /auth/passkeys/login`): sem e-mail; o desafio tem id aleatório no Redis (5 min, GETDEL). Verifica assinatura, origem, RP, UV e contador. Como a verificação no aparelho é obrigatória, **vale como segundo fator**: a sessão nasce `ACTIVE` sem TOTP e satisfaz a política de 2FA obrigatória. Senha provisória continua exigindo a troca.
- **Falhas** entram no bloqueio progressivo por IP, em `login_attempts` (`PASSKEY_FAILED`) e na auditoria (`auth.passkey.failed`). Sucesso: `PASSKEY_SUCCESS` e `auth.login.succeeded` com `method: passkey`.
- **Gestão** em Preferências: listar, renomear, remover (`auth.passkey.added/renamed/removed`). RLS `own_rows`: cada usuário só vê as próprias.

## Auditoria

`auth.login.succeeded`, `auth.login.failed`, `auth.locked`, `auth.logout`, `auth.logout_all`, `auth.password.changed`, `auth.password.reset_requested`, `auth.password.reset`, `auth.2fa.setup_started`, `auth.2fa.enabled`, `auth.2fa.disabled`, `auth.2fa.verified`, `auth.2fa.failed`, `auth.2fa.recovery_code_used`, `auth.2fa.recovery_codes_regenerated`, `auth.session.revoked`, `auth.context.switched`.
