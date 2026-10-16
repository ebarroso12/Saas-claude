import { z } from 'zod'

/**
 * Configuração validada na partida. Se algo essencial falta, o processo
 * não sobe — é melhor não subir do que subir aceitando mensagem sem saber
 * responder, ou pior, sem saber quem é autorizado.
 */

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1')

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3040),
  LOG_LEVEL: z.string().default('info'),
  TIMEZONE: z.string().default('America/Sao_Paulo'),

  // Evolution
  EVOLUTION_BASE_URL: z.string().url(),
  EVOLUTION_INSTANCE: z.string().min(1),
  EVOLUTION_INSTANCE_ID: z.string().optional(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(16, 'webhook secret curto demais'),
  KIRO_WHATSAPP_JID: z.string().min(1),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),

  DATABASE_URL: z.string().min(1),

  // ── Identidade ──────────────────────────────────────────────
  // Nome de pessoa é configuração, não código. Mantém o repositório
  // publicável e a persona byte-estável por deploy (o cache sobrevive).
  AGENT_NAME: z.string().min(1).default('Kiro'),
  OWNER_TITLE: z.string().min(1),
  OWNER_FULL_NAME: z.string().min(1),
  SPOUSE_NAME: z.string().min(1).optional(),

  // Autorização
  PHONE_HASH_PEPPER: z.string().min(16, 'pepper curto demais'),
  SENDER_OWNER: z.string().regex(/^\d{10,15}$/),
  SENDER_OWNER_ALT: z.string().regex(/^\d{10,15}$/).optional(),
  SENDER_SPOUSE: z.string().regex(/^\d{10,15}$/).optional(),
  SENDER_CLINIC: z.string().regex(/^\d{10,15}$/).optional(),

  CONFIRMATION_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  TRANSCRIBE_ENABLED: bool,
  TRANSCRIBE_PROVIDER: z.string().optional(),
  TRANSCRIBE_API_KEY: z.string().optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  // Nomes dos campos, nunca os valores — um erro de config não pode
  // virar o vazamento que o projeto inteiro existe para evitar.
  const campos = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  console.error('[config] ambiente inválido:\n  ' + campos.join('\n  '))
  process.exit(1)
}

export const config = parsed.data
export type Config = typeof config

export const isProd = config.NODE_ENV === 'production'
