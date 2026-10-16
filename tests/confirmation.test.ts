import { describe, it, expect } from 'vitest'
import {
  classifyReply,
  resolve,
  isExpired,
  expiryFrom,
  normalizeReply,
  type PendingConfirmation,
} from '../src/confirmations/machine.js'

const BASE: PendingConfirmation = {
  id: 'cf_1',
  conversationId: 'conv_1',
  agentId: 'kiro',
  toolName: 'finance_register',
  action: 'finance_register',
  summary: 'Lançar R$ 350,00 — energia — despesa — moradia — 15/10/2026',
  payload: {},
  anchorMessageId: 'msg_anchor',
  status: 'pending',
  expiresAt: new Date('2026-10-15T15:00:00Z'),
  createdAt: new Date('2026-10-15T14:45:00Z'),
}

const DENTRO_DO_PRAZO = new Date('2026-10-15T14:50:00Z')
const DEPOIS_DO_PRAZO = new Date('2026-10-15T15:30:00Z')

describe('classifyReply — o que conta como autorização', () => {
  it('aceita as formas afirmativas da lista fechada', () => {
    for (const s of ['sim', 'SIM', 'Pode', 'pode lançar', 'confirmo', 'ok', 'beleza', '👍']) {
      expect(classifyReply(s), s).toBe('affirmative')
    }
  })

  it('aceita as formas negativas', () => {
    for (const s of ['não', 'nao', 'cancela', 'deixa pra lá', 'esquece', '❌']) {
      expect(classifyReply(s), s).toBe('negative')
    }
  })

  it('NÃO trata frase ambígua como autorização', () => {
    // O doc é explícito: "não deve interpretar qualquer mensagem vaga
    // como autorização".
    for (const s of [
      'acho que sim',
      'sim, mas muda o valor para 400',
      'talvez',
      'depois eu vejo',
      'e a agenda de amanhã?',
      'sim senhor, mas antes me diga quanto ficou o total do mês',
    ]) {
      expect(classifyReply(s), s).toBe('other')
    }
  })

  it('texto longo nunca é confirmação, mesmo começando com sim', () => {
    expect(classifyReply('sim pode lançar esse e também o da internet de ontem')).toBe('other')
  })

  it('normaliza acento e pontuação de borda', () => {
    expect(normalizeReply('  Não!! ')).toBe('não')
    expect(classifyReply('Confirmo.')).toBe('affirmative')
  })
})

describe('resolve — o vínculo entre o "sim" e o pedido', () => {
  it('confirma quando é a resposta imediata ao pedido', () => {
    const r = resolve({
      pending: BASE,
      replyText: 'sim',
      previousInboundMessageId: 'msg_anchor',
      now: DENTRO_DO_PRAZO,
    })
    expect(r.kind).toBe('confirmed')
  })

  it('NÃO confirma "sim" órfão — houve outra mensagem no meio', () => {
    // 14h02 pedido -> 14h05 "e a agenda?" -> 14h40 "sim"
    // Esse "sim" é sobre a agenda, não sobre o lançamento de R$ 350.
    const r = resolve({
      pending: BASE,
      replyText: 'sim',
      previousInboundMessageId: 'msg_sobre_agenda',
      now: DENTRO_DO_PRAZO,
    })
    expect(r.kind).toBe('unrelated')
  })

  it('expira depois do TTL, mesmo com "sim" perfeito', () => {
    const r = resolve({
      pending: BASE,
      replyText: 'sim',
      previousInboundMessageId: 'msg_anchor',
      now: DEPOIS_DO_PRAZO,
    })
    expect(r.kind).toBe('expired')
  })

  it('rejeita explicitamente', () => {
    const r = resolve({
      pending: BASE,
      replyText: 'cancela',
      previousInboundMessageId: 'msg_anchor',
      now: DENTRO_DO_PRAZO,
    })
    expect(r.kind).toBe('rejected')
  })

  it('mensagem de outro assunto deixa a pendência aberta', () => {
    const r = resolve({
      pending: BASE,
      replyText: 'me mostra a agenda de amanhã',
      previousInboundMessageId: 'msg_anchor',
      now: DENTRO_DO_PRAZO,
    })
    expect(r.kind).toBe('unrelated')
  })

  it('sem pendência, nada acontece', () => {
    const r = resolve({
      pending: null,
      replyText: 'sim',
      previousInboundMessageId: null,
      now: DENTRO_DO_PRAZO,
    })
    expect(r.kind).toBe('none')
  })
})

describe('expiração', () => {
  it('expiryFrom respeita o TTL configurado', () => {
    const now = new Date('2026-10-15T14:00:00Z')
    const exp = expiryFrom(now)
    expect(exp.getTime()).toBe(now.getTime() + 900 * 1000)
  })

  it('isExpired é verdadeiro exatamente no limite', () => {
    expect(isExpired(BASE, new Date('2026-10-15T15:00:00Z'))).toBe(true)
    expect(isExpired(BASE, new Date('2026-10-15T14:59:59Z'))).toBe(false)
  })
})
