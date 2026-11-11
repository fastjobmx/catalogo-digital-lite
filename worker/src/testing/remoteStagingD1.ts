/** D1Database adapter over `wrangler d1 execute --remote`, ONLY for the staging test database.
 * It refuses to run unless wrangler reports exactly the staging database id, and never the production one.
 * Slow (one wrangler process per call): used by the opt-in staging validation test, not by the normal suite. */
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'

export const STAGING_DB_NAME = 'sneakerhub-telegram-staging-db'
export const STAGING_DB_ID = '18ac228c-c142-45c7-b801-6ae0c6e1f8eb'
export const PRODUCTION_DB_ID = '10b10054-9e28-4346-8b2b-a19323ed27f3'

type Row = Record<string, unknown>

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

function inline(sql: string, values: unknown[]): string {
  let index = 0
  const out = sql.replace(/\?/g, () => literal(values[index++]))
  if (index !== values.length) throw new Error(`Parameter count mismatch for: ${sql.slice(0, 80)}`)
  return out
}

const WRANGLER = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const baseArgs = ['d1', 'execute', STAGING_DB_NAME, '--remote', '-c', 'wrangler.remote-staging.toml']

async function execute(sql: string): Promise<Array<{ results: Row[]; meta: Record<string, number> }>> {
  // No shell: the SQL travels as one exact argument.
  const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(process.execPath, [WRANGLER, ...baseArgs, '--json', '--command', sql], { cwd: process.cwd() })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    child.on('error', (error) => resolve({ code: -1, out: `spawn error: ${error.message}` }))
    child.on('close', (status) => resolve({ code: status, out }))
  })
  if (out.includes(PRODUCTION_DB_ID)) throw new Error('Refusing: the production database id appeared in the output')
  const start = out.indexOf('[')
  if (code !== 0 || start < 0) throw new Error(`wrangler failed (exit ${code}): ${out.slice(-400)}`)
  return JSON.parse(out.slice(start))
}

/** Fails fast unless the target is provably the staging database. */
export function assertStagingTarget(): void {
  const result = spawnSync(process.execPath, [WRANGLER, ...baseArgs, '--command', 'SELECT 1'], { encoding: 'utf8', cwd: process.cwd() })
  const out = `${result.stdout || ''}${result.stderr || ''}`
  if (!out.includes(STAGING_DB_ID) || out.includes(PRODUCTION_DB_ID)) throw new Error('The target database is not the staging database. Aborting.')
}

class RemoteStatement {
  constructor(readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new RemoteStatement(this.sql, values) }
  text() { return inline(this.sql, this.values) }
  private shaped(result: { results: Row[]; meta: Record<string, number> }) { return { results: result.results || [], success: true, meta: result.meta || {} } }
  async first<T = Row>(): Promise<T | null> { return ((await execute(this.text()))[0]?.results?.[0] as T) ?? null }
  async all<T = Row>() { const r = (await execute(this.text()))[0]!; return { ...this.shaped(r), results: (r.results || []) as T[] } }
  async run() { return this.shaped((await execute(this.text()))[0]!) }
}

export function remoteStagingD1(): D1Database {
  return {
    prepare: (sql: string) => new RemoteStatement(sql),
    batch: async (statements: RemoteStatement[]) => (await execute(statements.map((statement) => statement.text()).join(';\n'))).map((r) => ({ results: r.results || [], success: true, meta: r.meta || {} })),
  } as unknown as D1Database
}
