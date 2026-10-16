#!/usr/bin/env bash
# PostToolUse(Write|Edit) — roda tsc quando um .ts muda.
#
# Não bloqueia: devolve o erro ao modelo como contexto, para ele corrigir
# na hora em vez de descobrir no fim. Erro de tipo neste projeto não é
# cosmético — foi assim que apareceu o budget_tokens >= max_tokens, que
# só quebraria em produção na troca de modelo.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 0
cd "$ROOT" || exit 0

FILE="$(node -e "
let s='';
process.stdin.on('data', d => s += d).on('end', () => {
  try {
    const j = JSON.parse(s);
    process.stdout.write(String(j.tool_response?.filePath ?? j.tool_input?.file_path ?? ''))
  } catch { process.stdout.write('') }
})
" 2>/dev/null)" || exit 0

case "$FILE" in
  *.ts) ;;
  *) exit 0 ;;
esac

# Sem dependências instaladas ainda, não há o que checar.
[ -d node_modules/typescript ] || exit 0

if OUT="$(npx --no-install tsc --noEmit 2>&1)"; then
  exit 0
fi

node -e '
const lines = String(process.argv[1]).split(/\r?\n/).filter(Boolean);
const shown = lines.slice(0, 25);
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext:
      "tsc --noEmit falhou (" + lines.length + " linha(s)):\n" + shown.join("\n"),
  },
  systemMessage: "typecheck falhou — " + lines.length + " linha(s)",
}));
' "$OUT"
exit 0
