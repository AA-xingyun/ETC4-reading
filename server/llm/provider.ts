import type { ProviderName, StructuredOutputMode } from '../../shared/types.js';
import { maskKey, type StoredSecrets } from '../lib/secrets.js';

export interface ProviderConfig {
  name: ProviderName;
  baseURL: string;
  apiKey: string;
  model: string;
  structuredOutput: StructuredOutputMode;
  supportsStrictSchema: boolean;
  maxTokens: number;
  temperature: number;
}

export interface GenerateResult {
  ok: boolean;
  rawContent: string;
  parsed?: unknown;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
  finishReason?: string;
}

const PRESETS: Record<ProviderName, Omit<ProviderConfig, 'apiKey'>> = {
  deepseek: {
    name: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    structuredOutput: 'json_object',
    supportsStrictSchema: false,
    maxTokens: 8192,
    temperature: 0.8,
  },
  kimi: {
    name: 'kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3.1-pro',
    structuredOutput: 'json_schema',
    supportsStrictSchema: true,
    maxTokens: 8192,
    temperature: 0.6,
  },
  qwen: {
    name: 'qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
    structuredOutput: 'json_schema',
    supportsStrictSchema: true,
    maxTokens: 8192,
    temperature: 0.7,
  },
  glm: {
    name: 'glm',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.2',
    structuredOutput: 'json_object',
    supportsStrictSchema: false,
    maxTokens: 8192,
    temperature: 0.7,
  },
  openai: {
    name: 'openai',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    structuredOutput: 'json_schema',
    supportsStrictSchema: true,
    maxTokens: 8192,
    temperature: 0.7,
  },
};

const ENV_KEY: Record<ProviderName, string[]> = {
  deepseek: ['DEEPSEEK_API_KEY'],
  kimi: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  qwen: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
  glm: ['GLM_API_KEY', 'ZHIPU_API_KEY'],
  openai: ['OPENAI_API_KEY'],
};

export function normalizeBaseURL(raw: string): string {
  let url = String(raw || '').trim().replace(/\/+$/, '');
  url = url.replace(/\/chat\/completions$/i, '');
  return url;
}

export function chatURL(baseURL: string): string {
  return `${normalizeBaseURL(baseURL)}/chat/completions`;
}

function envValue(env: NodeJS.ProcessEnv, keys: string[]): string {
  for (const key of keys) {
    const v = env[key];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

export function resolveProvider(name: ProviderName, env: NodeJS.ProcessEnv = process.env, stored?: StoredSecrets): ProviderConfig | null {
  const preset = PRESETS[name];
  if (!preset) return null;
  const saved = stored?.[name];
  const apiKey = (saved?.apiKey || '').trim() || envValue(env, ENV_KEY[name]);
  if (!apiKey) return null;
  const upper = name.toUpperCase();
  return {
    ...preset,
    baseURL: saved?.baseURL?.trim() || env[`${upper}_BASE_URL`]?.trim() || preset.baseURL,
    model: saved?.model?.trim() || env[`${upper}_MODEL`]?.trim() || preset.model,
    apiKey,
    maxTokens: Number(env[`${upper}_MAX_TOKENS`] ?? preset.maxTokens) || preset.maxTokens,
    temperature: Number(env[`${upper}_TEMPERATURE`] ?? preset.temperature) || preset.temperature,
  };
}

export function listProviders(env: NodeJS.ProcessEnv = process.env, stored?: StoredSecrets): ProviderConfig[] {
  return (Object.keys(PRESETS) as ProviderName[])
    .map((name) => resolveProvider(name, env, stored))
    .filter((p): p is ProviderConfig => p !== null);
}

/** 给设置页看的视图：不含明文 Key，只给掩码与来源 */
export function providerStatus(
  name: ProviderName,
  env: NodeJS.ProcessEnv = process.env,
  stored?: StoredSecrets,
): {
  name: ProviderName;
  model: string;
  baseURL: string;
  structuredOutput: StructuredOutputMode;
  supportsStrictSchema: boolean;
  configured: boolean;
  source: 'settings' | 'env' | 'none';
  maskedKey: string;
} {
  const preset = PRESETS[name];
  const saved = stored?.[name];
  const envKey = envValue(env, ENV_KEY[name]);
  const apiKey = (saved?.apiKey || '').trim() || envKey;
  const upper = name.toUpperCase();
  return {
    name,
    model: saved?.model?.trim() || env[`${upper}_MODEL`]?.trim() || preset.model,
    baseURL: saved?.baseURL?.trim() || env[`${upper}_BASE_URL`]?.trim() || preset.baseURL,
    structuredOutput: preset.structuredOutput,
    supportsStrictSchema: preset.supportsStrictSchema,
    configured: Boolean(apiKey),
    source: saved?.apiKey?.trim() ? 'settings' : envKey ? 'env' : 'none',
    maskedKey: maskKey(apiKey),
  };
}

export interface RequestOptions {
  maxTokens?: number;
  temperature?: number;
  /** json_object 模式下写进 system 的示例；缺省则塞完整 schema */
  schemaText?: string;
}

/** 按 structuredOutput 能力构造请求体：json_schema+strict 优先，否则 json_object + 内嵌 Schema */
export function buildRequest(
  config: ProviderConfig,
  systemPrompt: string,
  userMessage: string,
  schema: unknown,
  opts: RequestOptions = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: opts.maxTokens ?? config.maxTokens,
    temperature: opts.temperature ?? config.temperature,
    stream: false,
  };

  if (config.structuredOutput === 'json_schema' && config.supportsStrictSchema) {
    return {
      ...base,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'reading_passage', strict: true, schema },
      },
    };
  }

  // json_object 模式：DeepSeek 要求 system 里出现 "json"，且必须把完整 Schema 示例塞进去
  const withSchema = `${systemPrompt}\n\n必须输出 json。JSON Schema 示例（精简版，字段完整）：\n${opts.schemaText ?? JSON.stringify(schema, null, 2)}`;
  return {
    ...base,
    messages: [
      { role: 'system', content: withSchema },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
  };
}

function stripCodeFence(text: string): string {
  return String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
}

export function parseResponse(payload: any, finishReason?: string): GenerateResult {
  const content = payload?.choices?.[0]?.message?.content;
  const raw = typeof content === 'string' ? content : '';
  const usage = normalizeUsage(payload?.usage);
  const reason = finishReason ?? payload?.choices?.[0]?.finish_reason;

  if (!raw.trim()) {
    return {
      ok: false,
      rawContent: raw,
      usage,
      finishReason: reason,
      error: '模型返回空内容，可能是 JSON 解析失败被替换，建议重试',
    };
  }
  if (reason === 'length') {
    return { ok: false, rawContent: raw, usage, finishReason: reason, error: '输出被 max_tokens 截断，请压缩解析长度后重试' };
  }
  const cleaned = stripCodeFence(raw);
  try {
    return { ok: true, rawContent: raw, parsed: JSON.parse(cleaned), usage, finishReason: reason };
  } catch (err) {
    return { ok: false, rawContent: raw, usage, finishReason: reason, error: `JSON 解析失败：${(err as Error).message}` };
  }
}

export function normalizeUsage(usage: any): { inputTokens: number; outputTokens: number } | undefined {
  if (!usage) return undefined;
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  return { inputTokens: input, outputTokens: output };
}

export interface CallOptions {
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 调用模型；429/5xx 退避重试（HTTP 级），与业务层的「反馈重试」分开计数 */
export async function callProvider(
  config: ProviderConfig,
  body: unknown,
  opts: CallOptions = {},
): Promise<GenerateResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? defaultSleep;
  let last: GenerateResult = { ok: false, rawContent: '', error: '未发起请求' };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(chatURL(config.baseURL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        last = { ok: false, rawContent: text.slice(0, 2000), error: `上游 ${res.status}` };
        if (attempt < retries) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        return { ok: false, rawContent: last.rawContent, error: `上游连续失败：${res.status}` };
      }
      if (!res.ok) {
        return { ok: false, rawContent: text.slice(0, 2000), error: `上游返回 ${res.status}：${text.slice(0, 300)}` };
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        return { ok: false, rawContent: text.slice(0, 4000), error: `上游响应不是 JSON：${(err as Error).message}` };
      }
      return parseResponse(payload);
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError';
      last = { ok: false, rawContent: '', error: aborted ? '请求超时（90s）' : `请求失败：${(err as Error).message}` };
      if (!aborted && attempt < retries) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      return last;
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

export function providerPublicInfo(config: ProviderConfig) {
  return {
    name: config.name,
    model: config.model,
    structuredOutput: config.structuredOutput,
    supportsStrictSchema: config.supportsStrictSchema,
    maxTokens: config.maxTokens,
  };
}
