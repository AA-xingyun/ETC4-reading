import { createHash } from 'node:crypto';
import type { GenerateParams, Passage, ProviderName, ValidationReport } from '../../shared/types.js';
import type { Store } from '../lib/store.js';
import { PROMPT_VERSION } from './prompts.js';

/** 校验规则改版时递增，旧缓存自动失效 */
export const VALIDATOR_VERSION = 'v1';

export const TTL_MS: Record<string, number> = {
  careful_reading: 7 * 24 * 3600 * 1000,
  paragraph_matching: 14 * 24 * 3600 * 1000,
};

export interface CacheKeyInput {
  type: string;
  targetWords: { spell: string }[];
  difficulty: string;
  topic: string;
  provider: string;
  model: string;
  promptVersion?: string;
  validatorVersion?: string;
}

export function cacheKey(input: CacheKeyInput): string {
  const words = input.targetWords
    .map((w) => w.spell.trim().toLowerCase())
    .sort()
    .join('|');
  const raw = [
    input.type,
    words,
    input.difficulty,
    input.topic || 'random',
    input.provider,
    input.model,
    input.promptVersion ?? PROMPT_VERSION,
    input.validatorVersion ?? VALIDATOR_VERSION,
  ].join('::');
  return createHash('sha256').update(raw).digest('hex');
}

export interface CacheEntry {
  data: Passage;
  provider: ProviderName;
  model: string;
  validation: ValidationReport;
  usage: { inputTokens: number; outputTokens: number };
  attempts: number;
  createdAt: number;
}

export class CacheService {
  constructor(private store: Store) {}

  async get(key: string): Promise<CacheEntry | null> {
    const raw = await this.store.get('reading_cache', key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CacheEntry;
    } catch {
      await this.store.del('reading_cache', key);
      return null;
    }
  }

  async put(key: string, entry: CacheEntry, type: string): Promise<void> {
    const ttl = TTL_MS[type] ?? TTL_MS.careful_reading;
    await this.store.put('reading_cache', key, JSON.stringify(entry), Date.now() + ttl);
    // 按概率顺手清理，避免每次写入都全表扫
    if (Math.random() < 0.02) await this.store.cleanExpired('reading_cache');
  }

  async cleanup(): Promise<void> {
    await this.store.cleanExpired('reading_cache');
  }
}

export function buildCacheInput(params: GenerateParams, provider: ProviderName, model: string): CacheKeyInput {
  return {
    type: params.type,
    targetWords: params.targetWords,
    difficulty: params.difficulty,
    topic: params.topic || 'random',
    provider,
    model,
  };
}
