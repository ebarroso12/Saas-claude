#!/usr/bin/env bash
# PreToolUse(Bash) — barra `git add/commit/push` se houver dado sensível
# em arquivo rastreado.
#
# Por que isto existe: numa sessão anterior, 13 vazamentos (telefones,
# domínios, IP do VPS, UUID da instância) quase foram para um repositório
# PÚBLICO. Git guarda histórico — apagar depois não desfaz. Esta trava
# transforma aquela lição em código.
#
# Os padrões específicos do projeto ficam em .claude/forbidden-patterns.txt,
# que é GITIGNORADO — se os valores reais morassem neste script, o próprio
# script seria o vazamento.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 0
cd "$ROOT" || exit 0

CMD="$(node -e "
let s='';
process.stdin.on('data', d => s += d).on('end', () => {
  try { process.stdout.write(String(JSON.parse(s).tool_input?.command ?? '')) }
  catch { process.stdout.write('') }
})
" 2>/dev/null)" || exit 0

# Só comandos que registram ou publicam conteúdo.
case "$CMD" in
  *"git add"*|*"git commit"*|*"git push"*) ;;
  *) exit 0 ;;
esac

# Padrões universais — seguros para versionar porque não contêm segredo real.
PATTERNS='sk-ant-api[0-9]{2}-|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xoxb-[0-9]{10,}'

# Padrões do projeto (telefones, domínios, IPs reais). Arquivo gitignorado.
EXTRA_FILE="$ROOT/.claude/forbidden-patterns.txt"
if [ -f "$EXTRA_FILE" ]; then
  EXTRA="$(grep -vE '^\s*(#|$)' "$EXTRA_FILE" | paste -sd '|' -)"
  [ -n "$EXTRA" ] && PATTERNS="$PATTERNS|$EXTRA"
fi

HITS="$(git ls-files -z 2>/dev/null \
  | xargs -0 grep -nEI "$PATTERNS" 2>/dev/null \
  | head -20 || true)"

[ -z "$HITS" ] && exit 0

node -e '
const hits = process.argv[1];
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason:
      "Dado sensível em arquivo rastreado. Git guarda histórico — sanitize ANTES de registrar:\n" + hits,
  },
  systemMessage: "git barrado: dado sensível em arquivo rastreado",
}));
' "$HITS"
exit 0
