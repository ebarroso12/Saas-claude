# kiro-evolution

Backend de um assistente executivo pessoal em português do Brasil, com
**Claude** (Anthropic API) como motor e **WhatsApp** como canal, via
[Evolution API](https://github.com/EvolutionAPI/evolution-api).

A Evolution é **somente a ponte de mensagens**. Toda a inteligência,
memória, política de autorização, confirmação humana e auditoria vivem
aqui.

## O ponto do projeto

Este serviço substitui um agente que rodava com acesso a shell e às
próprias credenciais em texto plano. A diferença não é o modelo — é que
**o modelo perde o shell**:

| Antes | Aqui |
|---|---|
| Modelo monta comando bash | Modelo emite intenção; o broker executa |
| `source .env` no prompt do agente | Segredo nunca entra no contexto |
| Política escrita em markdown | Política verificada em código, antes do modelo |
| "Feito!" por suposição | `ok` só com retorno verificado da API |

## Arquitetura

```
WhatsApp
  └─ Evolution API ──webhook autenticado──▶ este serviço
                                              │
       ┌──────────────────────────────────────┤
       │  1. autentica o webhook (tempo constante)
       │  2. normaliza o evento
       │  3. idempotência  ← UNIQUE + ON CONFLICT, não SELECT-depois-INSERT
       │  4. allowlist de remetente por hash de telefone
       │  5. resolve o agente (registry + modo sticky)
       │  6. resolve confirmação pendente  ← determinístico, fora do modelo
       │  7. monta contexto no escopo de memória permitido
       │  8. chama o Claude com a allowlist de ferramentas daquele turno
       │  9. intercepta ferramenta sensível → grava pendência, NÃO executa
       │ 10. auditoria
       └──────────────────────────────────────┤
  ◀─ Evolution API ◀───────────────────────────┘
```

## Invariantes

Estão em [`CLAUDE.md`](./CLAUDE.md) e valem independentemente do modelo
escolhido. As duas que mais moldam o código:

**Confirmação humana atravessa turnos.** O loop de ferramentas do Claude
vive dentro de um ciclo de request — segundos. A confirmação do humano
chega como mensagem nova de WhatsApp, minutos ou horas depois. Nenhum
hook pode bloquear esperando. Então o intercept **recusa e grava
pendência**; o turno seguinte resolve. Ver
[`src/confirmations/machine.ts`](./src/confirmations/machine.ts).

**Política é código, nunca prompt.** Allowlist, escopo de memória,
classificação read/write e o que conta como "sim" são decididos antes
de o modelo ser chamado. Prompt é persuasão; código é garantia.

## Modelos

Os modelos Claude não têm a mesma superfície de API. O registry em
[`src/adapters/anthropic.ts`](./src/adapters/anthropic.ts) declara a
capacidade de cada um em vez de fingir que são intercambiáveis —
`thinking` adaptativo vs. `budget_tokens`, presença de `effort`,
mensagem de sistema no meio da conversa. Trocar de modelo é mudar
`ANTHROPIC_MODEL` no ambiente.

Dois avisos que custam dinheiro:

- **Cache é escopado por modelo.** Cada modelo pinado é um namespace
  separado do seu prefixo. Fragmentar em muitos modelos sai mais caro
  que usar um bom.
- **Cache casa por prefixo.** Nada volátil (timestamp, id de request)
  antes do último breakpoint, ou o cache morre silenciosamente e a
  conta multiplica. Confira `usage.cache_read_input_tokens`.

## Começando

**Os comandos, na ordem, estão no [RUNBOOK.md](./RUNBOOK.md)** — trilha local
(prova que funciona sem tocar no WhatsApp) e trilha VPS, mais o cutover e o
rollback.

Resumo:

```bash
npm install
export POSTGRES_PASSWORD='...'
docker compose up -d kiro-db
cp .env.example .env     # preencha; nada de segredo no repositório
npm run migrate
npm run dev
```

Verificação:

```bash
npm run typecheck
npm test
bash scripts/smoke.sh    # prova o ciclo inteiro, sem WhatsApp
```

## Variáveis de ambiente

Ver [`.env.example`](./.env.example). Nenhum telefone, domínio, UUID de
instância ou nome de pessoa está versionado — tudo vem do ambiente, e o
banco guarda telefone só como hash (`PHONE_HASH_PEPPER`).

Conectores nascem **desligados**. Cada um só é carregado com
`*_ENABLED=true` e credencial presente, e só deve ser ligado após teste
de leitura, teste de escrita controlado e verificação de log — senão o
estado correto a reportar é "não verificado".

## Estado

Primeira entrega: ciclo de mensagem ponta a ponta — webhook autenticado,
idempotência, allowlist, persona, resposta e auditoria. **Sem ferramenta
de escrita**, de propósito: prova o ciclo antes de dar poder de ação.

O registry de agentes e o contrato de ferramentas já existem e são
extensíveis por configuração, não por refatoração.

## Licença

Privado. Uso pessoal.
