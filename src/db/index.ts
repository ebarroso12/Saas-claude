import pg from 'pg'
import { config } from '../config.js'
import { redact, redactObject } from '../security/redaction.js'

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

export async function healthcheck(): Promise<boolean> {
  const r = await pool.query('SELECT 1 AS ok')
  return r.rows[0]?.ok === 1
}

// ── conversas ────────────────────────────────────────────────

export interface ConversationRow {
  id: string
  active_agent: string
  agent_sticky_until: Date | null
  sender_role: string
}

export async function upsertConversation(params: {
  instance: string
  remoteJid: string
  phoneHash: string
  role: string
}): Promise<ConversationRow> {
  const { rows } = await pool.query<ConversationRow>(
    `INSERT INTO conversations (instance, remote_jid, sender_phone_hash, sender_role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (instance, remote_jid) DO UPDATE
       SET updated_at = now(), sender_role = EXCLUDED.sender_role
     RETURNING id, active_agent, agent_sticky_until, sender_role`,
    [params.instance, params.remoteJid, params.phoneHash, params.role],
  )
  const row = rows[0]
  if (!row) throw new Error('upsertConversation não retornou linha')
  return row
}

export async function setActiveAgent(
  conversationId: string,
  agentId: string,
  stickyUntil: Date | null,
): Promise<void> {
  await pool.query(
    `UPDATE conversations SET active_agent = $2, agent_sticky_until = $3, updated_at = now()
     WHERE id = $1`,
    [conversationId, agentId, stickyUntil],
  )
}

// ── mensagens / idempotência ─────────────────────────────────

/**
 * Registra a mensagem de entrada. Devolve false se já existia.
 *
 * A idempotência é o UNIQUE do banco, não um SELECT antes do INSERT —
 * dois webhooks simultâneos com o mesmo id passariam pelo SELECT juntos
 * e os dois inseririam. ON CONFLICT DO NOTHING não tem essa corrida.
 */
export async function recordInbound(params: {
  externalMessageId: string
  conversationId: string
  type: string
  text: string
}): Promise<{ isNew: boolean; id: string | null }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO messages (external_message_id, conversation_id, direction, type, text_redacted)
     VALUES ($1, $2, 'inbound', $3, $4)
     ON CONFLICT (external_message_id, direction) DO NOTHING
     RETURNING id`,
    [params.externalMessageId, params.conversationId, params.type, redact(params.text)],
  )
  const row = rows[0]
  return { isNew: Boolean(row), id: row?.id ?? null }
}

export async function recordOutbound(params: {
  externalMessageId: string
  conversationId: string
  text: string
  agentId: string
  model: string
}): Promise<void> {
  await pool.query(
    `INSERT INTO messages
       (external_message_id, conversation_id, direction, type, text_redacted, status, agent_id, model)
     VALUES ($1, $2, 'outbound', 'text', $3, 'sent', $4, $5)
     ON CONFLICT (external_message_id, direction) DO NOTHING`,
    [
      params.externalMessageId,
      params.conversationId,
      redact(params.text),
      params.agentId,
      params.model,
    ],
  )
}

export async function previousInboundMessageId(
  conversationId: string,
  beforeExternalId: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ external_message_id: string }>(
    `SELECT external_message_id FROM messages
     WHERE conversation_id = $1 AND direction = 'inbound' AND external_message_id <> $2
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId, beforeExternalId],
  )
  return rows[0]?.external_message_id ?? null
}

// ── auditoria ────────────────────────────────────────────────

export async function audit(params: {
  eventType: string
  actor: string
  result: 'ok' | 'error' | 'refused' | 'awaiting_confirmation'
  conversationId?: string | null
  toolName?: string | null
  externalId?: string | null
  errorCode?: string | null
  detail?: unknown
}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_events
       (event_type, actor, conversation_id, tool_name, result, external_id, error_code, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.eventType,
      params.actor,
      params.conversationId ?? null,
      params.toolName ?? null,
      params.result,
      params.externalId ?? null,
      params.errorCode ?? null,
      params.detail === undefined ? null : JSON.stringify(redactObject(params.detail)),
    ],
  )
}

export async function close(): Promise<void> {
  await pool.end()
}
