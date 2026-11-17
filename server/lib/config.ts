import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Driver } from './store.js';
import { PROMPT_VERSION } from '../llm/prompts.js';

export interface AppConfig {
  port: number;
  apiAccessToken: string;
  sessionSecret: string;
  cacheDriver: Driver;
  sqlitePath: string;
  perClientDaily: number;
  perIpDaily: number;
  /** 0 表示不限制（token 无上限） */
  globalDailyTokens: number;
  minIntervalMs: number;
  /** 兜底 provider；留空表示与主模型相同（由反馈重试承担） */
  fallbackProvider: string;
  promptVersion: string;
  sessionTtlMs: number;
}

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const driver = (env.CACHE_DRIVER || 'sqlite').toLowerCase();
  return {
    port: num(env, 'PORT', 8787),
    apiAccessToken: env.API_ACCESS_TOKEN?.trim() ?? '',
    // 没有显式配置时每次启动生成随机密钥，重启后旧会话自动失效
    sessionSecret: env.SESSION_SECRET?.trim() || randomBytes(32).toString('hex'),
    cacheDriver: driver === 'redis' || driver === 'memory' ? (driver as Driver) : 'sqlite',
    sqlitePath: env.CACHE_DB_PATH?.trim() || './data/cache.db',
    perClientDaily: num(env, 'PER_CLIENT_DAILY', 20),
    perIpDaily: num(env, 'PER_IP_DAILY', 60),
    globalDailyTokens: num(env, 'GLOBAL_DAILY_TOKENS', 0),
    minIntervalMs: num(env, 'MIN_INTERVAL_MS', 3000),
    fallbackProvider: env.FALLBACK_PROVIDER?.trim() ?? '',
    promptVersion: env.PROMPT_VERSION?.trim() || PROMPT_VERSION,
    sessionTtlMs: num(env, 'SESSION_TTL_MS', 3600 * 1000),
  };
}

/**
 * 极简 .env 加载（无依赖）：已存在的 process.env 优先，不覆盖。
 * 在服务入口调用，避免测试误读开发者本地配置。
 */
export function loadDotEnv(file = '.env'): void {
  try {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key] !== undefined) continue;
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    /* 没有 .env 也能启动 */
  }
}