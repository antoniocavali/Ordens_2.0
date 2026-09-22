# Implantação em produção (servidor Linux + Cloudflare Tunnel)

Roteiro do zero ao sistema no ar em **`https://ordens.cooperfarms.digital`**, em um servidor bare metal
com Docker Compose. Arquivos: [`docker-compose.prod.yml`](../docker-compose.prod.yml),
[`scripts/deploy/`](../scripts/deploy) e [`deploy/systemd/`](../deploy/systemd).

## Visão geral

```
Navegador ──HTTPS──► Cloudflare (TLS, WAF) ◄──saída── cloudflared ─┬─► web   :3000  (páginas e /api/*)
                                                                    ├─► api   :4000  (/realtime/* — SSE)
                                                                    └─► minio :9000  (/ordens-*/… URLs assinadas)

web ─► api ─► postgres · redis · minio · clamav        worker ─► postgres · redis · minio · clamav · Microsoft Graph (e-mail) · pasta de rede (SMB)
```

- **Nenhuma porta é publicada no host.** O servidor só faz conexões de saída. O firewall pode bloquear
  toda entrada (exceto SSH pela rede de gestão).
- Um único nome público. O túnel separa por caminho: arquivos (URLs assinadas), tempo real e o resto.
  Por ser a mesma origem, não há CORS nem segundo domínio.
- Imagens construídas no próprio servidor (`docker compose build`).

## 1. Servidor

Ubuntu Server 24.04 LTS, x86_64, **8 vCPU, 16 GB de RAM, 250–500 GB de NVMe** (2 discos em RAID 1).
Os limites de memória do Compose assumem esse porte: PostgreSQL 4 GB, worker 4 GB (relatórios grandes
ficam inteiros na memória), ClamAV 3 GB, e ≈ 4 GB para API, web, Redis, MinIO e túnel. Abaixo de
16 GB, reduza os limites e desconfie do ClamAV e do worker primeiro.

```bash
# Atualizações, relógio e ferramentas
sudo apt update && sudo apt -y full-upgrade
sudo apt -y install unattended-upgrades fail2ban chrony ufw git openssl
sudo dpkg-reconfigure -plow unattended-upgrades

# Firewall: nada de entrada além do SSH (o túnel é de saída)
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow from <IP-DA-SUA-REDE-DE-GESTAO> to any port 22 proto tcp
sudo ufw enable

# Redis pede overcommit de memória
echo 'vm.overcommit_memory=1' | sudo tee /etc/sysctl.d/90-ordens.conf && sudo sysctl --system

# Docker Engine + Compose v2 pelo repositório OFICIAL (não use o pacote docker.io da distribuição,
# que atrasa correções de segurança). https://docs.docker.com/engine/install/ubuntu/
sudo apt -y remove docker.io docker-compose docker-compose-v2 docker-doc podman-docker 2>/dev/null || true
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
ARCH="$(dpkg --print-architecture)"
sudo tee /etc/apt/sources.list.d/docker.list > /dev/null <<EOF
deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $CODENAME stable
EOF
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker "$USER"   # sair e entrar de novo (ou `newgrp docker` na mesma sessão)
docker compose version            # confirma o plugin instalado
sudo docker run --rm hello-world  # confirma que o Engine está funcionando
```

- SSH só por chave (`PasswordAuthentication no`), sem login de root.
- Nobreak com desligamento automático (NUT/apcupsd) e alerta de RAID/disco/temperatura por e-mail.
- Se o Docker precisar ficar em outro disco, ajuste `data-root` em `/etc/docker/daemon.json`.

## 2. Cloudflare

1. **Conta**: ative 2FA na conta Cloudflare. Quem controla a conta controla o acesso ao sistema.
2. **DNS**: o domínio `cooperfarms.digital` precisa estar na Cloudflare.
3. **Túnel**: *Zero Trust › Networks › Tunnels › Create a tunnel › Cloudflared*, nome `ordens-prod`.
   Copie o **token** (vai para `CLOUDFLARE_TUNNEL_TOKEN`). Não instale o conector: ele roda no Compose.
4. **Public hostnames** (na versão nova do painel: *Published applications*). Crie **nesta ordem** (a
   primeira regra que casar vale), todas em `ordens.cooperfarms.digital`:

   | # | Caminho (regex) | Serviço |
   |---|---|---|
   | 1 | `^/(ordens-quarantine\|ordens-documents)/` | `HTTP` · `minio:9000` |
   | 2 | `^/realtime/` | `HTTP` · `api:4000` |
   | 3 | *(vazio)* | `HTTP` · `web:3000` |

   Não configure "HTTP Host Header": o Host original precisa chegar ao MinIO, senão a assinatura das
   URLs de upload/download é recusada.
5. **Regras do domínio** (obrigatórias):
   - *Caching › Cache Rules*: **Bypass cache** para o host `ordens.cooperfarms.digital` (a aplicação é
     toda dinâmica; os downloads assinados já saem com `Cache-Control: private, no-store`).
   - *Speed*: desligue Rocket Loader e Auto Minify (quebram a política de conteúdo do sistema).
   - *SSL/TLS*: "Always Use HTTPS" ligado, TLS mínimo 1.2.
6. **Recomendadas**:
   - *WAF › Rate limiting*: por IP em `POST /api/auth/login` e `/api/auth/passkeys/login` (ex.: 20 por minuto).
   - *Security › Bots*: Bot Fight Mode.
   - *Access* (Zero Trust): política extra (e-mail corporativo ou provedor de identidade) para as
     telas administrativas, se quiser uma segunda barreira.

## 3. Aplicação

```bash
sudo mkdir -p /srv/ordens && sudo chown "$USER" /srv/ordens
git clone https://github.com/antoniocavali/Ordens_2.0.git /srv/ordens && cd /srv/ordens

PUBLIC_HOST=ordens.cooperfarms.digital ./scripts/deploy/gen-env.sh   # cria .env.production (0600)
nano .env.production    # preencha CLOUDFLARE_TUNNEL_TOKEN e GRAPH_* (seção 3.1)
```

> **Guarde uma cópia do `.env.production` fora do servidor** (cofre de senhas). Sem a
> `TWO_FACTOR_ENC_KEY`, um restore do banco não recupera os segredos de 2FA cadastrados nem a senha da
> pasta de rede; sem a `SESSION_SECRET`, todas as sessões precisam ser reabertas.

### 3.1 E-mail pelo Microsoft 365 (Graph)

O sistema envia convites, redefinição de senha e avisos **pela API Microsoft Graph**, com um aplicativo
registrado no Entra ID (sem senha de usuário e sem SMTP). O acesso do aplicativo é **limitado a uma única
caixa** pelo *RBAC para Aplicativos* do Exchange Online (que substitui as políticas de acesso legadas). Quem
faz: a TI do Microsoft 365, com as funções *Exchange Administrator* e *Organization Management*.

1. **Caixa remetente**: crie (ou escolha) a caixa, por exemplo `nao-responda@cooperfarms.digital`. Uma caixa
   compartilhada costuma bastar; confirme com a TI. Ela vai em `GRAPH_SENDER`.
2. **Registrar o aplicativo** (Entra admin center › Applications › App registrations › New registration): nome
   `Ordens - envio de e-mail`, "somente este diretório". Anote:
   - *Application (client) ID* → `GRAPH_CLIENT_ID`
   - *Directory (tenant) ID* → `GRAPH_TENANT_ID`
3. **Segredo**: *Certificates & secrets › New client secret* (validade de até 24 meses). Copie o **Value**
   na hora (não aparece de novo) → `GRAPH_CLIENT_SECRET`. **Anote a data de vencimento e renove antes**: quando
   vence, o envio de e-mails para (o worker registra o erro e a fila tenta de novo).
4. **NÃO conceda permissões de API no Entra** (nem `Mail.Send`): elas valem para todas as caixas da empresa.
   O acesso será dado só no Exchange, no passo seguinte.
5. **Object ID do aplicativo empresarial**: em *Enterprise applications*, abra `Ordens - envio de e-mail` e copie
   o *Object ID*. Atenção: **não** é o Object ID da página *App registrations* (são valores diferentes).
6. **Exchange Online PowerShell** (`Connect-ExchangeOnline`), trocando os valores:

   ```powershell
   New-ServicePrincipal -AppId <client-id> -ObjectId <object-id-do-aplicativo-empresarial> -DisplayName "Ordens - envio de e-mail"
   New-ManagementScope -Name "Ordens-remetente" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'nao-responda@cooperfarms.digital'"
   New-ManagementRoleAssignment -App <object-id-do-aplicativo-empresarial> -Role "Application Mail.Send" -CustomResourceScope "Ordens-remetente"
   Test-ServicePrincipalAuthorization -Identity <object-id-do-aplicativo-empresarial> -Resource nao-responda@cooperfarms.digital
   ```

   O último comando deve mostrar `InScope = True`. As mudanças levam de **30 min a 2 h** para valer no envio real.
7. Preencha `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` e `GRAPH_SENDER` no `.env.production`
   e **teste o envio** (depois da propagação):

   ```bash
   dc run --rm worker node apps/worker/dist/tools/send-test-mail.js seu-email@cooperfarms.digital
   ```

   Falha 403 = permissão ainda não propagada ou escopo errado (a mensagem indica o que conferir); "recusou o
   token" = ID ou segredo errado/vencido.

Limites do Exchange Online: cerca de 30 mensagens por minuto por caixa; acima disso a Graph responde 429 e a fila
repete com espera crescente. Se a empresa preferir SMTP, use `MAIL_TRANSPORT=smtp` e as variáveis `SMTP_*`
(o Microsoft 365 desliga o SMTP com senha por padrão no fim de dezembro de 2026).

Atalho para os comandos abaixo:

```bash
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.production'
```

**Primeira subida**

```bash
dc build                                   # 5–10 min na primeira vez
dc up -d postgres redis minio clamav       # infraestrutura (o ClamAV baixa as assinaturas: ~5 min)
dc run --rm migrate                        # migrations + catálogo de papéis (idempotente)

# Primeira empresa e primeiro Administrador Matriz (senha provisória aparece uma vez, só no terminal)
dc run --rm \
  -e BOOTSTRAP_TENANT_NAME="Cooperfarms" -e BOOTSTRAP_TENANT_SLUG="cooperfarms" \
  -e BOOTSTRAP_ADMIN_NAME="Nome do Administrador" -e BOOTSTRAP_ADMIN_EMAIL="admin@cooperfarms.digital" \
  migrate node dist/seed/bootstrap.js

dc up -d                                   # sobe tudo, inclusive o túnel
dc ps                                      # tudo "healthy" (o ClamAV pode levar alguns minutos)
```

**Primeiro acesso**: abra `https://ordens.cooperfarms.digital`, entre com o e-mail e a senha provisória,
troque a senha e ative a verificação em duas etapas (obrigatória para o Administrador). Depois cadastre
as demais pessoas em *Gestão › Usuários*. Ajustes da empresa em *Configurações* (Segurança, Workflow,
Parâmetros — inclusive a pasta de rede do XML).

### Verificação depois de subir

- `dc ps`: todos `healthy`; `dc logs migrate` sem erro; `dc logs cloudflared` com "Registered tunnel connection".
- Página de login abre por HTTPS; cabeçalho `Strict-Transport-Security` presente.
- Entrar, abrir uma ordem, anexar um PDF pequeno e um XML (passa pelo ClamAV e pelo worker) e baixá-lo.
- Tempo real: abrir duas abas e ver o aviso do sino chegar sem recarregar.
- *Preferências › Histórico de acesso*: o **IP registrado é o seu** (não o interno do Docker).
- Login com passkey (cadastrar em *Preferências*).
- *Parâmetros*: testar a conexão com a pasta de rede (o servidor precisa alcançar a porta 445 do servidor de arquivos).
- E-mail: `send-test-mail.js` (seção 3.1) e, depois, pedir "Esqueci minha senha" e conferir a chegada.

## 4. Atualizar e voltar atrás

```bash
cd /srv/ordens && git pull
dc build                # as imagens novas recebem a tag IMAGE_TAG (latest)
dc up -d                # roda as migrations (migrate) e recria só o que mudou
```

- Faça um backup antes de atualizações com migrations (`./scripts/deploy/backup.sh`).
- Para poder voltar atrás, antes do `build` marque as imagens atuais: `for s in api worker web migrate; do docker tag ordens/$s:latest ordens/$s:anterior; done`
  e, se algo der errado, `IMAGE_TAG=anterior dc up -d --no-build`. Migrations já aplicadas não são
  desfeitas: para voltar o banco, use o restore (seção 5).

## 5. Backup e restauração

Backup diário às 02:30 (banco em `pg_dump` + espelho do bucket de documentos), com 30 dias de dumps:

```bash
sudo cp deploy/systemd/ordens-backup.* /etc/systemd/system/    # ajuste WorkingDirectory/BACKUP_DIR
sudo systemctl daemon-reload && sudo systemctl enable --now ordens-backup.timer
sudo systemctl start ordens-backup.service && journalctl -u ordens-backup.service -n 20   # teste manual
```

- **RAID não é backup.** Copie `/srv/backups/ordens` para OUTRO equipamento/local todo dia
  (NAS, `rclone`/`restic` para armazenamento externo criptografado). Monitore a data em
  `/srv/backups/ordens/last-success`: alerte se passar de 26 h.
- **Teste de restauração** (mensal e antes de confiar no processo): `./scripts/deploy/restore-db.sh <dump>`
  restaura em um banco temporário, mostra as contagens e o remove.
- **Recuperação**: `./scripts/deploy/restore-db.sh <dump> --replace` (para a aplicação, substitui o
  banco, sobe de novo). Os documentos voltam com `mc mirror` do diretório `files/` para o bucket.

## 6. Operação

| Tarefa | Comando |
|---|---|
| Situação | `dc ps` · `docker stats --no-stream` |
| Logs | `dc logs -f --tail=100 api` (também `worker`, `web`, `cloudflared`, `clamav`) |
| Reiniciar um serviço | `dc restart api` |
| Uso de disco | `docker system df` · `df -h` |
| Console do banco | `dc exec postgres psql -U postgres -d ordens` |

- **Filas com erro**: eventos que esgotam as tentativas vão para a fila `dead-letter` (log do worker).
- **Pasta de rede**: falhas de cópia aparecem em *Parâmetros* (com o motivo) e a varredura tenta a cada 15 min.
- **Rotação de segredos**: `SESSION_SECRET` derruba todas as sessões (aceitável, faça em horário calmo);
  `TWO_FACTOR_ENC_KEY` **não pode ser trocada** sem antes reprocessar os segredos de 2FA e a senha da
  pasta de rede (peça o procedimento antes de mexer). Senhas do banco/MinIO: trocar no `.env.production`
  **e** no serviço (`ALTER ROLE` / `mc admin`).
- **Segredo do aplicativo de e-mail (Graph)**: vence em até 24 meses. Crie um novo segredo no Entra **antes** do
  vencimento, atualize `GRAPH_CLIENT_SECRET`, rode `dc up -d worker` e confirme com `send-test-mail.js`; só então
  apague o antigo. Ponha o vencimento na agenda da TI.
- **Atualizações do sistema operacional**: `unattended-upgrades` cuida das de segurança; reinicie o
  servidor em janela combinada quando o kernel mudar (os contêineres sobem sozinhos: `restart: unless-stopped`).

## 7. Segurança: o que está coberto e o que falta

| Item da revisão de segurança | Situação |
|---|---|
| TLS/HSTS | Cloudflare no edge; HSTS enviado pela aplicação (`x-forwarded-proto`). |
| IP real / `trust proxy` | `TRUST_PROXY=1` + `TRUSTED_IP_HEADER=cf-connecting-ip` (só seguro porque nada é publicado no host). |
| Redis/PostgreSQL/MinIO fora da rede | Sem portas no host; MinIO sem console; só o `cloudflared` sai. |
| ClamAV | Obrigatório (a API/worker recusam subir com `SCANNER=noop`). |
| 2FA obrigatória | Empresa criada pelo bootstrap já exige 2FA dos papéis críticos. |
| Segredos | `.env.production` 0600 + cópia em cofre. Sem KMS (bare metal): restrinja o acesso ao servidor. |
| Monitoramento e alertas | **Pendente**: alertas de falhas de login/bloqueios e downloads em massa; exportar a auditoria para local imutável. |
| CSP com nonce | **Pendente** (hoje `'unsafe-inline'` em scripts por causa do App Router). |
| Testes dinâmicos (DAST) | **Pendente**, em ambiente autorizado. |
| Cloudflare comprometida | Risco residual: 2FA na conta, poucos administradores, log de auditoria da Cloudflare ligado. |
