export declare const MIGRATIONS_DIR: string

export declare class SqliteD1 {
  constructor(path?: string)
  prepare(sql: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>
  exec(sql: string): Promise<D1ExecResult>
  query<T = Record<string, unknown>>(sql: string, ...values: unknown[]): T[]
  statements: string[]
  sqlite: { exec(sql: string): void }
  close(): void
}

export declare function migrationFiles(): string[]
export declare function applyMigrations(db: SqliteD1, options?: { upTo?: string }): SqliteD1
export declare function createTestDatabase(options?: { upTo?: string }): SqliteD1 & D1Database

export declare class MemoryR2 {
  objects: Map<string, { key: string; bytes: Uint8Array; httpMetadata: Record<string, string>; customMetadata: Record<string, string> }>
  put(key: string, value: unknown, options?: Record<string, unknown>): Promise<unknown>
  get(key: string): Promise<R2ObjectBody | null>
  head(key: string): Promise<R2Object | null>
  delete(keys: string | string[]): Promise<void>
  list(options?: { prefix?: string }): Promise<R2Objects>
}

export declare function createPng(width?: number, height?: number, rgb?: number[]): Uint8Array
