import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteSettings, getSettings, saveSettings, testProvider } from '../server/api/settings';
import { loadConfig } from '../server/lib/config';
import { issueSession } from '../server/lib/session';
import { resolveProvider } from '../server/llm/provider';
import { readSecrets } from '../server/lib/secrets';

const CLIENT = 'client-settings1';
let dir: string;
let config: ReturnType<typeof loadConfig>;
let token: string;

const headers = () => ({ authorization: `Bearer ${token}`, 'x-client-id': CLIENT });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reading-ai-'));
  process.env.PROVIDERS_DB_PATH = join(dir, 'providers.json');
  delete process.env.DEEPSEEK_API_KEY;
  config = loadConfig({ CACHE_DRIVER: 'memory', SESSION_SECRET: 's' } as unknown as NodeJS.ProcessEnv);
  token = issueSession(CLIENT, config.sessionSecret).token;
});

afterEach(() => {
  delete process.env.PROVIDERS_DB_PATH;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('设置页 Provider 凭据', () => {
  it('未登录不能读写设置', () => {
    const out = getSettings({ headers: { ...headers(), authorization: '' } }, config);
    expect(out.status).toBe(401);
    expect((out.body as any).code).toBe('UNAUTHORIZED');
  });

  it('过短的 Key 被拒绝', () => {
    const out = saveSettings({ headers: headers(), body: { provider: 'deepseek', apiKey: 'sk-short' } }, config);
    expect(out.status).toBe(400);
    expect((out.body as any).errors.join('')).toMatch(/长度或格式/);
  });

  it('保存后只回传掩码，明文 Key 不出现在任何响应里', () => {
    const key = 'sk-settings-test-1234567890abcdef';
    const saved = saveSettings({ headers: headers(), body: { provider: 'deepseek', apiKey: key } }, config);
    expect(saved.status).toBe(200);
    const bodyText = JSON.stringify(saved.body);
    expect(bodyText).not.toContain(key);
    expect(bodyText).toContain('sk-set');

    const listed = getSettings({ headers: headers() }, config);
    const text = JSON.stringify(listed.body);
    expect(text).not.toContain(key);
    const deepseek = (listed.body as any).providers.find((p: any) => p.name === 'deepseek');
    expect(deepseek.configured).toBe(true);
    expect(deepseek.source).toBe('settings');
    expect(deepseek.maskedKey).toBe('sk-set…cdef');
    // 落盘的是完整 Key（服务端自己用），但接口不会返回
    expect(readSecrets().deepseek?.apiKey).toBe(key);
  });

  it('清除后回到未配置', () => {
    saveSettings({ headers: headers(), body: { provider: 'deepseek', apiKey: 'sk-settings-test-1234567890abcdef' } }, config);
    const out = deleteSettings({ headers: headers() }, config, 'deepseek');
    expect(out.status).toBe(200);
    const deepseek = (out.body as any).provider;
    expect(deepseek.configured).toBe(false);
    expect(deepseek.source).toBe('none');
  });

  it('设置页保存的 Key 优先于环境变量', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-env-key-0000000000000000';
    const fromEnv = resolveProvider('deepseek', process.env, {});
    expect(fromEnv?.apiKey).toBe('sk-env-key-0000000000000000');

    saveSettings({ headers: headers(), body: { provider: 'deepseek', apiKey: 'sk-settings-wins-1234567890ab' } }, config);
    const fromSettings = resolveProvider('deepseek', process.env, readSecrets());
    expect(fromSettings?.apiKey).toBe('sk-settings-wins-1234567890ab');
  });

  it('没有配置 Key 时测试连接返回 NO_PROVIDER', async () => {
    const out = await testProvider({ headers: headers(), body: { provider: 'deepseek' } }, config);
    expect(out.status).toBe(400);
    expect((out.body as any).code).toBe('NO_PROVIDER');
  });

  it('测试连接有 5 秒节流', async () => {
    saveSettings({ headers: headers(), body: { provider: 'deepseek', apiKey: 'sk-settings-test-1234567890abcdef' } }, config);
    const otherClient = 'client-throttle2';
    const otherToken = issueSession(otherClient, config.sessionSecret).token;
    const ctx = { headers: { authorization: `Bearer ${otherToken}`, 'x-client-id': otherClient }, body: { provider: 'deepseek' } };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const first = await testProvider(ctx, config);
      expect(first.status).toBe(200);
      expect((first.body as any).ok).toBe(true);
      const second = await testProvider(ctx, config);
      expect(second.status).toBe(429);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
