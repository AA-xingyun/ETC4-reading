import type { Store } from './store.js';
import type { AppConfig } from './config.js';

export interface RateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
  reason?: string;
}

/** 北京时间当日 00:00 的日期键与到 24:00 的剩余秒数 */
export function dayKey(now = Date.now()): { date: string; resetInSec: number } {
  const offset = 8 * 3600 * 1000;
  const local = new Date(now + offset);
  const date = local.toISOString().slice(0, 10);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 24 * 3600 * 1000;
  return { date, resetInSec: Math.max(1, Math.floor((midnight - (now + offset)) / 1000)) };
}

export interface RateInput {
  clientId: string;
  ip: string;
  config: AppConfig;
  now?: number;
}

async function bump(store: Store, key: string): Promise<number> {
  const raw = await store.get('rate_limit', key);
  const next = (Number(raw ?? 0) || 0) + 1;
  await store.put('rate_limit', key, String(next));
  return next;
}

/** 三级限流：单客户端日限 → 单 IP 日限 → 最小间隔；token 上限为 0 时不限 */
export async function checkRate(store: Store, input: RateInput): Promise<RateResult> {
  const now = input.now ?? Date.now();
  const { date, resetInSec } = dayKey(now);
  const cfg = input.config;
  const clientKey = `rl:client:${input.clientId}:${date}`;
  const ipKey = `rl:ip:${input.ip}:${date}`;
  const lastKey = `rl:last:${input.clientId}`;

  const clientCount = Number((await store.get('rate_limit', clientKey)) ?? 0) || 0;
  const ipCount = Number((await store.get('rate_limit', ipKey)) ?? 0) || 0;

  if (clientCount >= cfg.perClientDaily) {
    return { allowed: false, limit: cfg.perClientDaily, remaining: 0, retryAfterSec: resetInSec, reason: '客户端今日次数已用完' };
  }
  if (ipCount >= cfg.perIpDaily) {
    return { allowed: false, limit: cfg.perClientDaily, remaining: Math.max(0, cfg.perClientDaily - clientCount), retryAfterSec: resetInSec, reason: 'IP 今日次数已用完' };
  }
  if (cfg.globalDailyTokens > 0) {
    const spent = Number((await store.get('rate_limit', `rl:tokens:${date}`)) ?? 0) || 0;
    if (spent >= cfg.globalDailyTokens) {
      return { allowed: false, limit: cfg.perClientDaily, remaining: Math.max(0, cfg.perClientDaily - clientCount), retryAfterSec: resetInSec, reason: '今日 token 额度已用完' };
    }
  }

  const last = Number((await store.get('rate_limit', lastKey)) ?? 0) || 0;
  if (cfg.minIntervalMs > 0 && now - last < cfg.minIntervalMs) {
    const wait = Math.ceil((cfg.minIntervalMs - (now - last)) / 1000);
    return { allowed: false, limit: cfg.perClientDaily, remaining: Math.max(0, cfg.perClientDaily - clientCount), retryAfterSec: Math.max(1, wait), reason: '请求过于频繁' };
  }

  const used = await bump(store, clientKey);
  await bump(store, ipKey);
  await store.put('rate_limit', lastKey, String(now));
  return {
    allowed: true,
    limit: cfg.perClientDaily,
    remaining: Math.max(0, cfg.perClientDaily - used),
    retryAfterSec: resetInSec,
  };
}

export async function addTokens(store: Store, tokens: number, now = Date.now()): Promise<void> {
  if (!tokens) return;
  const { date } = dayKey(now);
  const key = `rl:tokens:${date}`;
  const raw = Number((await store.get('rate_limit', key)) ?? 0) || 0;
  await store.put('rate_limit', key, String(raw + tokens));
}
