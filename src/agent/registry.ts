import type { MemoryScope, SenderRole } from './policies.js'
import { KIRO_PERSONA } from './personas/kiro.js'

/**
 * REGISTRY DE AGENTES — o ecossistema.
 *
 * No OpenClaw um "agente" é uma pasta com markdown. Aqui é esta struct:
 * persona + allowlist de ferramenta + escopo de memória + política de
 * remetente. Adicionar `financeiro`, `crm` ou `bug-hunter` depois é
 * acrescentar uma entrada — não é refatoração.
 *
 * A diferença que importa: no OpenClaw a fronteira entre agentes é uma
 * REGRA ESCRITA que o modelo pode desobedecer. Aqui ela é allowlist
 * verificada em código. O modelo não fura nem se quiser.
 *
 * v1: só `kiro` está registrado. Os outros entram um por checkpoint.
 */

export interface AgentDef {
  id: string
  /** Nome que o agente usa ao se apresentar. */
  displayName: string
  persona: string
  /** Ferramentas que este agente alcança. Vazio = só conversa. */
  tools: string[]
  memoryScopes: MemoryScope[]
  /** Quem pode acionar este agente. */
  allowedRoles: SenderRole[]
  model: string | null
  /**
   * Modo gruda? MODO INJETÁVEIS persiste até o usuário pedir
   * "menu"/"kiro" explicitamente. O Kiro base não gruda — ele é o default.
   */
  sticky: boolean
  /** Para quem este agente pode encaminhar. */
  handoff: string[]
}

export const AGENTS: Record<string, AgentDef> = {
  kiro: {
    id: 'kiro',
    displayName: 'Kiro',
    persona: KIRO_PERSONA,
    // v1: nenhuma ferramenta. Primeiro prova o ciclo da mensagem,
    // como o handoff manda. Ferramentas entram por checkpoint.
    tools: [],
    memoryScopes: ['profile', 'approved'],
    allowedRoles: ['owner', 'spouse'],
    model: null, // usa ANTHROPIC_MODEL
    sticky: false,
    handoff: [],
  },

  // ── Próximos, já com a fronteira desenhada ──────────────────
  // Descomentar um por vez, cada um com seu checkpoint e seu teste.
  //
  // injetaveis: {
  //   id: 'injetaveis',
  //   displayName: 'Injetáveis',
  //   persona: INJETAVEIS_PERSONA,
  //   tools: ['injetaveis_query'],        // somente leitura
  //   memoryScopes: ['clinic'],           // NUNCA 'approved' — não vê o pessoal
  //   allowedRoles: ['owner', 'spouse', 'clinic'],
  //   model: null,
  //   sticky: true,                       // gruda até "menu"/"kiro"
  //   handoff: ['kiro'],
  // },
  //
  // legendarios: permanece no OpenClaw. Entra como conector de
  // delegação (connector 'openclaw'), não como agente reescrito.
  //
  // instagram: NÃO MIGRAR. O inventário é explícito: "perfeito como está".
}

export const DEFAULT_AGENT = 'kiro'

export function getAgent(id: string): AgentDef {
  const a = AGENTS[id]
  if (!a) throw new Error(`[registry] agente desconhecido: ${id}`)
  return a
}

export function agentExists(id: string): boolean {
  return id in AGENTS
}

/** Invariante 7: o remetente alcança este agente? Checado em código. */
export function canRoleUseAgent(role: SenderRole, agentId: string): boolean {
  const a = AGENTS[agentId]
  if (!a) return false
  return a.allowedRoles.includes(role)
}

/**
 * Palavras que quebram um modo sticky e devolvem ao Kiro.
 * Fonte: AGENTS.md — "até o usuário pedir 'menu', 'kiro', 'dashboard'".
 */
const EXIT_STICKY = /^\s*(menu|kiro|dashboard|sair|voltar|menu geral)\s*$/i

export function wantsExitSticky(text: string): boolean {
  return EXIT_STICKY.test(text)
}

/**
 * Decide qual agente atende este turno.
 * Precedência: saída explícita de modo > modo grudado > default.
 */
export function resolveAgent(params: {
  role: SenderRole
  text: string
  activeAgent: string
  stickyUntil: Date | null
  now: Date
}): { agentId: string; clearSticky: boolean } {
  const { role, text, activeAgent, stickyUntil, now } = params

  if (wantsExitSticky(text)) return { agentId: DEFAULT_AGENT, clearSticky: true }

  const stickyVivo = stickyUntil !== null && stickyUntil.getTime() > now.getTime()
  if (stickyVivo && agentExists(activeAgent) && canRoleUseAgent(role, activeAgent)) {
    return { agentId: activeAgent, clearSticky: false }
  }

  return { agentId: DEFAULT_AGENT, clearSticky: stickyUntil !== null }
}
