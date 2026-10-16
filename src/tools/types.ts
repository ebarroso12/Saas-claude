import type Anthropic from '@anthropic-ai/sdk'

/**
 * Contrato das ferramentas. Invariante 2 e 3 moram aqui.
 *
 * Cada ferramenta declara explicitamente o que ela é. Não existe ferramenta
 * sem classificação — o tipo obriga. Se alguém adicionar uma ferramenta nova
 * e esquecer de pensar no risco, o TypeScript não compila.
 */

export type ToolRisk =
  /** Só lê. Pode rodar sem perguntar nada. */
  | 'read_only'
  /** Escreve, mas é trivialmente desfazível e de baixo impacto. */
  | 'reversible'
  /** Escreve de forma sensível, representacional ou irreversível.
   *  NUNCA executa sem confirmação humana explícita. */
  | 'requires_confirmation'

export type ConnectorId =
  | 'core'
  | 'dashboard'
  | 'google'
  | 'microsoft'
  | 'injetaveis'
  | 'openclaw'

export interface ToolContext {
  conversationId: string
  agentId: string
  senderRole: string
  /** id da mensagem que originou o turno — âncora da confirmação. */
  anchorMessageId: string
}

export interface ToolResultOk {
  status: 'ok'
  /** id devolvido pela API externa. É isto que PROVA a gravação. */
  externalId?: string | null
  data: unknown
}

export interface ToolResultError {
  status: 'error'
  errorCode: string
  /** Mensagem já sanitizada, segura para ir ao modelo. */
  message: string
}

export interface ToolResultAwaiting {
  status: 'awaiting_confirmation'
  confirmationId: string
  /** Resumo legível que o modelo deve apresentar ao humano, sem reescrever. */
  summary: string
}

export type ToolResult = ToolResultOk | ToolResultError | ToolResultAwaiting

export interface ToolDef<TInput = unknown> {
  name: string
  connector: ConnectorId
  risk: ToolRisk
  /** Descrição que o modelo lê. Sem segredo, sem URL interna, sem token. */
  description: string
  inputSchema: Anthropic.Tool['input_schema']
  /**
   * Resumo humano da ação, usado no pedido de confirmação.
   * Obrigatório para `requires_confirmation` — é o texto que o titular
   * vai ler antes de dizer "sim". Precisa ser exato e completo.
   */
  summarize?: (input: TInput) => string
  execute: (input: TInput, ctx: ToolContext) => Promise<ToolResultOk | ToolResultError>
}

/** Converte a definição interna no formato que a API da Anthropic espera. */
export function toAnthropicTool(def: ToolDef): Anthropic.Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: def.inputSchema,
  }
}

/**
 * Guarda em tempo de carga: ferramenta sensível sem `summarize` é bug.
 * Sem resumo não há como pedir confirmação honesta, e o modelo acabaria
 * inventando o texto — exatamente o que não pode acontecer.
 */
export function assertToolInvariants(defs: ToolDef[]): void {
  const problemas: string[] = []
  const vistos = new Set<string>()
  for (const d of defs) {
    if (vistos.has(d.name)) problemas.push(`ferramenta duplicada: ${d.name}`)
    vistos.add(d.name)
    if (d.risk === 'requires_confirmation' && typeof d.summarize !== 'function') {
      problemas.push(`${d.name}: risk=requires_confirmation exige summarize()`)
    }
    const s = d.inputSchema as { type?: string; properties?: unknown }
    if (s?.type !== 'object' || !s.properties) {
      problemas.push(`${d.name}: inputSchema precisa ser object com properties`)
    }
  }
  if (problemas.length) {
    throw new Error('[tools] contrato violado:\n  ' + problemas.join('\n  '))
  }
}
