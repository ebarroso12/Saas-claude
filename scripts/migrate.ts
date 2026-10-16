import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/**
 * Migrations. Sem framework: aplica os .sql de migrations/ em ordem
 * alfabética, uma vez cada, dentro de transação, registrando o que já
 * rodou em schema_migrations.
 *
 * Lê DATABASE_URL direto do ambiente em vez de importar src/config.ts —
 * migrar não precisa de chave da Anthropic nem de telefone configurado,
 * e exigir isso só para criar tabela seria atrito sem motivo.
 */

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(here, '..', 'migrations')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('[migrate] DATABASE_URL não definida.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })

async function main(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations')
  const applied = new Set(rows.map((r) => r.name))

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()

  if (files.length === 0) {
    console.log('[migrate] nenhuma migration encontrada em migrations/')
    return
  }

  let ran = 0
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] ja aplicada  ${file}`)
      continue
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    const client = await pool.connect()
    try {
      // Transação por migration: ou aplica inteira, ou não aplica nada.
      // Meia migration aplicada é pior do que nenhuma.
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      console.log(`[migrate] aplicada     ${file}`)
      ran++
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      console.error(`[migrate] FALHOU       ${file}`)
      console.error(`          ${(err as Error).message}`)
      process.exitCode = 1
      return
    } finally {
      client.release()
    }
  }

  console.log(`[migrate] ok — ${ran} nova(s), ${files.length} total`)
}

main()
  .catch((err) => {
    console.error('[migrate] erro:', (err as Error).message)
    process.exitCode = 1
  })
  .finally(() => void pool.end())
