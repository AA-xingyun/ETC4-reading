import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateReading, listQueue } from '../server/api/generate-reading';
import { loadConfig } from '../server/lib/config';
import { openStore, type Store } from '../server/lib/store';
import { issueSession } from '../server/lib/session';
import type { GenerateResult } from '../server/llm/provider';
import { carefulFixture, carefulParams } from './fixtures';

const CLIENT = 'client-abc12345';
let store: Store;
let config: ReturnType<typeof loadConfig>;
let token: string;

function ctx(body: unknown, headers: Record<string, string> = {}) {
  return {
    body,
    headers: { authorization: `Bearer ${token}`, 'x-client-id': CLIENT, ...headers },
    ip: '127.0.0.1',
  };
}

function requestBody(overrides: Record<string, unknown> = {}) {
  const p = carefulParams();
  return { type: p.type, targetWords: p.targetWords, difficulty: p.difficulty, topic: p.topic, ...overrides };
}

const okResult = (): GenerateResult => ({ ok: true, rawContent: '{}', parsed: carefulFixture(), usage: { inputTokens: 10, outputTokens: 20 } });
const badResult = (): GenerateResult => ({ ok: true, rawContent: '{}', parsed: { type: 'careful_reading' }, usage: { inputTokens: 5, outputTokens: 5 } });

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  config = loadConfig({ CACHE_DRIVER: 'memory', PER_CLIENT_DAILY: '5', MIN_INTERVAL_MS: '0', SESSION_SECRET: 'test-secret' } as unknown as NodeJS.ProcessEnv);
  store = openStore('memory');
  token = issueSession(CLIENT, config.sessionSecret).token;
});

afterEach(() => {
  delete process.env.DEEPSEEK_API_KEY;
  store.close();
});

describe('POST /api/generate-reading', () => {
  it('没有令牌返回 401', async () => {
    const out = await generateReading(ctx(requestBody(), { authorization: '' }), { store, config, callLLM: async () => okResult() });
    expect(out.status).toBe(401);
    expect((out.body as any).code).toBe('UNAUTHORIZED');
  });

  it('缺少 X-Client-Id 返回 400', async () => {
    const out = await generateReading(ctx(requestBody(), { 'x-client-id': '' }), { store, config, callLLM: async () => okResult() });
    expect(out.status).toBe(400);
    expect((out.body as any).code).toBe('INVALID_PARAMS');
  });

  it('成功生成后入待发布队列，且带响应头', async () => {
    let calls = 0;
    const out = await generateReading(ctx(requestBody()), { store, config, callLLM: async () => { calls += 1; return okResult(); } });
    expect(calls).toBe(1);
    expect(out.status).toBe(200);
    const body = out.body as any;
    expect(body.ok).toBe(true);
    expect(body.data.title).toBe('The Rhythm of Attention');
    expect(body.meta.cached).toBe(false);
    expect(out.headers['X-Provider']).toBe('deepseek');
    expect(out.headers['X-Cache']).toBe('MISS');
    const queue = await listQueue(store);
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe('pending');
  });

  it('相同参数第二次命中缓存，不再调用模型', async () => {
    let calls = 0;
    const fake = async () => { calls += 1; return okResult(); };
    await generateReading(ctx(requestBody()), { store, config, callLLM: fake });
    const second = await generateReading(ctx(requestBody()), { store, config, callLLM: fake });
    expect(calls).toBe(1);
    expect(second.status).toBe(200);
    expect((second.body as any).meta.cached).toBe(true);
    expect(second.headers['X-Cache']).toBe('HIT');
  });

  it('两次校验都失败返回 422，且不写队列', async () => {
    let calls = 0;
    const out = await generateReading(ctx(requestBody()), { store, config, callLLM: async () => { calls += 1; return badResult(); } });
    expect(calls).toBe(2);
    expect(out.status).toBe(422);
    const body = out.body as any;
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors.length).toBeGreaterThan(0);
    expect(await listQueue(store)).toHaveLength(0);
  });

  it('第一次不合格、第二次通过（带反馈重试）', async () => {
    let calls = 0;
    const out = await generateReading(ctx(requestBody()), {
      store, config,
      callLLM: async () => { calls += 1; return calls === 1 ? badResult() : okResult(); },
    });
    expect(calls).toBe(2);
    expect(out.status).toBe(200);
    expect((out.body as any).meta.attempt).toBe(2);
  });

  it('未配置 Provider 返回 503', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const out = await generateReading(ctx(requestBody()), { store, config, callLLM: async () => okResult() });
    expect(out.status).toBe(503);
    expect((out.body as any).code).toBe('NO_PROVIDER');
  });

  it('参数不合法返回 400', async () => {
    const out = await generateReading(ctx(requestBody({ type: 'essay' })), { store, config, callLLM: async () => okResult() });
    expect(out.status).toBe(400);
    expect((out.body as any).errors.join('')).toMatch(/type/);
  });
});
