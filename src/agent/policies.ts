import { config } from '../config.js'
import { hashPhone } from '../security/redaction.js'

/**
 * Invariante 2: política vive em código, nunca no prompt.
 * Este arquivo decide QUEM pode falar e O QUE ele alcança — antes de o
 * modelo ser chamado. Nome de contato do WhatsApp nunca autoriza nada
 * (é controlado pelo remetente, trivialmente falsificável).
 */

export type SenderRole = 'owner' | 'spouse' | 'clinic' | 'unknown'

export type MemoryScope = 'profile' | 'approved' | 'clinic' | 'legendarios'

export interface SenderPolicy {
  role: SenderRole
  /** Agentes que este remetente pode acionar. */
  allowedAgents: string[]
  /** Escopos de memória legíveis. O resto não é montado no contexto. */
  memoryScopes: MemoryScope[]
  /** Pode disparar ação que exige confirmação? */
  canConfirmSensitive: boolean
  /** Responder sempre, mesmo sem novidade (regra de DM). */
  alwaysReply: boolean
}

const POLICIES: Record<SenderRole, SenderPolicy> = {
  owner: {
    role: 'owner',
    allowedAgents: ['kiro'],
    memoryScopes: ['profile', 'approved'],
    canConfirmSensitive: true,
    alwaysReply: true,
  },
  spouse: {
    role: 'spouse',
    // Inventário: acesso idêntico ao titular. As exceções (alerta técnico,
    // financeiro detalhado, conteúdo clínico) são de DISPARO PROATIVO, não
    // de resposta a DM — tratadas no agendador, não aqui.
    allowedAgents: ['kiro'],
    memoryScopes: ['profile', 'approved'],
    canConfirmSensitive: true,
    alwaysReply: true,
  },
  clinic: {
    // Número da clínica: escopo restrito. Na v1 permanece no OpenClaw;
    // a política já existe para quando a instância assumir esse número.
    role: 'clinic',
    allowedAgents: ['injetaveis'],
    memoryScopes: ['clinic'],
    canConfirmSensitive: false,
    alwaysReply: true,
  },
  unknown: {
    role: 'unknown',
    allowedAgents: [],
    memoryScopes: [],
    canConfirmSensitive: false,
    alwaysReply: false,
  },
}

/** hash do telefone -> papel. Montado uma vez na partida. */
const ROLE_BY_HASH: ReadonlyMap<string, SenderRole> = (() => {
  const m = new Map<string, SenderRole>()
  m.set(hashPhone(config.SENDER_OWNER), 'owner')
  if (config.SENDER_OWNER_ALT) m.set(hashPhone(config.SENDER_OWNER_ALT), 'owner')
  if (config.SENDER_SPOUSE) m.set(hashPhone(config.SENDER_SPOUSE), 'spouse')
  if (config.SENDER_CLINIC) m.set(hashPhone(config.SENDER_CLINIC), 'clinic')
  return m
})()

export function roleForPhoneHash(phoneHash: string): SenderRole {
  return ROLE_BY_HASH.get(phoneHash) ?? 'unknown'
}

export function policyFor(role: SenderRole): SenderPolicy {
  return POLICIES[role]
}

/** Todos os hashes autorizados — útil para teste e para o /health. */
export function authorizedHashCount(): number {
  return ROLE_BY_HASH.size
}

/**
 * Um remetente desconhecido não recebe resposta e não entra no modelo.
 * Silêncio é a política: responder já confirma que o número existe e que
 * há um assistente atrás dele.
 */
export function shouldProcess(role: SenderRole): boolean {
  return role !== 'unknown'
}
