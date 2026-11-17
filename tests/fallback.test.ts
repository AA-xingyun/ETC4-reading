import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateReading, listQueue } from '../server/api/generate-reading';
import { loadConfig } from '../server/lib/config';
import { openStore, type Store } from '../server/lib/store';
import { issueSession } from '../server/lib/session';
import type { GenerateResult, ProviderConfig } from '../server/llm/provider';
import { carefulFixture, carefulParams } from './fixtures';

const CLIENT = 'client-fallback1';
let store: Store;
let config: ReturnType<typeof loadConfig>;
let token: string;

function body() {
  const p = carefulParams();
  return { type: p.type, targetWords: p.targetWords, difficulty: p.difficulty, topic: p.topic };
}

function ctx() {
  return { body: body(), headers: { authorization: `Bearer ${token}`, 'x-client-id': CLIENT }, ip: '127.0.0.1' };
}

const ok = (): GenerateResult => ({ ok: true, rawContent: '{}', parsed: carefulFixture(), usage: { inputTokens: 1, outputTokens: 2 } });
const bad = (): GenerateResult => ({ ok: true, rawContent: '{}', parsed: { type: 'careful_reading' }, usage: { inputTokens: 1, outputTokens: 1 } });

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  process.env.KIMI_API_KEY = 'sk-test-kimi';
  config = loadConfig({ CACHE_DRIVER: 'memory', MIN_INTERVAL_MS: '0', SESSION_SECRET: 's' } as unknown as NodeJS.ProcessEnv);
  store = openStore('memory');
  token = issueSession(CLIENT, config.sessionSecret).token;
});

afterEach(() => {
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.KIMI_API_KEY;
  store.close();
});

describe('兜底 provider', () => {
  it('未配置 FALLBACK_PROVIDER 时只重试主模型，两次失败即 422', async () => {
    let calls = 0;
    const out = await generateReading(ctx(), {
      store,
      config,
      callLLM: async () => { calls += 1; return bad(); },
    });
    expect(calls).toBe(2);
    expect(out.status).toBe(422);
    expect(await listQueue(store)).toHaveLength(0);
  });

  it('配置 FALLBACK_PROVIDER 后，主模型两次失败会转给兜底模型', async () => {
    config = { ...config, fallbackProvider: 'kimi' };
    const seen: string[] = [];
    const out = await generateReading(ctx(), {
      store,
      config,
      callLLM: async (provider: ProviderConfig) => {
        seen.push(provider.name);
        return provider.name === 'kimi' ? ok() : bad();
      },
    });
    expect(seen).toEqual(['deepseek', 'deepseek', 'kimi']);
    expect(out.status).toBe(200);
    expect((out.body as any).meta.provider).toBe('kimi');
    expect((out.body as any).meta.attempt).toBe(3);
    expect((out.body as any).meta.cached).toBe(false);
    expect(await listQueue(store)).toHaveLength(1);
  });

  it('兜底模型是同一个 provider 时不会额外调用', async () => {
    config = { ...config, fallbackProvider: 'deepseek' };
    let calls = 0;
    const out = await generateReading(ctx(), { store, config, callLLM: async () => { calls += 1; return bad(); } });
    expect(calls).toBe(2);
    expect(out.status).toBe(422);
  });

  it('没有配置兜底 provider 的 key 时，FALLBACK_PROVIDER 被忽略', async () => {
    delete process.env.KIMI_API_KEY;
    config = { ...config, fallbackProvider: 'kimi' };
    let calls = 0;
    const out = await generateReading(ctx(), { store, config, callLLM: async () => { calls += 1; return bad(); } });
    expect(calls).toBe(2);
    expect(out.status).toBe(422);
  });
});
