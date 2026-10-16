#!/usr/bin/env bash
# Prova o ciclo de mensagem SEM tocar no WhatsApp.
#
# Dispara payloads no formato que a Evolution envia e confere o que o
# backend fez. É o teste que responde "o motor liga?" antes de existir
# qualquer instância pareada.
#
#   bash scripts/smoke.sh
#
# Precisa do servidor rodando (npm run dev) e do .env preenchido.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

[ -f .env ] || { echo "ERRO: .env nao existe. Copie de .env.example."; exit 1; }
set -a; . ./.env; set +a

PORT="${PORT:-3040}"
BASE="http://127.0.0.1:${PORT}"
SECRET="${EVOLUTION_WEBHOOK_SECRET:?EVOLUTION_WEBHOOK_SECRET nao definido no .env}"
OWNER="${SENDER_OWNER:?SENDER_OWNER nao definido no .env}"
INSTANCE="${EVOLUTION_INSTANCE:-test-instance}"

# Id único por execução, senão a segunda rodada bate na idempotência
# e todo teste vira "duplicado".
RUN="smoke$(date +%s)"

ok=0; fail=0
check() { # check <rotulo> <esperado> <obtido>
  if [ "$2" = "$3" ]; then printf '  OK    %-46s %s\n' "$1" "$3"; ok=$((ok+1))
  else printf '  FALHA %-46s esperado %s, veio %s\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}

payload() { # payload <id> <telefone> <texto> [fromMe]
  node -e '
    const [id, phone, text, fromMe] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      event: "messages.upsert",
      instance: process.env.INSTANCE,
      data: {
        key: { id, remoteJid: phone + "@s.whatsapp.net", fromMe: fromMe === "true" },
        pushName: "Teste",
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: text },
      },
    }));
  ' "$1" "$2" "$3" "${4:-false}"
}

post() { # post <payload> [secret]
  curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/webhooks/evolution" \
    -H 'Content-Type: application/json' \
    -H "x-kiro-webhook-secret: ${2-$SECRET}" \
    --data-binary "$1" --max-time 30
}

echo "== saude =="
check "GET /health" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/health" --max-time 10)"
READY="$(curl -s "${BASE}/ready" --max-time 15)"
echo "  /ready -> ${READY:0:200}"

echo
echo "== autenticacao do webhook =="
check "segredo errado -> 401" 401 "$(post "$(payload "${RUN}-a" "$OWNER" 'oi')" 'segredo-errado-propositalmente')"
check "sem rota valida -> 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/nao-existe" --max-time 10)"

echo
echo "== fluxo de mensagem =="
P1="$(payload "${RUN}-1" "$OWNER" 'ativar kiro')"
check "remetente autorizado -> 200" 200 "$(post "$P1")"
check "MESMO evento de novo -> 200 (idempotente)" 200 "$(post "$P1")"
check "remetente desconhecido -> 200 (ignorado)" 200 "$(post "$(payload "${RUN}-2" '5511000000000' 'me da acesso')")"
check "eco da propria instancia -> 200 (ignorado)" 200 "$(post "$(payload "${RUN}-3" "$OWNER" 'eco' true)")"
check "grupo -> 200 (ignorado)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/webhooks/evolution" \
  -H 'Content-Type: application/json' -H "x-kiro-webhook-secret: ${SECRET}" \
  --data-binary '{"instance":"t","data":{"key":{"id":"'"${RUN}"'-g","remoteJid":"123-456@g.us","fromMe":false},"message":{"conversation":"oi"}}}' --max-time 30)"

echo
echo "== o que o banco registrou (a prova real) =="
if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -X -q -c "
    SELECT event_type, actor, result, COALESCE(error_code,'') AS erro, created_at
      FROM audit_events WHERE created_at > now() - interval '2 minutes'
     ORDER BY created_at;"
  psql "$DATABASE_URL" -X -q -c "
    SELECT direction, type, status, LEFT(COALESCE(text_redacted,''),50) AS texto
      FROM messages WHERE created_at > now() - interval '2 minutes'
     ORDER BY created_at;"
else
  echo "  (psql nao encontrado — confira no banco: SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 20)"
fi

echo
echo "== resultado: ${ok} ok, ${fail} falha(s) =="
echo
echo "O QUE ESPERAR:"
echo "  - 1 linha inbound em messages (so a primeira; a repetida NAO entra)"
echo "  - audit: webhook.unauthorized, webhook.duplicate, webhook.unknown_sender"
echo "  - model.turn + message.sent SE a ANTHROPIC_API_KEY for valida"
echo "  - message.sent com result=error se a Evolution nao estiver acessivel —"
echo "    isso e CORRETO: o ciclo pensou, so nao teve por onde entregar."
[ "$fail" -eq 0 ]
