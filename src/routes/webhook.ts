import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../config.js'
import { normalize } from '../adapters/evolution.js'
import { hashPhone, hashPrefix, secretEquals, redact } from '../security/redaction.js'
import { roleForPhoneHash, shouldProcess, policyFor } from '../agent/policies.js'
import { resolveAgent, canRoleUseAgent } from '../agent/registry.js'
import * as db from '../db/index.js'
import { handleTurn } from '../agent/orchestrator.js'

const HEADER = 'x-kiro-webhook-secret'

/**
 * Autenticação do webhook.
 *
 * A Evolution permite headers customizados na config do webhook
 * (Manager > Instance > Webhook > Headers). Aceitamos o segredo ali ou
 * num segmento de path, para o caso de a versão da instância não suportar
 * headers. Comparação em tempo constante nos dois casos.
 */
function authenticate(req: FastifyRequest): boolean {
  const fromHeader = req.headers[HEADER]
  if (typeof fromHeader === 'string' && secretEquals(fromHeader, config.EVOLUTION_WEBHOOK_SECRET)) {
    return true
  }
  const params = req.params as { token?: string } | undefined
  if (params?.token && secretEquals(params.token, config.EVOLUTION_WEBHOOK_SECRET)) {
    return true
  }
  return false
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authenticate(req)) {
      // Não dizemos o porquê. Um 401 detalhado é um oráculo.
      req.log.warn({ evt: 'webhook.unauthorized', ip: req.ip }, 'webhook rejeitado')
      await db
        .audit({ eventType: 'webhook.unauthorized', actor: 'system', result: 'refused' })
        .catch(() => undefined)
      return reply.code(401).send({ ok: false })
    }

    const msg = normalize(req.body)
    if (!msg) {
      // Evento que não é mensagem endereçável (status, grupo, eco próprio).
      // 200 para a Evolution não ficar reenviando.
      return reply.code(200).send({ ok: true, ignored: true })
    }

    const phoneHash = hashPhone(msg.senderPhone)
    const role = roleForPhoneHash(phoneHash)
    const log = req.log.child({ sender: hashPrefix(phoneHash), role, msgId: msg.messageId })

    if (!shouldProcess(role)) {
      // Remetente desconhecido: silêncio. Responder já confirmaria que o
      // número existe e que há um assistente atrás dele.
      log.info({ evt: 'webhook.unknown_sender' }, 'remetente não autorizado — silêncio')
      await db
        .audit({ eventType: 'webhook.unknown_sender', actor: 'system', result: 'refused' })
        .catch(() => undefined)
      return reply.code(200).send({ ok: true, ignored: true })
    }

    const conv = await db.upsertConversation({
      instance: msg.instance,
      remoteJid: msg.remoteJid,
      phoneHash,
      role,
    })

    // Idempotência ANTES de qualquer trabalho. Reentrega da Evolution
    // devolve 200 e não gera segunda resposta nem segunda ação.
    const { isNew } = await db.recordInbound({
      externalMessageId: msg.messageId,
      conversationId: conv.id,
      type: msg.messageType,
      text: msg.text,
    })

    if (!isNew) {
      log.info({ evt: 'webhook.duplicate' }, 'evento duplicado — ignorado')
      await db.audit({
        eventType: 'webhook.duplicate',
        actor: 'system',
        result: 'ok',
        conversationId: conv.id,
        externalId: msg.messageId,
      })
      return reply.code(200).send({ ok: true, duplicate: true })
    }

    const now = new Date()
    const { agentId, clearSticky } = resolveAgent({
      role,
      text: msg.text,
      activeAgent: conv.active_agent,
      stickyUntil: conv.agent_sticky_until,
      now,
    })

    if (!canRoleUseAgent(role, agentId)) {
      log.warn({ evt: 'webhook.agent_forbidden', agentId }, 'papel não alcança o agente')
      await db.audit({
        eventType: 'webhook.agent_forbidden',
        actor: `human:${role}`,
        result: 'refused',
        conversationId: conv.id,
        detail: { agentId },
      })
      return reply.code(200).send({ ok: true, ignored: true })
    }

    if (clearSticky) await db.setActiveAgent(conv.id, agentId, null)

    // Responde à Evolution imediatamente. O turno roda fora do ciclo do
    // webhook: a Evolution reentrega quando demora, e reentrega vira
    // mensagem duplicada. O 200 rápido evita isso.
    reply.code(200).send({ ok: true })

    try {
      await handleTurn({
        conversationId: conv.id,
        agentId,
        role,
        policy: policyFor(role),
        message: msg,
        log,
      })
    } catch (err) {
      const e = err as Error
      log.error({ evt: 'turn.failed', err: redact(e.message) }, 'turno falhou')
      await db
        .audit({
          eventType: 'turn.failed',
          actor: `agent:${agentId}`,
          result: 'error',
          conversationId: conv.id,
          errorCode: e.name,
          detail: { message: redact(e.message) },
        })
        .catch(() => undefined)
    }
  }

  app.post('/webhooks/evolution', handler)
  app.post('/webhooks/evolution/:token', handler)
}
