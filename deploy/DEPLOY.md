# NexusFlow — Guia de Deploy (VPS Contex)

Data: 2026-06-10

Arquitetura: **VPS Ubuntu** (Node 20 + PostgreSQL + PM2) + **Cloudflare Tunnel/Zero Trust** (acesso) + **Syncthing** (dossiês → servidor interno da Contex). Nenhuma porta web exposta.

---

## 1. Pré-requisitos (provisionados pelo provedor)

- VPS Ubuntu 22.04/24.04 — 2 vCPU / 4 GB / 60 GB, acesso SSH
- Node.js 20 LTS, PostgreSQL 15+, PM2, cloudflared, Syncthing instalados
- Domínio com DNS no Cloudflare

## 2. Banco de dados

```bash
sudo -u postgres psql
CREATE DATABASE nexusflow;
CREATE USER nexusflow WITH PASSWORD '<senha-forte>';
GRANT ALL PRIVILEGES ON DATABASE nexusflow TO nexusflow;
\c nexusflow
GRANT ALL ON SCHEMA public TO nexusflow;
\q
```

O app cria as tabelas sozinho na primeira subida (ou rode `postgres/schema.sql`).
Na primeira subida com a tabela `users` vazia, os usuários padrão são criados
(admin/admin123 etc.) — **trocar todas as senhas imediatamente** em `/admin/usuarios`.

## 3. Aplicação

```bash
sudo mkdir -p /var/nexusflow/uploads /var/nexusflow/dossies /opt/nexusflow
sudo chown -R $USER /var/nexusflow /opt/nexusflow
cd /opt/nexusflow
# copiar o projeto (git clone ou rsync da máquina local, sem node_modules/.next)
npm ci
cp .env.example .env && nano .env
```

`.env` mínimo de produção:

```
DATABASE_URL=postgresql://nexusflow:SENHA@localhost:5432/nexusflow
JWT_SECRET=<openssl rand -base64 32>
UPLOADS_DIR=/var/nexusflow/uploads
DOSSIES_DIR=/var/nexusflow/dossies
NEXUSFLOW_NO_SEED=1
# N8N_WEBHOOK_URL=https://n8n.mvhometech.com.br/webhook/nexusflow-os
```

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save && pm2 startup   # seguir instrução exibida
curl -I http://localhost:3000/login   # deve responder 200
```

## 4. Cloudflare Tunnel + Zero Trust

1. Painel Cloudflare → **Zero Trust → Networks → Tunnels → Create tunnel** (nome: `nexusflow`).
2. Instalar o conector na VPS com o comando exibido (`cloudflared service install <token>`).
3. Public hostname: `app.<dominio>` → `http://localhost:3000`.
4. **Access → Applications → Add application (Self-hosted)**:
   - Application domain: `app.<dominio>`
   - Identity provider: **One-time PIN**
   - Policy `Equipe Contex` (Allow): Include → Emails → e-mails da equipe interna
   - Policy `Captadores` (Allow): Include → Emails → e-mails dos captadores
5. Sessão do Access: 24h (ajustável).

**Desligar um colaborador:** remover o e-mail da policy (acesso bloqueado na hora) **e** desativar o usuário em `/admin/usuarios`.

## 5. Syncthing (dossiês → servidor interno Contex)

Na VPS:

```bash
sudo systemctl enable --now syncthing@$USER
# GUI local apenas: acessar via túnel SSH -> ssh -L 8384:localhost:8384 user@vps
```

1. Na GUI da VPS (via túnel SSH): Add Folder → `/var/nexusflow/dossies`, ID `nexusflow-dossies`, tipo **Send Only**.
2. Na máquina interna da Contex: instalar Syncthing, adicionar o device da VPS (Device ID), aceitar a pasta `nexusflow-dossies` apontando para a pasta de rede de destino (ex.: `D:\Clientes\Aberturas\`), tipo **Receive Only**.
3. Testar: finalizar uma OS de teste → a pasta `{EMPRESA} - {PROTOCOLO}` aparece no servidor interno em segundos.

## 6. Backup (cron na VPS)

```bash
crontab -e
# 03:00 diário — banco + arquivos, retenção 14 dias
0 3 * * * pg_dump "postgresql://nexusflow:SENHA@localhost:5432/nexusflow" | gzip > /var/backups/nexusflow/db-$(date +\%F).sql.gz
10 3 * * * tar czf /var/backups/nexusflow/files-$(date +\%F).tar.gz /var/nexusflow/uploads /var/nexusflow/dossies
30 3 * * * find /var/backups/nexusflow -mtime +14 -delete
```

(criar antes: `sudo mkdir -p /var/backups/nexusflow && sudo chown $USER /var/backups/nexusflow`)

## 7. Atualizações de versão

```bash
cd /opt/nexusflow
# atualizar código (git pull / rsync)
npm ci && npm run build
pm2 restart nexusflow
```

## 8. Checklist de validação pós-deploy

- [ ] `https://app.<dominio>` sem e-mail autorizado → bloqueado pelo Cloudflare
- [ ] E-mail de captador → OTP → abre o sistema → login captador → `captador.html`
- [ ] Remover e-mail da policy → novo acesso bloqueado
- [ ] Captação de teste com fotos → OS aparece no kanban
- [ ] Finalizar OS de teste → pasta `{EMPRESA} - {PROTOCOLO}` chega no servidor interno
- [ ] Botão "Baixar dossiê ZIP" funciona (DOCX + anexos + resumo.txt)
- [ ] Senhas padrão trocadas em `/admin/usuarios`
- [ ] Backup do dia seguinte existe em `/var/backups/nexusflow`
