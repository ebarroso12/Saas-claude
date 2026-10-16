import { config } from '../config.js'
import { phoneFromJid } from '../security/redaction.js'

/**
 * Adapter da Evolution API. Ela é SOMENTE a ponte de mensagens —
 * não decide nada, não pensa nada.
 *
 * ARMADILHA: as rotas usam o NOME da instância (EVOLUTION_INSTANCE), não o UUID
 * que aparece no Manager. Errar dá 404 silencioso.
 */

export interface NormalizedMessage {
  eventId: string
  instance: string
  conversationKey: string
  remoteJid: string
  senderPhone: string
  messageId: string
  messageType: 'text' | 'audio' | 'image' | 'document' | 'unsupported'
  text: string
  /** Mídia ainda não transcrita/extraída — referência para o passo seguinte. */
  mediaRef: { mimetype?: string; base64?: string; url?: string } | null
  fromMe: boolean
  isGroup: boolean
  receivedAt: string
}

/** Shape bruto do evento da Evolution v2 (campos que realmente usamos). */
interface EvolutionEvent {
  event?: string
  instance?: string
  data?: {
    key?: { id?: string; remoteJid?: string; fromMe?: boolean; participant?: string }
    pushName?: string
    messageType?: string
    messageTimestamp?: number | string
    message?: Record<string, unknown>
  }
}

function textFromMessage(message: Record<string, unknown> | undefined): string {
  if (!message) return ''
  const conv = message['conversation']
  if (typeof conv === 'string') return conv
  const ext = message['extendedTextMessage'] as { text?: string } | undefined
  if (ext?.text) return ext.text
  const img = message['imageMessage'] as { caption?: string } | undefined
  if (img?.caption) return img.caption
  const doc = message['documentMessage'] as { caption?: string } | undefined
  if (doc?.caption) return doc.caption
  const btn = message['buttonsResponseMessage'] as { selectedDisplayText?: string } | undefined
  if (btn?.selectedDisplayText) return btn.selectedDisplayText
  const list = message['listResponseMessage'] as { title?: string } | undefined
  if (list?.title) return list.title
  return ''
}

function classify(message: Record<string, unknown> | undefined): NormalizedMessage['messageType'] {
  if (!message) return 'unsupported'
  if ('conversation' in message || 'extendedTextMessage' in message) return 'text'
  if ('audioMessage' in message) return 'audio'
  if ('imageMessage' in message) return 'image'
  if ('documentMessage' in message) return 'document'
  if ('buttonsResponseMessage' in message || 'listResponseMessage' in message) return 'text'
  return 'unsupported'
}

function mediaRefOf(
  message: Record<string, unknown> | undefined,
): NormalizedMessage['mediaRef'] {
  if (!message) return null
  for (const key of ['audioMessage', 'imageMessage', 'documentMessage']) {
    const node = message[key] as { mimetype?: string; url?: string } | undefined
    if (node) return { mimetype: node.mimetype, url: node.url }
  }
  return null
}

/**
 * Converte o evento da Evolution no formato interno.
 * Devolve null quando o evento não é uma mensagem endereçável
 * (status, grupo, eco da própria instância).
 */
export function normalize(raw: unknown): NormalizedMessage | null {
  const evt = raw as EvolutionEvent
  const data = evt?.data
  const key = data?.key
  if (!key?.id || !key.remoteJid) return null

  const remoteJid = key.remoteJid
  // Grupos e broadcast de status não entram na v1.
  if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return null
  // Eco da própria instância: ignorar, senão o Kiro responde a si mesmo.
  if (key.fromMe === true) return null

  const message = data?.message
  const ts = data?.messageTimestamp
  const receivedAt =
    typeof ts === 'number'
      ? new Date(ts * 1000).toISOString()
      : typeof ts === 'string' && ts
        ? new Date(Number(ts) * 1000).toISOString()
        : new Date().toISOString()

  return {
    eventId: key.id,
    instance: evt.instance ?? config.EVOLUTION_INSTANCE,
    conversationKey: `${evt.instance ?? config.EVOLUTION_INSTANCE}:${remoteJid}`,
    remoteJid,
    senderPhone: phoneFromJid(key.participant ?? remoteJid),
    messageId: key.id,
    messageType: classify(message),
    text: textFromMessage(message).trim(),
    mediaRef: mediaRefOf(message),
    fromMe: false,
    isGroup: false,
    receivedAt,
  }
}

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'EvolutionError'
  }
}

async function call(path: string, body: unknown): Promise<unknown> {
  const url = `${config.EVOLUTION_BASE_URL.replace(/\/+$/, '')}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.EVOLUTION_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })

  const text = await res.text()
  if (!res.ok) {
    // Nunca inclui o header de auth na mensagem de erro.
    throw new EvolutionError(`Evolution ${res.status} em ${path}`, res.status, text.slice(0, 500))
  }
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

/**
 * Envia texto. Devolve o id externo da mensagem enviada quando a Evolution
 * o informa — é o que prova que saiu, e vai para a auditoria.
 */
export async function sendText(toJid: string, text: string): Promise<{ externalId: string | null }> {
  const result = (await call(`/message/sendText/${encodeURIComponent(config.EVOLUTION_INSTANCE)}`, {
    number: toJid,
    text,
  })) as { key?: { id?: string } }
  return { externalId: result?.key?.id ?? null }
}

/** Estado da conexão da instância. Usado pelo /health. */
export async function connectionState(): Promise<string> {
  const url = `${config.EVOLUTION_BASE_URL.replace(/\/+$/, '')}/instance/connectionState/${encodeURIComponent(
    config.EVOLUTION_INSTANCE,
  )}`
  const res = await fetch(url, {
    headers: { apikey: config.EVOLUTION_API_KEY },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new EvolutionError(`connectionState ${res.status}`, res.status, '')
  const body = (await res.json()) as { instance?: { state?: string } }
  return body?.instance?.state ?? 'unknown'
}
