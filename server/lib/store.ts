/**
 * 统一存储层：缓存、限流计数、待发布队列共用同一介质。
 * CACHE_DRIVER=sqlite|redis|memory；sqlite 驱动不可用时自动降级为 memory 并在 /api/providers 标注。
 */
export type Table = 'reading_cache' | 'rate_limit' | 'reading_queue';
export type Driver = 'sqlite' | 'redis' | 'memory';

export interface Store {
  driver: Driver;
  get(table: Table, key: string): Promise<string | null>;
  put(table: Table, key: string, value: string, expiresAt?: number): Promise<void>;
  del(table: Table, key: string): Promise<void>;
  list(table: Table): Promise<{ key: string; value: string; expiresAt?: number }[]>;
  cleanExpired(table: Table, now?: number): Promise<void>;
  close(): void;
}

const TABLES: Table[] = ['reading_cache', 'rate_limit', 'reading_queue'];

class MemoryStore implements Store {
  driver: Driver = 'memory';
  private data = new Map<Table, Map<string, { value: string; expiresAt?: number }>>();

  constructor() {
    for (const t of TABLES) this.data.set(t, new Map());
  }

  private map(table: Table) {
    const m = this.data.get(table);
    if (!m) throw new Error(`unknown table ${table}`);
    return m;
  }

  async get(table: Table, key: string) {
    const row = this.map(table).get(key);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt <= Date.now()) {
      this.map(table).delete(key);
      return null;
    }
    return row.value;
  }

  async put(table: Table, key: string, value: string, expiresAt?: number) {
    this.map(table).set(key, { value, expiresAt });
  }

  async del(table: Table, key: string) {
    this.map(table).delete(key);
  }

  async list(table: Table) {
    const out: { key: string; value: string; expiresAt?: number }[] = [];
    for (const [key, row] of this.map(table)) {
      if (row.expiresAt && row.expiresAt <= Date.now()) continue;
      out.push({ key, ...row });
    }
    return out;
  }

  async cleanExpired(table: Table, now = Date.now()) {
    for (const [key, row] of this.map(table)) {
      if (row.expiresAt && row.expiresAt <= now) this.map(table).delete(key);
    }
  }

  close() {
    this.data.clear();
  }
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): unknown;
  };
  close(): void;
}

class SqliteStore implements Store {
  driver: Driver = 'sqlite';
  private db: SqliteDb;

  constructor(file: string) {
    // 延迟 require：没装 better-sqlite3 或没有编译工具时能优雅降级
    const requireFn = (globalThis as any).process ? createRequire(import.meta.url) : null;
    if (!requireFn) throw new Error('no require');
    const Database = requireFn('better-sqlite3');
    this.db = new Database(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS reading_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, provider TEXT, expire_at INTEGER);
      CREATE INDEX IF NOT EXISTS idx_cache_expire ON reading_cache(expire_at);
      CREATE TABLE IF NOT EXISTS rate_limit (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER);
      CREATE TABLE IF NOT EXISTS reading_queue (key TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER);
    `);
  }

  private pick(table: Table) {
    if (table === 'reading_cache') {
      return {
        select: 'SELECT data AS value, expire_at AS expiresAt FROM reading_cache WHERE key = ?',
        insert: 'INSERT INTO reading_cache(key, data, provider, expire_at) VALUES(?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET data=excluded.data, expire_at=excluded.expire_at',
        remove: 'DELETE FROM reading_cache WHERE key = ?',
        all: 'SELECT key, data AS value, expire_at AS expiresAt FROM reading_cache',
        clean: 'DELETE FROM reading_cache WHERE expire_at IS NOT NULL AND expire_at <= ?',
      };
    }
    if (table === 'reading_queue') {
      return {
        select: 'SELECT data AS value, NULL AS expiresAt FROM reading_queue WHERE key = ?',
        insert: 'INSERT INTO reading_queue(key, data, created_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET data=excluded.data',
        remove: 'DELETE FROM reading_queue WHERE key = ?',
        all: 'SELECT key, data AS value FROM reading_queue',
        clean: 'DELETE FROM reading_queue WHERE 0',
      };
    }
    return {
      select: 'SELECT CAST(count AS TEXT) AS value, window_start AS expiresAt FROM rate_limit WHERE key = ?',
      insert: 'INSERT INTO rate_limit(key, count, window_start) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET count=excluded.count, window_start=excluded.window_start',
      remove: 'DELETE FROM rate_limit WHERE key = ?',
      all: 'SELECT key, CAST(count AS TEXT) AS value, window_start AS expiresAt FROM rate_limit',
      clean: 'DELETE FROM rate_limit WHERE 0',
    };
  }

  async get(table: Table, key: string) {
    const row = this.db.prepare(this.pick(table).select).get(key) as { value?: string; expiresAt?: number } | undefined;
    if (!row) return null;
    if (row.expiresAt && row.expiresAt <= Date.now()) return null;
    return row.value ?? null;
  }

  async put(table: Table, key: string, value: string, expiresAt?: number) {
    if (table === 'reading_cache') {
      this.db.prepare(this.pick(table).insert).run(key, value, '', expiresAt ?? 0);
    } else if (table === 'reading_queue') {
      this.db.prepare(this.pick(table).insert).run(key, value, Date.now());
    } else {
      this.db.prepare(this.pick(table).insert).run(key, Number(value) || 0, Date.now());
    }
  }

  async del(table: Table, key: string) {
    this.db.prepare(this.pick(table).remove).run(key);
  }

  async list(table: Table) {
    return this.db.prepare(this.pick(table).all).all() as { key: string; value: string; expiresAt?: number }[];
  }

  async cleanExpired(table: Table, now = Date.now()) {
    this.db.prepare(this.pick(table).clean).run(now);
  }

  close() {
    this.db.close();
  }
}

import { createRequire } from 'node:module';

export function openStore(driver: Driver, sqlitePath = './data/cache.db'): Store {
  if (driver === 'sqlite') {
    try {
      // 目录不存在时 better-sqlite3 会直接抛错，先建目录
      const requireFn = createRequire(import.meta.url);
      requireFn('node:fs').mkdirSync(requireFn('node:path').dirname(sqlitePath), { recursive: true });
      return new SqliteStore(sqlitePath);
    } catch (err) {
      console.warn('[store] sqlite 不可用，降级为 memory：', (err as Error).message);
      return new MemoryStore();
    }
  }
  if (driver === 'redis') {
    // Redis 驱动按需接入：未安装 ioredis 时同样降级，避免启动失败
    console.warn('[store] redis 驱动未启用，回退 memory');
    return new MemoryStore();
  }
  return new MemoryStore();
}
