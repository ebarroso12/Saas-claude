import type { FastifyBaseLogger } from 'fastify'
import { config } from '../config.js'
import { getAgent } from './registry.js'
import type { SenderPolicy } from './policies.js'
import type { NormalizedMessage } from '../adapters/evolution.js'
import { sendText } from '../adapters/evolution.js'
import { buildRequest, client, estimateCostUsd } from '../adapters/anthropic.js'
import { toAnthropicTool } from '../tools/types.js'
import { getToolsFor } from '../tools/index.js'
import { redact } from '../security/redaction.js'
import * as db from '../db/index.js'
import type Anthropic from '@anthropic-ai/sdk'

/**
 * Orquestrador de um turno.
 *
 * v1: conversa pura — recebe, pensa com o Claude, responde. Ainda sem
 * ferramenta, como o handoff manda ("primeiro prove o ciclo de mensagem").
 * O gancho de ferramenta e de confirmação já está no lugar e desligado
 * pelo registry (`tools: []`), não por código comentado.
 */

export interface TurnInput {
  conversationId: string
  agentId: string
  role: string
  policy: SenderPolicy
  message: NormalizedMessage
  log: FastifyBaseLogger
}

/** Áudio: Claude não recebe áudio. Sem transcrição, o turno é honesto sobre isso. */
const SEM_TRANSCRICAO =
  'Recebi seu áudio, mas a transcrição ainda não está habilitada aqui. Pode mandar por texto?'

const SEM_SUPORTE =
  'Recebi, mas ainda não consigo ler esse tipo de arquivo por aqui.'

export async function handleTurn(input: TurnInput): Promise<void> {
  const { conversationId, agentId, message, log } = input
  const agent = getAgent(agentId)
  const model = agent.model ?? config.ANTHROPIC_MODEL

  // Tipos que o turno ainda não sabe tratar: responde a verdade, não finge.
  if (message.messageType === 'audio' && !config.TRANSCRIBE_ENABLED) {
    await reply(input, SEM_TRANSCRICAO, model)
    return
  }
  if (message.messageType === 'unsupported' || (!message.text && !message.mediaRef)) {
    await reply(input, SEM_SUPORTE, model)
    return
  }

  const tools = getToolsFor(agent.tools)

  // ── prefixo ESTÁVEL do cache: persona + contrato de ferramenta ──
  // Nada volátil aqui. A data de hoje vai em messages[], não no system.
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: agent.persona }]

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `[contexto: ${nowInTz()}]\n\n${message.text}`,
    },
  ]

  const req = buildRequest({
    model,
    system,
    messages,
    tools: tools.map(toAnthropicTool),
    maxTokens: 2048,
  })

  const response = await client.messages.create(req)

  if (response.stop_reason === 'refusal') {
    log.warn({ evt: 'model.refusal' }, 'modelo recusou o turno')
    await db.audit({
      eventType: 'model.refusal',
      actor: `agent:${agentId}`,
      result: 'refused',
      conversationId,
    })
    await reply(input, 'Não consigo tratar esse pedido por aqui.', model)
    return
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

  if (!text) {
    log.warn({ evt: 'model.empty' }, 'resposta vazia do modelo')
    return
  }

  await db.audit({
    eventType: 'model.turn',
    actor: `agent:${agentId}`,
    result: 'ok',
    conversationId,
    detail: {
      model,
      stop_reason: response.stop_reason,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      est_cost_usd: estimateCostUsd(model, response.usage),
    },
  })

  await reply(input, text, model)
}

async function reply(input: TurnInput, text: string, model: string): Promise<void> {
  const { conversationId, agentId, message, log } = input
  try {
    const { externalId } = await sendText(message.remoteJid, text)
    await db.recordOutbound({
      externalMessageId: externalId ?? `local:${message.messageId}`,
      conversationId,
      text,
      agentId,
      model,
    })
    await db.audit({
      eventType: 'message.sent',
      actor: `agent:${agentId}`,
      result: 'ok',
      conversationId,
      externalId,
    })
  } catch (err) {
    const e = err as Error
    // Invariante 1: falha de entrega é falha. Não se registra como enviado.
    log.error({ evt: 'send.failed', err: redact(e.message) }, 'envio falhou')
    await db.audit({
      eventType: 'message.sent',
      actor: `agent:${agentId}`,
      result: 'error',
      conversationId,
      errorCode: e.name,
      detail: { message: redact(e.message) },
    })
    throw err
  }
}

function nowInTz(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: config.TIMEZONE,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date())
}
