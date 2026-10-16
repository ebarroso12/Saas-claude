# RUNBOOK — ligar o motor

Comandos, na ordem. Duas trilhas: **local** (prova que funciona, sem tocar
no WhatsApp) e **VPS** (produção). Faça a local primeiro — ela não arrisca
nada e é o que prova que o ciclo roda.

---

## Trilha A — local, sem WhatsApp

Precisa de: Node 20+, Docker, Git.

### 1. Código

```bash
git clone https://github.com/ebarroso12/Saas-claude.git kiro
cd kiro
npm install
```

### 2. Banco

```bash
export POSTGRES_PASSWORD='escolha-uma-senha-forte'
docker compose up -d kiro-db
docker compose ps          # espere ficar "healthy"
```

### 3. Configuração

```bash
cp .env.example .env
```

Abra o `.env` e preencha. O mínimo para a trilha local:

```bash
DATABASE_URL=postgres://kiro:<a senha acima>@127.0.0.1:5432/kiro
ANTHROPIC_API_KEY=<sua chave>
PHONE_HASH_PEPPER=<string aleatória longa>
EVOLUTION_WEBHOOK_SECRET=<string aleatória longa>
OWNER_TITLE=Dr. Edson
OWNER_FULL_NAME=Edson Barroso
SENDER_OWNER=<seu número, E.164 sem +>
KIRO_WHATSAPP_JID=<número da instância>@s.whatsapp.net
```

Para gerar os dois segredos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`EVOLUTION_BASE_URL`, `EVOLUTION_INSTANCE` e `EVOLUTION_API_KEY` podem ficar
com valor de exemplo nesta trilha — o envio vai falhar, e **isso é esperado**:
o ciclo pensa, só não tem por onde entregar.

> O `.env` é gitignorado. Nunca commite, nunca cole em chat.

### 4. Migrations

```bash
npm run migrate
```

Espere `[migrate] aplicada 001_init.sql` e `ok — 1 nova(s)`.

### 5. Subir

```bash
npm run dev
```

Procure a linha `kiro-evolution no ar`. Deixe esse terminal aberto.

### 6. Provar que funciona

Em **outro** terminal:

```bash
bash scripts/smoke.sh
```

Ele dispara os payloads no formato da Evolution e confere o resultado:
saúde, segredo errado barrado, mensagem aceita, evento repetido ignorado,
remetente desconhecido em silêncio, eco próprio descartado — e no fim mostra
o que o banco registrou.

**Isso é o motor ligado.** Tudo depois é integração.

---

## Trilha B — VPS, produção

Só depois da trilha A passar.

### 1. Subir o código

```bash
ssh root@<ip-do-vps>
cd /opt && git clone https://github.com/ebarroso12/Saas-claude.git kiro-evolution
cd kiro-evolution
```

### 2. Segredos

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Aqui vão os valores **reais**: `EVOLUTION_BASE_URL`, `EVOLUTION_INSTANCE`
(o nome, não o UUID), `EVOLUTION_API_KEY`, os quatro `SENDER_*`, a chave
Anthropic nova.

> Se usa o secret manager do EasyPanel, o `.env` vira variável de ambiente
> do serviço. Mesma coisa para o código, melhor para você.

### 3. Subir

```bash
export POSTGRES_PASSWORD='senha-forte'
docker compose up -d --build
docker compose logs -f kiro-api
```

### 4. Migrations

```bash
docker compose exec kiro-api node --import tsx scripts/migrate.ts
```

### 5. Conferir

```bash
curl -s http://127.0.0.1:3040/health
curl -s http://127.0.0.1:3040/ready
```

O `/ready` checa banco **e** o estado da conexão da Evolution. Se vier
`evolution: {ok: false, detail: "close"}`, a instância não está pareada.

### 6. Apontar o webhook da Evolution

No Manager, na instância:

- **URL:** `https://<seu-dominio>/webhooks/evolution`
- **Eventos:** só `MESSAGES_UPSERT`. Não marque tudo — cada evento extra é
  uma chamada à toa.
- **Header:** `x-kiro-webhook-secret` com o mesmo valor do `.env`

### 7. Cutover (o único passo irreversível)

Nesta ordem:

1. Desabilite o canal WhatsApp no `openclaw.json` — **parar o serviço não
   basta**, ele reinicia e repareia sozinho
2. `systemctl restart openclaw.service`
3. Confirme no celular (WhatsApp → Aparelhos conectados) que sobrou um só
4. Pareie a instância da Evolution
5. Mande "ativar kiro" do seu número
6. Espere exatamente: `Em que posso ajudar, Dr. Edson?`

**Rollback:** despareia a Evolution, reabilita o canal no `openclaw.json`,
reinicia. O OpenClaw volta como estava — ele nunca foi alterado.

---

## Comandos do dia a dia

| O quê | Comando |
|---|---|
| Subir local | `npm run dev` |
| Testar o ciclo | `bash scripts/smoke.sh` |
| Testes | `npm test` |
| Tipos | `npm run typecheck` |
| Migrations | `npm run migrate` |
| Hash de um telefone | `npm run hash-phone -- 5511999990001` |
| Logs (VPS) | `docker compose logs -f kiro-api` |
| Reiniciar (VPS) | `docker compose restart kiro-api` |
| Parar tudo (VPS) | `docker compose down` |

### Ver o que o agente fez

```sql
SELECT created_at, event_type, actor, result, COALESCE(error_code,'')
  FROM audit_events ORDER BY created_at DESC LIMIT 30;
```

Essa tabela é a fonte da verdade. O que não está nela, não aconteceu —
independente do que o modelo tenha dito na conversa.

### Custo por turno

```sql
SELECT created_at, detail->>'model' AS modelo,
       detail->>'input_tokens' AS entrada,
       detail->>'cache_read'   AS cache,
       detail->>'est_cost_usd' AS usd
  FROM audit_events WHERE event_type = 'model.turn'
 ORDER BY created_at DESC LIMIT 20;
```

Se `cache` vier 0 sempre, o prompt caching não está pegando e a conta vai
subir várias vezes. Investigue antes de ligar os crons.

---

## Quando der errado

| Sintoma | Causa provável |
|---|---|
| Processo morre na partida com lista de campos | `.env` incompleto. O config valida tudo e sai — de propósito. |
| `/ready` com `database: {ok:false}` | Banco no ar? `DATABASE_URL` com a senha certa? |
| `/ready` com `evolution: {detail:"close"}` | Instância não pareada. |
| Webhook devolve 401 | Segredo do header diferente do `.env`. |
| Mensagem entra e nada acontece | Remetente fora da allowlist — silêncio é a política. Confira com `npm run hash-phone`. |
| Responde duas vezes | Dois sistemas no mesmo número. Veja Aparelhos conectados. |
| `404` ao enviar | Rota usa o **nome** da instância, não o UUID. |
