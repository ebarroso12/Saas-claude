import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import * as db from '../db/index.js'
import { connectionState } from '../adapters/evolution.js'
import { authorizedHashCount } from '../agent/policies.js'
import { AGENTS } from '../agent/registry.js'
import { TOOLS } from '../tools/index.js'

/**
 * /health é liveness: o processo está de pé? Nunca expõe segredo,
 * nem URL interna, nem nome de instância.
 *
 * /ready é readiness: as dependências respondem? Esta é a que o
 * deploy observa antes de mandar tráfego.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    ok: true,
    service: 'kiro-evolution',
    env: config.NODE_ENV,
    tz: config.TIMEZONE,
  }))

  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {}

    try {
      checks.database = { ok: await db.healthcheck() }
    } catch (err) {
      checks.database = { ok: false, detail: (err as Error).name }
    }

    try {
      const state = await connectionState()
      checks.evolution = { ok: state === 'open', detail: state }
    } catch (err) {
      checks.evolution = { ok: false, detail: (err as Error).name }
    }

    checks.authorizedSenders = { ok: authorizedHashCount() > 0 }
    checks.model = { ok: Boolean(config.ANTHROPIC_MODEL), detail: config.ANTHROPIC_MODEL }

    const ok = Object.values(checks).every((c) => c.ok)
    return reply.code(ok ? 200 : 503).send({
      ok,
      checks,
      agents: Object.keys(AGENTS),
      tools: TOOLS.length,
    })
  })
}
