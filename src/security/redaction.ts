import { createHash, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

/**
 * Redação e hashing. Invariante 5: segredo nunca no log, no prompt
 * ou na resposta. Telefone só como hash.
 */

/** Hash estável de telefone. O pepper vive só no ambiente. */
export function hashPhone(phoneE164: string): string {
  const normalized = phoneE164.replace(/\D/g, '')
  return createHash('sha256').update(`${config.PHONE_HASH_PEPPER}:${normalized}`).digest('hex')
}

/** O que pode aparecer em log: prefixo curto, suficiente para correlacionar. */
export function hashPrefix(hash: string): string {
  return hash.slice(0, 10)
}

/** Extrai o telefone de um JID do WhatsApp (5500000000000@s.whatsapp.net). */
export function phoneFromJid(jid: string): string {
  const [user] = jid.split('@')
  return (user ?? '').split(':')[0]?.replace(/\D/g, '') ?? ''
}

/** Comparação de segredo em tempo constante. Evita oráculo de timing. */
export function secretEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) {
    // Ainda assim compara contra si mesmo para não vazar o tamanho pelo tempo.
    timingSafeEqual(ba, ba)
    return false
  }
  return timingSafeEqual(ba, bb)
}

const PATTERNS: Array<[RegExp, string]> = [
  // Chaves e tokens conhecidos
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, '[ANTHROPIC_KEY]'],
  [/sk-[A-Za-z0-9]{20,}/g, '[API_KEY]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, 'Bearer [REDACTED]'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[JWT]'],
  // Telefones brasileiros em claro
  [/\b55\d{10,11}\b/g, '[PHONE]'],
  [/\b\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[PHONE]'],
  // CPF e CNPJ
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]'],
  // E-mail
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[EMAIL]'],
]

/** Sanitiza texto livre antes de gravar em log ou em `messages.text_redacted`. */
export function redact(input: string | null | undefined): string {
  if (!input) return ''
  let out = input
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement)
  return out
}

const SENSITIVE_KEYS =
  /^(authorization|apikey|api_key|x-api-key|token|secret|password|senha|cookie|set-cookie|x-webhook-token|webhook_secret)$/i

/** Sanitiza objeto (payload de ferramenta, headers) para auditoria. */
export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[DEPTH_LIMIT]'
  if (value == null) return value
  if (typeof value === 'string') return redact(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((v) => redactObject(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redactObject(v, depth + 1)
    }
    return out
  }
  return '[UNSERIALIZABLE]'
}
