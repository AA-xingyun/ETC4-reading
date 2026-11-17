/**
 * 设置页接口：只负责「保存/清除/测试」Provider 凭据。
 * 明文 Key 只写进服务端文件，任何响应都不回传。
 */
import type { ProviderName } from '../../shared/types.js';
import type { AppConfig } from '../lib/config.js';
import { authenticate } from '../lib/auth.js';
import { clearProviderSecret, isValidKey, readSecrets, setProviderSecret } from '../lib/secrets.js';
import { chatURL, providerStatus, resolveProvider } from '../llm/provider.js';

const NAMES: ProviderName[] = ['deepseek', 'kimi', 'qwen', 'glm', 'openai'];

export interface SettingsResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function json(status: number, body: unknown): SettingsResponse {
  return { status, body, headers: { 'Content-Type': 'application/json; charset=utf-8' } };
}

function authOr(ctx: { headers: Record<string, string | undefined> }, config: AppConfig): SettingsResponse | null {
  const auth = authenticate(ctx.headers, config);
  if (auth.ok) return null;
  if (auth.code === 'UNAUTHORIZED') return json(401, { ok: false, code: 'UNAUTHORIZED' });
  return json(400, { ok: false, code: 'INVALID_PARAMS', errors: auth.errors });
}

export function listProviderSettings(config: AppConfig) {
  const stored = readSecrets();
  return NAMES.map((name) => providerStatus(name, process.env, stored));
}

export function getSettings(ctx: { headers: Record<string, string | undefined> }, config: AppConfig): SettingsResponse {
  const denied = authOr(ctx, config);
  if (denied) return denied;
  return json(200, { ok: true, providers: listProviderSettings(config) });
}

export function saveSettings(
  ctx: { headers: Record<string, string | undefined>; body: unknown },
  config: AppConfig,
): SettingsResponse {
  const denied = authOr(ctx, config);
  if (denied) return denied;
  const body = (ctx.body ?? {}) as { provider?: string; apiKey?: string; model?: string; baseURL?: string };
  const name = String(body.provider ?? '').trim() as ProviderName;
  if (!NAMES.includes(name)) return json(400, { ok: false, code: 'INVALID_PARAMS', errors: ['provider 不合法'] });

  const apiKey = body.apiKey === undefined ? undefined : String(body.apiKey).trim();
  if (apiKey !== undefined && apiKey !== '' && !isValidKey(apiKey)) {
    return json(400, { ok: false, code: 'INVALID_PARAMS', errors: ['API Key 长度或格式不合法'] });
  }
  const stored = readSecrets();
  const hasExisting = Boolean(stored[name]?.apiKey);
  if (!apiKey && !hasExisting) {
    return json(400, { ok: false, code: 'INVALID_PARAMS', errors: ['第一次配置必须提供 API Key'] });
  }

  setProviderSecret(name, { apiKey: apiKey || undefined, model: body.model, baseURL: body.baseURL });
  const view = providerStatus(name, process.env, readSecrets());
  return json(200, { ok: true, provider: view });
}

export function deleteSettings(
  ctx: { headers: Record<string, string | undefined> },
  config: AppConfig,
  name: string,
): SettingsResponse {
  const denied = authOr(ctx, config);
  if (denied) return denied;
  if (!NAMES.includes(name as ProviderName)) return json(400, { ok: false, code: 'INVALID_PARAMS', errors: ['provider 不合法'] });
  clearProviderSecret(name as ProviderName);
  return json(200, { ok: true, provider: providerStatus(name as ProviderName, process.env, readSecrets()) });
}

const lastTest = new Map<string, number>();

export async function testProvider(
  ctx: { headers: Record<string, string | undefined>; body: unknown },
  config: AppConfig,
): Promise<SettingsResponse> {
  const denied = authOr(ctx, config);
  if (denied) return denied;
  const auth = authenticate(ctx.headers, config);
  const now = Date.now();
  const prev = lastTest.get(auth.clientId) ?? 0;
  if (now - prev < 5000) return json(429, { ok: false, code: 'RATE_LIMITED', errors: ['测试太频繁，5 秒后再试'] });
  lastTest.set(auth.clientId, now);

  const body = (ctx.body ?? {}) as { provider?: string };
  const name = String(body.provider ?? '').trim() as ProviderName;
  if (!NAMES.includes(name)) return json(400, { ok: false, code: 'INVALID_PARAMS', errors: ['provider 不合法'] });

  const provider = resolveProvider(name, process.env, readSecrets());
  if (!provider) return json(400, { ok: false, code: 'NO_PROVIDER', errors: ['该 provider 还没配置 Key'] });

  // 连通性测试只看 HTTP 是否成功：模型可能回 "ok" 而不是 JSON，不能走 parseResponse
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(chatURL(provider.baseURL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 8,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    const errText = res.ok ? '' : (await res.text()).slice(0, 300);
    return json(res.ok ? 200 : 502, {
      ok: res.ok,
      provider: name,
      model: provider.model,
      latencyMs: Date.now() - started,
      error: res.ok ? undefined : `上游 ${res.status}：${errText}`,
    });
  } catch (err) {
    return json(502, {
      ok: false,
      provider: name,
      model: provider.model,
      latencyMs: Date.now() - started,
      error: (err as Error).name === 'AbortError' ? '测试超时（20s）' : (err as Error).message,
    });
  } finally {
    clearTimeout(timer);
  }
}
