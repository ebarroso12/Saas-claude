import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'

/**
 * O cérebro do Kiro. Claude, via SDK oficial da Anthropic.
 *
 * REGISTRY DE MODELOS — "colocar todos os modelos"
 * Os modelos Claude não têm a mesma superfície de API. O registry declara
 * a capacidade de cada um em vez de fingir que são intercambiáveis; o
 * `buildRequest` monta o request certo para o modelo escolhido.
 *
 * Trocar de modelo é mudar ANTHROPIC_MODEL no .env. Nada mais.
 */

export type ModelId =
  | 'claude-fable-5-1'
  | 'claude-opus-5'
  | 'claude-opus-4-8'
  | 'claude-sonnet-5'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5'

export interface ModelCapabilities {
  /** thinking:{type:"adaptive"} é aceito? */
  adaptiveThinking: boolean
  /** ainda usa o antigo budget_tokens (e rejeita adaptive)? */
  legacyBudgetTokens: boolean
  /** output_config.effort é aceito? */
  effort: boolean
  /** aceita {"role":"system"} no meio de messages[] sem quebrar o cache? */
  midConversationSystem: boolean
  contextWindow: number
  /** US$ por 1M tokens */
  priceIn: number
  priceOut: number
}

export const MODEL_REGISTRY: Record<ModelId, ModelCapabilities> = {
  'claude-fable-5-1': {
    adaptiveThinking: true,
    legacyBudgetTokens: false,
    effort: true,
    midConversationSystem: true,
    contextWindow: 1_000_000,
    priceIn: 10,
    priceOut: 50,
  },
  'claude-opus-5': {
    adaptiveThinking: true,
    legacyBudgetTokens: false,
    effort: true,
    midConversationSystem: true,
    contextWindow: 1_000_000,
    priceIn: 5,
    priceOut: 25,
  },
  'claude-opus-4-8': {
    adaptiveThinking: true,
    legacyBudgetTokens: false,
    effort: true,
    midConversationSystem: true,
    contextWindow: 1_000_000,
    priceIn: 5,
    priceOut: 25,
  },
  'claude-sonnet-5': {
    adaptiveThinking: true,
    legacyBudgetTokens: false,
    effort: true,
    // ATENÇÃO: Sonnet 5 NÃO aceita system no meio de messages[].
    midConversationSystem: false,
    contextWindow: 1_000_000,
    priceIn: 2,
    priceOut: 10,
  },
  'claude-sonnet-4-6': {
    adaptiveThinking: true,
    legacyBudgetTokens: false,
    effort: true,
    midConversationSystem: false,
    contextWindow: 1_000_000,
    priceIn: 3,
    priceOut: 15,
  },
  'claude-haiku-4-5': {
    // Haiku 4.5 é o fora-da-curva: ainda usa budget_tokens e não tem effort.
    adaptiveThinking: false,
    legacyBudgetTokens: true,
    effort: false,
    midConversationSystem: false,
    contextWindow: 200_000,
    priceIn: 1,
    priceOut: 5,
  },
}

export function isKnownModel(id: string): id is ModelId {
  return id in MODEL_REGISTRY
}

export function capabilitiesOf(id: string): ModelCapabilities {
  if (!isKnownModel(id)) {
    throw new Error(
      `[anthropic] modelo desconhecido: ${id}. ` +
        `Conhecidos: ${Object.keys(MODEL_REGISTRY).join(', ')}`,
    )
  }
  return MODEL_REGISTRY[id]
}

export const client = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
  maxRetries: 2,
  timeout: 120_000,
})

export interface BuildRequestInput {
  model: string
  /** Prefixo ESTÁVEL. Nada volátil aqui, ou o cache morre. */
  system: Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  tools: Anthropic.Tool[]
  maxTokens?: number
}

/**
 * Monta o request respeitando as diferenças entre modelos.
 *
 * CACHE: a ordem de render é tools -> system -> messages, e o match é por
 * PREFIXO. O breakpoint vai no fim do system, que é a maior parte estável.
 * Qualquer byte volátil antes dele (timestamp, id de request) invalida tudo
 * e multiplica a conta. Ver CLAUDE.md.
 */
export function buildRequest(
  input: BuildRequestInput,
): Anthropic.MessageCreateParamsNonStreaming {
  const caps = capabilitiesOf(input.model)

  const system = input.system.map((block, i) =>
    i === input.system.length - 1
      ? { ...block, cache_control: { type: 'ephemeral' as const } }
      : block,
  )

  const maxTokens = input.maxTokens ?? 4096

  const req: Anthropic.MessageCreateParamsNonStreaming = {
    model: input.model,
    max_tokens: maxTokens,
    system,
    messages: input.messages,
    tools: input.tools,
  }

  if (caps.adaptiveThinking) {
    req.thinking = { type: 'adaptive' }
  } else if (caps.legacyBudgetTokens) {
    // budget_tokens tem mínimo de 1024 e precisa ser ESTRITAMENTE menor
    // que max_tokens — igual dá 400. Deriva de max_tokens em vez de fixar,
    // senão um maxTokens baixo quebra o request em produção.
    const budget = Math.max(1024, Math.floor(maxTokens * 0.5))
    if (budget >= maxTokens) {
      throw new Error(
        `[anthropic] ${input.model} exige budget_tokens < max_tokens. ` +
          `max_tokens=${maxTokens} é baixo demais; use ao menos 2049.`,
      )
    }
    req.thinking = { type: 'enabled', budget_tokens: budget }
  }

  // NÃO envie temperature/top_p/top_k nestes modelos — foram removidos e
  // retornam 400. Por isso não há parâmetro de sampling nesta função.

  if (caps.effort) {
    req.output_config = { effort: config.ANTHROPIC_EFFORT }
  }

  return req
}

/** Custo estimado de um turno, para a auditoria. */
export function estimateCostUsd(
  model: string,
  usage: {
    input_tokens?: number | null
    output_tokens?: number | null
    cache_read_input_tokens?: number | null
  },
): number {
  const caps = capabilitiesOf(model)
  const cached = usage.cache_read_input_tokens ?? 0
  const fresh = Math.max(0, (usage.input_tokens ?? 0) - cached)
  // Leitura de cache é uma fração do preço de input; 0.1x é conservador
  // para estimativa interna — não é tabela de preço oficial.
  const inCost = (fresh * caps.priceIn + cached * caps.priceIn * 0.1) / 1_000_000
  const outCost = ((usage.output_tokens ?? 0) * caps.priceOut) / 1_000_000
  return Number((inCost + outCost).toFixed(6))
}
