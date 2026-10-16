# KIRO via Evolution API — regras do projeto

Assistente executivo pessoal (nome do titular vem do ambiente). Cérebro: Claude (Anthropic API).
Canal: WhatsApp via uma instância da Evolution API. Roda no mesmo VPS do gateway legado.

## O ponto do projeto

Isto NÃO é "trocar GPT por Claude". É **tirar o shell da mão do modelo**.
No OpenClaw o modelo faz `source .env` e monta comando bash. Aqui ele tem apenas
funções tipadas com escopo declarado, e segredo nenhum entra no contexto.

Se uma mudança sua faz o modelo chegar mais perto de um segredo ou de uma ação
não declarada, a mudança está errada — mesmo que funcione.

## Invariantes (não negociáveis, independem do modelo)

1. **Nunca declarar sucesso sem retorno verificado da ferramenta.** Financeiro só
   confirma após `{"ok":true,"data":{"id":...}}`. Sem isso, não houve gravação.
2. **Política vive em código, nunca no prompt.** Allowlist, escopo de memória,
   classificação read/write e gate de confirmação são checados antes do modelo
   e no intercept da ferramenta. Prompt é persuasão; código é garantia.
3. **Ação sensível exige confirmação humana que atravessa turnos.** Ver
   `src/confirmations/machine.ts`. O hook NÃO espera — ele recusa e grava pendência.
4. **Idempotência por `external_message_id`.** Evento repetido devolve 200 e não
   gera segunda resposta nem segunda ação.
5. **Segredo nunca no log, no prompt ou na resposta.** Telefone só como hash.
   Ver `src/security/redaction.ts`.
6. **Silêncio operacional:** automação sem novidade não manda mensagem.
   **Mas DM de autorizado SEMPRE é respondida.** As duas regras convivem.
7. **Fronteiras de agente são allowlist, não sugestão.** Kiro não é Serena, nem
   Injetáveis, nem dashboard, nem Legendários. O registry declara o que cada um
   alcança; o código impede o resto.

## Estilo das respostas do agente

pt-BR. Curto, direto, assertivo, profissional, discreto. Sem markdown pesado no
WhatsApp (sem tabela, sem header — use **negrito** ou CAPS). Nunca se apresentar
como IA, chatbot, modelo ou OpenClaw.

Frase de ativação: `ativar <AGENT_NAME>` → resposta exata `Em que posso ajudar, <OWNER_TITLE>?`
Os dois valores vêm do ambiente. Ver `src/agent/personas/kiro.ts`.

## Antes de mexer

- `npm run typecheck && npm test` tem que passar.
- Mudou prompt ou persona? Rode o eval de persona (`tests/persona.eval.ts`).
  Prompt sem eval é mudança sem prova.
- Não commite `.env`, chave, QR code, dump de sessão ou o inventário do OpenClaw.
- Não reative conector desligado sem teste de leitura, teste de escrita controlado
  e verificação de log. Sem isso, reporte como "não verificado".

## Remetentes

Número NENHUM aparece neste repositório. Todos vêm do ambiente, e o banco
guarda só o hash (`PHONE_HASH_PEPPER`). Ver `src/agent/policies.ts`.

| Variável | Papel | Escopo |
|---|---|---|
| `SENDER_OWNER` | principal | total |
| `SENDER_OWNER_ALT` | segundo número do mesmo titular | total |
| `SENDER_SPOUSE` | cônjuge | total, com exceções no disparo proativo |
| `SENDER_CLINIC` | clínica / menu-router | restrito — permanece no OpenClaw na v1 |

Qualquer outro remetente: silêncio total. Responder já confirmaria que o
número existe e que há um assistente atrás dele.

O nome da instância Evolution e o nome do agente são strings DIFERENTES
(`EVOLUTION_INSTANCE` vs. o id no registry). Confundir dá 404 silencioso.

## Armadilhas já conhecidas

- A rota da Evolution usa o NOME da instância: `/message/sendText/{EVOLUTION_INSTANCE}`. O UUID do
  Manager não serve. Errar dá 404 silencioso.
- Prompt caching é por modelo e casa por PREFIXO. Nada volátil (timestamp, id) antes
  do último breakpoint, ou o cache morre e a conta triplica.
- Claude não recebe áudio. Mensagem de voz passa por transcrição antes.
- A cascata financeira 12/15/10 NÃO entra no prompt. O dashboard é a única fonte que
  grava o valor final. Kiro não cita número que ele mesmo calculou.
