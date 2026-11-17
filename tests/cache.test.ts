import { describe, expect, it } from 'vitest';
import { buildCacheInput, cacheKey, CacheService, TTL_MS } from '../server/llm/cache';
import { openStore } from '../server/lib/store';
import type { GenerateParams } from '../shared/types';

const params: GenerateParams = {
  type: 'careful_reading',
  difficulty: 'CET4',
  topic: 'work',
  targetWords: [
    { spell: 'sustain', cn: '维持' },
    { spell: 'fatigue', cn: '疲劳' },
    { spell: 'allocate', cn: '分配' },
  ],
};

describe('cache key', () => {
  it('targetWords 顺序变化不影响 key', () => {
    const a = cacheKey(buildCacheInput(params, 'deepseek', 'deepseek-chat'));
    const reversed = { ...params, targetWords: [...params.targetWords].reverse() };
    const b = cacheKey(buildCacheInput(reversed, 'deepseek', 'deepseek-chat'));
    expect(a).toBe(b);
  });

  it('换 provider 改变 key', () => {
    const a = cacheKey(buildCacheInput(params, 'deepseek', 'deepseek-chat'));
    const b = cacheKey(buildCacheInput(params, 'kimi', 'kimi-k3.1-pro'));
    expect(a).not.toBe(b);
  });

  it('promptVersion 变化后旧 key 失效', () => {
    const base = cacheKey(buildCacheInput(params, 'deepseek', 'deepseek-chat'));
    const bumped = cacheKey({ ...buildCacheInput(params, 'deepseek', 'deepseek-chat'), promptVersion: 'v-next' });
    expect(base).not.toBe(bumped);
  });

  it('topic 为 random 与空字符串等价', () => {
    const a = cacheKey(buildCacheInput({ ...params, topic: 'random' }, 'glm', 'glm-5.2'));
    const b = cacheKey(buildCacheInput({ ...params, topic: '' }, 'glm', 'glm-5.2'));
    expect(a).toBe(b);
  });
});

describe('CacheService', () => {
  it('写入后可读，过期后返回 null', async () => {
    const store = openStore('memory');
    const cache = new CacheService(store);
    const entry = {
      data: { type: 'careful_reading' } as any,
      provider: 'deepseek' as const,
      model: 'deepseek-chat',
      validation: { ok: true, errors: [], warnings: [], stats: {} } as any,
      usage: { inputTokens: 10, outputTokens: 20 },
      attempts: 1,
      createdAt: Date.now(),
    };
    await cache.put('k1', entry, 'careful_reading');
    const hit = await cache.get('k1');
    expect(hit?.model).toBe('deepseek-chat');
    expect(TTL_MS.careful_reading).toBe(7 * 24 * 3600 * 1000);
    expect(TTL_MS.paragraph_matching).toBe(14 * 24 * 3600 * 1000);

    // 直接写一条已过期的记录，get 应视为未命中
    await store.put('reading_cache', 'k2', JSON.stringify(entry), Date.now() - 1000);
    expect(await cache.get('k2')).toBeNull();
    store.close();
  });

  it('不同 type 的 key 前缀不同（避免串题）', () => {
    const a = cacheKey({ ...buildCacheInput(params, 'deepseek', 'deepseek-chat'), type: 'careful_reading' });
    const b = cacheKey({ ...buildCacheInput(params, 'deepseek', 'deepseek-chat'), type: 'paragraph_matching' });
    expect(a).not.toBe(b);
  });
});
