import { createHash } from 'node:crypto'

/**
 * Calcula o hash de um telefone com o pepper atual.
 *
 * Para quê: o banco guarda só hash e o log só o prefixo. Quando você
 * precisa descobrir a qual número pertence uma linha de auditoria, é isto
 * que fecha a conta — sem nunca gravar o número em lugar nenhum.
 *
 *   PHONE_HASH_PEPPER=... npm run hash-phone -- 5511999990001
 *
 * Ele IMPRIME o número que você digitou. Não rode com a tela compartilhada
 * e não cole a saída em lugar público.
 */

const pepper = process.env.PHONE_HASH_PEPPER
if (!pepper) {
  console.error('[hash-phone] PHONE_HASH_PEPPER não definida.')
  process.exit(1)
}

const args = process.argv.slice(2).filter((a) => a.trim().length > 0)
if (args.length === 0) {
  console.error('[hash-phone] uso: npm run hash-phone -- <telefone> [outro...]')
  console.error('              formato livre; só os dígitos contam.')
  process.exit(1)
}

// Mesma normalização de src/security/redaction.ts. Se uma mudar, a outra
// tem que mudar junto — senão o hash daqui não casa com o do banco.
for (const raw of args) {
  const normalized = raw.replace(/\D/g, '')
  if (!normalized) {
    console.error(`${raw.padEnd(20)} -> sem dígitos, ignorado`)
    continue
  }
  const hash = createHash('sha256').update(`${pepper}:${normalized}`).digest('hex')
  console.log(`${normalized.padEnd(16)} ${hash}  (prefixo no log: ${hash.slice(0, 10)})`)
}
