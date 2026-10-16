import { defineConfig } from 'vitest/config'

/**
 * Ambiente de teste. Vai aqui, e não num `beforeAll`, porque `src/config.ts`
 * valida e sai do processo no momento em que é importado — o que acontece
 * antes de qualquer hook do teste rodar.
 *
 * Nenhum valor real: números fictícios e segredos de brinquedo.
 */
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      EVOLUTION_BASE_URL: 'https://evolution.invalid',
      EVOLUTION_INSTANCE: 'test-instance',
      EVOLUTION_API_KEY: 'test-evolution-key',
      EVOLUTION_WEBHOOK_SECRET: 'segredo-de-teste-bem-longo-0123456789',
      KIRO_WHATSAPP_JID: '5500000000000@s.whatsapp.net',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      ANTHROPIC_MODEL: 'claude-opus-5',
      DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
      AGENT_NAME: 'Kiro',
      OWNER_TITLE: 'Dr. Teste',
      OWNER_FULL_NAME: 'Titular de Teste',
      SPOUSE_NAME: 'Cônjuge',
      PHONE_HASH_PEPPER: 'pepper-de-teste-bem-longo-0123456789',
      SENDER_OWNER: '5511999990001',
      SENDER_OWNER_ALT: '5511999990002',
      SENDER_SPOUSE: '5511999990003',
      SENDER_CLINIC: '5511999990004',
      CONFIRMATION_TTL_SECONDS: '900',
    },
  },
})
