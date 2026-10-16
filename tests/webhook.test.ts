import { describe, it, expect } from 'vitest'
import { normalize } from '../src/adapters/evolution.js'
import { hashPhone, phoneFromJid, redact, secretEquals } from '../src/security/redaction.js'
import { roleForPhoneHash, shouldProcess, policyFor } from '../src/agent/policies.js'
import { resolveAgent, canRoleUseAgent, wantsExitSticky } from '../src/agent/registry.js'

/** Evento da Evolution, com o mínimo que o normalizador lê. */
function evt(over: Record<string, unknown> = {}) {
  return {
    event: 'messages.upsert',
    instance: 'test-instance',
    data: {
      key: { id: 'MSG1', remoteJid: '5511999990001@s.whatsapp.net', fromMe: false },
      pushName: 'Qualquer Nome',
      messageTimestamp: 1760000000,
      message: { conversation: 'bom dia' },
      ...over,
    },
  }
}

describe('normalize — o que entra e o que é descartado', () => {
  it('normaliza uma mensagem de texto', () => {
    const m = normalize(evt())
    expect(m).not.toBeNull()
    expect(m!.messageId).toBe('MSG1')
    expect(m!.messageType).toBe('text')
    expect(m!.text).toBe('bom dia')
    expect(m!.senderPhone).toBe('5511999990001')
  })

  it('descarta o eco da própria instância (fromMe)', () => {
    // Sem isto o agente responde a si mesmo em loop.
    const m = normalize(evt({ key: { id: 'X', remoteJid: 'a@s.whatsapp.net', fromMe: true } }))
    expect(m).toBeNull()
  })

  it('descarta grupo', () => {
    const m = normalize(evt({ key: { id: 'X', remoteJid: '123-456@g.us', fromMe: false } }))
    expect(m).toBeNull()
  })

  it('descarta broadcast de status', () => {
    const m = normalize(evt({ key: { id: 'X', remoteJid: 'status@broadcast', fromMe: false } }))
    expect(m).toBeNull()
  })

  it('descarta evento sem id ou sem remoteJid', () => {
    expect(normalize({ data: { key: {} } })).toBeNull()
    expect(normalize({})).toBeNull()
    expect(normalize(null)).toBeNull()
  })

  it('classifica áudio, imagem e documento', () => {
    expect(normalize(evt({ message: { audioMessage: { mimetype: 'audio/ogg' } } }))!.messageType).toBe('audio')
    expect(normalize(evt({ message: { imageMessage: { caption: 'boleto' } } }))!.messageType).toBe('image')
    expect(normalize(evt({ message: { documentMessage: {} } }))!.messageType).toBe('document')
  })

  it('extrai legenda de imagem como texto', () => {
    const m = normalize(evt({ message: { imageMessage: { caption: 'conta de luz' } } }))
    expect(m!.text).toBe('conta de luz')
  })

  it('usa participant quando existe (mensagem via participante)', () => {
    const m = normalize(
      evt({
        key: {
          id: 'X',
          remoteJid: '5511999990001@s.whatsapp.net',
          participant: '5511999990003@s.whatsapp.net',
          fromMe: false,
        },
      }),
    )
    expect(m!.senderPhone).toBe('5511999990003')
  })
})

describe('autorização — nunca pelo nome exibido', () => {
  it('reconhece os papéis pelos hashes configurados', () => {
    expect(roleForPhoneHash(hashPhone('5511999990001'))).toBe('owner')
    expect(roleForPhoneHash(hashPhone('5511999990002'))).toBe('owner')
    expect(roleForPhoneHash(hashPhone('5511999990003'))).toBe('spouse')
    expect(roleForPhoneHash(hashPhone('5511999990004'))).toBe('clinic')
  })

  it('desconhecido não é processado — silêncio total', () => {
    const role = roleForPhoneHash(hashPhone('5511000000000'))
    expect(role).toBe('unknown')
    expect(shouldProcess(role)).toBe(false)
    expect(policyFor(role).allowedAgents).toEqual([])
    expect(policyFor(role).memoryScopes).toEqual([])
  })

  it('o pushName do WhatsApp não influencia nada', () => {
    // O remetente controla o pushName; ele é falsificável.
    const a = normalize(evt({ pushName: 'Titular' }))
    const b = normalize(evt({ pushName: 'Invasor' }))
    expect(hashPhone(a!.senderPhone)).toBe(hashPhone(b!.senderPhone))
  })

  it('normaliza formatos diferentes do mesmo número para o mesmo hash', () => {
    expect(hashPhone('+55 11 99999-0001')).toBe(hashPhone('5511999990001'))
    expect(hashPhone('(11) 99999-0001')).not.toBe(hashPhone('5511999990001'))
  })

  it('a clínica não alcança o agente pessoal', () => {
    expect(canRoleUseAgent('clinic', 'kiro')).toBe(false)
    expect(canRoleUseAgent('owner', 'kiro')).toBe(true)
    expect(canRoleUseAgent('spouse', 'kiro')).toBe(true)
    expect(canRoleUseAgent('unknown', 'kiro')).toBe(false)
  })

  it('escopo de memória da clínica não inclui o pessoal', () => {
    expect(policyFor('clinic').memoryScopes).toEqual(['clinic'])
    expect(policyFor('clinic').memoryScopes).not.toContain('approved')
    expect(policyFor('clinic').canConfirmSensitive).toBe(false)
  })
})

describe('roteamento de agente e modo sticky', () => {
  const now = new Date('2026-10-16T12:00:00Z')
  const futuro = new Date('2026-10-16T12:30:00Z')
  const passado = new Date('2026-10-16T11:30:00Z')

  it('sem sticky, cai no agente default', () => {
    const r = resolveAgent({ role: 'owner', text: 'bom dia', activeAgent: 'kiro', stickyUntil: null, now })
    expect(r.agentId).toBe('kiro')
  })

  it('reconhece as palavras de saída de modo', () => {
    for (const s of ['menu', 'kiro', 'dashboard', 'sair', 'voltar', 'MENU', ' menu ']) {
      expect(wantsExitSticky(s), s).toBe(true)
    }
    for (const s of ['menu de hoje', 'quero o kiro de volta', 'dashboards']) {
      expect(wantsExitSticky(s), s).toBe(false)
    }
  })

  it('palavra de saída limpa o sticky mesmo com modo ativo', () => {
    const r = resolveAgent({
      role: 'owner',
      text: 'menu',
      activeAgent: 'kiro',
      stickyUntil: futuro,
      now,
    })
    expect(r.agentId).toBe('kiro')
    expect(r.clearSticky).toBe(true)
  })

  it('sticky expirado volta ao default e pede limpeza', () => {
    const r = resolveAgent({
      role: 'owner',
      text: 'qualquer coisa',
      activeAgent: 'kiro',
      stickyUntil: passado,
      now,
    })
    expect(r.agentId).toBe('kiro')
    expect(r.clearSticky).toBe(true)
  })
})

describe('redação — segredo nunca vaza', () => {
  it('mascara chave da Anthropic, JWT e Bearer', () => {
    expect(redact('key sk-ant-abc123def456ghi')).not.toContain('abc123def456')
    expect(redact('Authorization: Bearer abcdef1234567890')).toContain('[REDACTED]')
    expect(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef')).toContain('[JWT]')
  })

  it('mascara telefone, CPF, CNPJ e e-mail', () => {
    expect(redact('meu zap e 5511999990001')).toContain('[PHONE]')
    expect(redact('cpf 123.456.789-00')).toContain('[CPF]')
    expect(redact('cnpj 12.345.678/0001-99')).toContain('[CNPJ]')
    expect(redact('manda pra alguem@exemplo.com')).toContain('[EMAIL]')
  })

  it('aguenta nulo e vazio', () => {
    expect(redact(null)).toBe('')
    expect(redact(undefined)).toBe('')
    expect(redact('')).toBe('')
  })

  it('phoneFromJid extrai só os dígitos', () => {
    expect(phoneFromJid('5511999990001@s.whatsapp.net')).toBe('5511999990001')
    expect(phoneFromJid('5511999990001:12@s.whatsapp.net')).toBe('5511999990001')
  })

  it('secretEquals não estoura com tamanhos diferentes', () => {
    expect(secretEquals('abc', 'abc')).toBe(true)
    expect(secretEquals('abc', 'abcd')).toBe(false)
    expect(secretEquals('', '')).toBe(true)
  })
})
