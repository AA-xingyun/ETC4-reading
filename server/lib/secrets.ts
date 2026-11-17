/**
 * 服务端保存的 Provider 凭据（设置页写入）。
 * 优先级：设置页保存的 Key > 环境变量 > 未配置。
 * 文件只在本机，权限交给操作系统；接口永远不回传明文。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderName } from '../../shared/types.js';

export interface StoredProvider {
  apiKey: string;
  model?: string;
  baseURL?: string;
  updatedAt: number;
}

export type StoredSecrets = Partial<Record<ProviderName, StoredProvider>>;

export function secretsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROVIDERS_DB_PATH?.trim() || './data/providers.json';
}

export function readSecrets(env: NodeJS.ProcessEnv = process.env): StoredSecrets {
  const file = secretsPath(env);
  try {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { providers?: StoredSecrets };
    return raw?.providers ?? {};
  } catch {
    return {};
  }
}

function writeSecrets(all: StoredSecrets, env: NodeJS.ProcessEnv = process.env): void {
  const file = secretsPath(env);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 1, providers: all }, null, 2), 'utf8');
}

export function setProviderSecret(name: ProviderName, patch: { apiKey?: string; model?: string; baseURL?: string }, env: NodeJS.ProcessEnv = process.env): StoredProvider {
  const all = readSecrets(env);
  const prev = all[name] ?? { apiKey: '', updatedAt: 0 };
  const next: StoredProvider = {
    apiKey: patch.apiKey?.trim() || prev.apiKey,
    model: patch.model?.trim() || prev.model,
    baseURL: patch.baseURL?.trim() || prev.baseURL,
    updatedAt: Date.now(),
  };
  all[name] = next;
  writeSecrets(all, env);
  return next;
}

export function clearProviderSecret(name: ProviderName, env: NodeJS.ProcessEnv = process.env): void {
  const all = readSecrets(env);
  delete all[name];
  writeSecrets(all, env);
}

export function maskKey(key: string): string {
  const k = String(key || '').trim();
  if (!k) return '';
  if (k.length <= 10) return `${k.slice(0, 3)}…`;
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}

/** 基本的长度/字符校验，不做厂商前缀强校验（各家格式不同） */
export function isValidKey(key: string): boolean {
  const k = String(key || '').trim();
  return k.length >= 16 && k.length <= 400 && !/\s/.test(k);
}
