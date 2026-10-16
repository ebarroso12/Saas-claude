import { assertToolInvariants, type ToolDef } from './types.js'

/**
 * Catálogo de ferramentas.
 *
 * v1: VAZIO, de propósito. O handoff é explícito — "não implemente ainda
 * escrita em agenda, e-mail, finanças ou clínica. Primeiro prove o ciclo
 * de mensagem."
 *
 * O que já está pronto é a ESTRUTURA: o contrato em types.ts obriga cada
 * ferramenta a declarar seu risco, e `assertToolInvariants` quebra a
 * partida se alguém registrar uma ferramenta sensível sem resumo de
 * confirmação. Adicionar as próximas é preencher esta lista — e habilitar
 * o conector no .env.
 *
 * Ordem prevista, uma por checkpoint:
 *   1. calendar_search        read_only      google
 *   2. gmail_search           read_only      google
 *   3. drive_search           read_only      google
 *   4. tasks_list             read_only      google
 *   5. injetaveis_query       read_only      injetaveis
 *   6. finance_extract        read_only      core        (lê boleto, não grava)
 *   7. gmail_create_draft     reversible     google
 *   8. tasks_create           reversible     google
 *   9. calendar_create        requires_confirmation  google
 *  10. calendar_update        requires_confirmation  google
 *  11. gmail_send             requires_confirmation  google
 *  12. finance_register       requires_confirmation  dashboard
 *  13. kiro_ingest            requires_confirmation  dashboard
 *  14. send_whatsapp_to_third requires_confirmation  core
 *
 * IMPORTANTE: a ordem não é arbitrária. Tudo que é somente leitura entra
 * antes de qualquer escrita, e cada escrita só entra depois que a leitura
 * do mesmo conector foi verificada em produção.
 */
export const TOOLS: ToolDef[] = []

assertToolInvariants(TOOLS)

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

/** Resolve a allowlist de um agente em definições reais. */
export function getToolsFor(names: string[]): ToolDef[] {
  const out: ToolDef[] = []
  for (const n of names) {
    const t = BY_NAME.get(n)
    // Nome desconhecido na allowlist é erro de configuração, não silêncio.
    if (!t) throw new Error(`[tools] agente referencia ferramenta inexistente: ${n}`)
    out.push(t)
  }
  return out
}

export function getTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name)
}
