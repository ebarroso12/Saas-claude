/**
 * Máquina de confirmação humana.
 *
 * POR QUE ISTO NÃO É UM HOOK QUE ESPERA
 * O loop de ferramentas do Claude vive dentro de um ciclo de request —
 * segundos. A confirmação do titular chega como MENSAGEM NOVA de WhatsApp,
 * minutos ou horas depois. Nenhum hook pode bloquear esperando isso.
 *
 * Então o fluxo atravessa turnos:
 *
 *   Turno 1  modelo chama finance_register(...)
 *            -> intercept vê risk=requires_confirmation
 *            -> NÃO executa. Grava pendência. Devolve ao modelo
 *               { status: "awaiting_confirmation", summary }
 *            -> modelo apresenta o resumo e encerra
 *
 *   [ nada roda. a linha fica no banco com expires_at. ]
 *
 *   Turno 2  chega "pode lançar"
 *            -> ANTES do modelo, resolve() decide se isso confirma
 *            -> se sim, executa a ferramenta DE VERDADE e verifica o retorno
 *            -> só então o modelo é chamado, já com o resultado real
 */

import { config } from '../config.js'

export type ConfirmationStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'superseded'

export interface PendingConfirmation {
  id: string
  conversationId: string
  agentId: string
  toolName: string
  action: string
  summary: string
  payload: unknown
  anchorMessageId: string
  status: ConfirmationStatus
  expiresAt: Date
  createdAt: Date
}

export type ResolveOutcome =
  | { kind: 'confirmed'; confirmation: PendingConfirmation }
  | { kind: 'rejected'; confirmation: PendingConfirmation }
  | { kind: 'expired'; confirmation: PendingConfirmation }
  /** Mensagem não tem relação com a pendência — ela continua aberta. */
  | { kind: 'unrelated' }
  | { kind: 'none' }

/**
 * O que conta como "sim" é LISTA FECHADA, verificada em código.
 * O doc é explícito: "O sistema não deve interpretar qualquer mensagem
 * vaga como autorização." Por isso não é o modelo que decide isto.
 */
const AFFIRMATIVE = new Set([
  'sim',
  'ss',
  'isso',
  'confirmo',
  'confirmado',
  'confirmar',
  'pode',
  'pode sim',
  'pode lancar',
  'pode lançar',
  'pode mandar',
  'pode enviar',
  'pode criar',
  'pode agendar',
  'ok',
  'okay',
  'beleza',
  'blz',
  'certo',
  'correto',
  'exato',
  'manda',
  'manda ver',
  'envia',
  'faz',
  'faça',
  'faz isso',
  'vai',
  'autorizo',
  'aprovado',
  'aprovo',
  'positivo',
  'uhum',
  'aham',
  '1',
  '👍',
  '✅',
])

const NEGATIVE = new Set([
  'nao',
  'não',
  'n',
  'nop',
  'negativo',
  'cancela',
  'cancelar',
  'cancelado',
  'deixa',
  'deixa pra la',
  'deixa pra lá',
  'esquece',
  'para',
  'pare',
  'nao precisa',
  'não precisa',
  'nao quero',
  'não quero',
  'errado',
  'incorreto',
  'recuso',
  '0',
  '2',
  '👎',
  '❌',
])

/** Normaliza para comparar: minúsculas, sem acento, sem pontuação de borda. */
export function normalizeReply(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!,;:…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type ReplyIntent = 'affirmative' | 'negative' | 'other'

/**
 * Classifica a resposta. Só texto curto é considerado — se o titular
 * escreveu um parágrafo, ele está falando de outra coisa, não confirmando.
 * "sim, mas muda o valor para 400" NÃO é confirmação: é nova instrução.
 */
export function classifyReply(text: string): ReplyIntent {
  const t = normalizeReply(text)
  if (!t) return 'other'
  if (t.length > 24) return 'other'
  if (AFFIRMATIVE.has(t)) return 'affirmative'
  if (NEGATIVE.has(t)) return 'negative'
  return 'other'
}

export function isExpired(c: PendingConfirmation, now: Date): boolean {
  return c.expiresAt.getTime() <= now.getTime()
}

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + config.CONFIRMATION_TTL_SECONDS * 1000)
}

/**
 * Decide o destino de uma pendência diante da próxima mensagem do humano.
 *
 * Regra do "sim órfão": a confirmação só vale se for a resposta IMEDIATA
 * ao pedido. Se o titular perguntou outra coisa no meio, o vínculo se
 * perde — `lastInboundMessageId` deixa de ser a âncora e o "sim" que vier
 * depois não resolve nada. Isso impede que um "sim" dito sobre outro
 * assunto dispare um lançamento financeiro.
 */
export function resolve(params: {
  pending: PendingConfirmation | null
  replyText: string
  /** id da última mensagem inbound ANTES desta. */
  previousInboundMessageId: string | null
  now: Date
}): ResolveOutcome {
  const { pending, replyText, previousInboundMessageId, now } = params
  if (!pending) return { kind: 'none' }

  if (isExpired(pending, now)) {
    return { kind: 'expired', confirmation: { ...pending, status: 'expired' } }
  }

  const aindaEhAResposta =
    previousInboundMessageId === null || previousInboundMessageId === pending.anchorMessageId
  if (!aindaEhAResposta) return { kind: 'unrelated' }

  const intent = classifyReply(replyText)
  if (intent === 'affirmative') {
    return { kind: 'confirmed', confirmation: { ...pending, status: 'confirmed' } }
  }
  if (intent === 'negative') {
    return { kind: 'rejected', confirmation: { ...pending, status: 'rejected' } }
  }
  return { kind: 'unrelated' }
}

/** Texto que vai ao WhatsApp junto com o resumo. Curto, como o Kiro fala. */
export function confirmationPrompt(summary: string): string {
  const minutos = Math.round(config.CONFIRMATION_TTL_SECONDS / 60)
  return `${summary}\n\nConfirma? (responda *sim* ou *não* — expira em ${minutos} min)`
}
