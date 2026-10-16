import Fastify from 'fastify'
import { config, isProd } from './config.js'
import { healthRoutes } from './routes/health.js'
import { webhookRoutes } from './routes/webhook.js'
import * as db from './db/index.js'

/**
 * Entrada do serviço. Porta 3040, só loopback no compose — Traefik publica.
 * O OpenClaw continua na 18789, intocado.
 */

export function buildServer() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Invariante 5: nada de header de auth no log, nunca.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.apikey',
          'req.headers["x-api-key"]',
          'req.headers["x-kiro-webhook-secret"]',
          'req.headers.cookie',
          'req.body',
        ],
        remove: true,
      },
      ...(isProd ? {} : { transport: { target: 'pino-pretty' } }),
    },
    bodyLimit: 8 * 1024 * 1024, // mídia em base64 cabe; nada absurdo
    trustProxy: true,
    disableRequestLogging: false,
  })

  app.register(healthRoutes)
  app.register(webhookRoutes)

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ ok: false }))

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ evt: 'unhandled', err: (err as Error).name }, 'erro não tratado')
    // Mensagem genérica para fora. O detalhe fica no log.
    reply.code(500).send({ ok: false })
  })

  return app
}

async function main(): Promise<void> {
  const app = buildServer()

  const shutdown = async (signal: string) => {
    app.log.info({ evt: 'shutdown', signal }, 'encerrando')
    try {
      await app.close()
      await db.close()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  app.log.info(
    { evt: 'started', port: config.PORT, model: config.ANTHROPIC_MODEL },
    'kiro-evolution no ar',
  )
}

// Só executa quando rodado direto — permite importar buildServer no teste.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    console.error('[server] falha na partida:', (err as Error).message)
    process.exit(1)
  })
}
