import type { GenerateParams, GenerateMeta, Passage, ProviderName, QueueItem, ValidationReport } from '../../shared/types.js';
import type { AppConfig } from '../lib/config.js';
import type { Store } from '../lib/store.js';
import { addTokens, checkRate } from '../lib/rate-limit.js';
import { authenticate } from '../lib/auth.js';
import { buildCacheInput, cacheKey, CacheService } from '../llm/cache.js';
import { buildRequest, callProvider, listProviders, providerPublicInfo, resolveProvider } from '../llm/provider.js';
import { buildRetryMessage, buildSystemPrompt, buildUserMessage, compactExample, READING_SCHEMA } from '../llm/prompts.js';
import { BASIC_WORDS, validatePassage } from '../llm/validate.js';
import { readSecrets } from '../lib/secrets.js';

export interface ApiResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface RequestContext {
  body: unknown;
  headers: Record<string, string | undefined>;
  ip: string;
}

const TYPES = ['careful_reading', 'paragraph_matching'];

function headersWith(base: Record<string, string>, meta?: GenerateMeta, rate?: { limit: number; remaining: number; resetInSec: number }): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', ...base };
  if (meta) {
    headers['X-Provider'] = meta.provider;
    headers['X-Cache'] = meta.cached ? 'HIT' : 'MISS';
  }
  if (rate) {
    headers['RateLimit-Limit'] = String(rate.limit);
    headers['RateLimit-Remaining'] = String(rate.remaining);
    headers['RateLimit-Reset'] = String(rate.resetInSec);
  }
  return headers;
}

function fail(status: number, code: string, extra: Record<string, unknown> = {}): ApiResponse {
  return { status, body: { ok: false, code, ...extra }, headers: headersWith({}) };
}

function parseParams(body: unknown): { ok: true; params: GenerateParams } | { ok: false; errors: string[] } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (!TYPES.includes(String(raw.type))) errors.push('type 必须是 careful_reading 或 paragraph_matching');
  const words = Array.isArray(raw.targetWords) ? raw.targetWords : null;
  if (!words) errors.push('targetWords 必须是数组');
  else if (words.length < 1 || words.length > 30) errors.push('targetWords 需要 1–30 个');
  const parsedWords = (words ?? []).map((w: any) => ({ spell: String(w?.spell ?? '').trim(), cn: String(w?.cn ?? '').trim() }));
  if (parsedWords.some((w) => !w.spell || !/^[a-zA-Z][a-zA-Z' -]*$/.test(w.spell))) errors.push('targetWords 里有不合法的 spell');
  if (!['CET4', 'CET6', '考研'].includes(String(raw.difficulty))) errors.push('difficulty 必须是 CET4 / CET6 / 考研');
  const topic = typeof raw.topic === 'string' && raw.topic.trim() ? raw.topic.trim() : 'random';
  const provider = typeof raw.provider === 'string' ? (raw.provider.trim() as ProviderName) : undefined;
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    params: { type: raw.type as GenerateParams['type'], targetWords: parsedWords, difficulty: raw.difficulty as GenerateParams['difficulty'], topic, provider },
  };
}

export async function generateReading(
  ctx: RequestContext,
  deps: { store: Store; config: AppConfig; callLLM?: typeof callProvider },
): Promise<ApiResponse> {
  const { store, config } = deps;
  const cache = new CacheService(store);
  const auth = authenticate(ctx.headers, config);
  if (!auth.ok) {
    if (auth.code === 'UNAUTHORIZED') {
      return { status: 401, body: { ok: false, code: 'UNAUTHORIZED' }, headers: headersWith({}) };
    }
    return fail(400, 'INVALID_PARAMS', { errors: auth.errors ?? [] });
  }
  const clientId = auth.clientId;

  const parsed = parseParams(ctx.body);
  if (!parsed.ok) return fail(400, 'INVALID_PARAMS', { errors: parsed.errors });
  const params = parsed.params;

  const available = listProviders(process.env, readSecrets());
  if (!available.length) return fail(503, 'NO_PROVIDER');
  const provider = (params.provider && available.find((p) => p.name === params.provider)) || available[0];
  if (params.provider && !available.some((p) => p.name === params.provider)) {
    return fail(400, 'INVALID_PARAMS', { errors: [`provider ${params.provider} 未配置`] });
  }

  // 缓存先于限流：命中缓存不消耗额度
  const key = buildCacheInput(params, provider.name, provider.model);
  const keyHash = cacheKey(key);
  const cached = await cache.get(keyHash);
  if (cached) {
    const meta: GenerateMeta = {
      provider: cached.provider,
      cached: true,
      attempt: cached.attempts,
      usage: cached.usage,
      validation: cached.validation,
    };
    return {
      status: 200,
      body: { ok: true, data: cached.data, meta },
      headers: headersWith({}, meta, {
        limit: config.perClientDaily,
        remaining: config.perClientDaily,
        resetInSec: 0,
      }),
    };
  }

  const rate = await checkRate(store, { clientId, ip: ctx.ip, config });
  if (!rate.allowed) {
    return {
      status: 429,
      body: { ok: false, code: 'RATE_LIMITED', errors: [rate.reason ?? '请求过于频繁'], meta: { retryAfterSec: rate.retryAfterSec } },
      headers: headersWith({}, undefined, { limit: rate.limit, remaining: rate.remaining, resetInSec: rate.retryAfterSec }),
    };
  }

  const targets = params.targetWords.map((w) => w.spell);
  const vocabCandidates = targets.filter((w) => !BASIC_WORDS.has(w.toLowerCase()));
  const systemPrompt = buildSystemPrompt(params.type, targets, vocabCandidates);
  const userMessage = buildUserMessage(params);
  const maxTokens = params.type === 'paragraph_matching' ? 8192 : 6000;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let lastErrors: string[] = [];
  let lastValidation: ValidationReport | null = null;
  let attempt = 0;

  for (let i = 0; i < 2; i += 1) {
    attempt = i + 1;
    const messages = i === 0 ? userMessage : buildRetryMessage(lastErrors);
    const body = buildRequest(provider, systemPrompt, messages, READING_SCHEMA, { maxTokens, schemaText: compactExample(params.type) });
    const result = await (deps.callLLM ?? callProvider)(provider, body);
    if (result.usage) {
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
    }
    if (!result.ok || !result.parsed) {
      lastErrors = [result.error ?? '模型返回无法解析'];
      continue;
    }
    // 元数据以请求为准：模型偶尔会把 difficulty/topic 写错（实测 CET4 被写成 CET-6）
    const parsedPassage = result.parsed as Passage;
    parsedPassage.type = params.type;
    parsedPassage.difficulty = params.difficulty;
    if (!parsedPassage.topic || parsedPassage.topic === 'random') parsedPassage.topic = params.topic;
    const validation = validatePassage(parsedPassage, params);
    lastValidation = validation;
    if (!validation.ok) {
      lastErrors = validation.errors;
      continue;
    }
    // 只有校验通过才写缓存与队列
    const entry = {
      data: parsedPassage,
      provider: provider.name,
      model: provider.model,
      validation,
      usage,
      attempts: attempt,
      createdAt: Date.now(),
    };
    await cache.put(keyHash, entry, params.type);
    await enqueue(store, keyHash, entry, params);
    await addTokens(store, usage.inputTokens + usage.outputTokens);
    const meta: GenerateMeta = { provider: provider.name, cached: false, attempt, usage, validation };
    return {
      status: 200,
      body: { ok: true, data: entry.data, meta },
      headers: headersWith({}, meta, { limit: rate.limit, remaining: rate.remaining, resetInSec: rate.retryAfterSec }),
    };
  }

  // 兜底模型：Kimi 的角色收归 DeepSeek 后，默认不换模型（由上面的反馈重试承担）；
  // 需要真正换模型时用 FALLBACK_PROVIDER 指定。
  const fallbackName = (config.fallbackProvider || '') as ProviderName | '';
  if (fallbackName && fallbackName !== provider.name) {
    const fallback = available.find((p) => p.name === fallbackName);
    if (fallback) {
      const body = buildRequest(fallback, systemPrompt, buildRetryMessage(lastErrors), READING_SCHEMA, { maxTokens, schemaText: compactExample(params.type) });
      const result = await (deps.callLLM ?? callProvider)(fallback, body);
      if (result.usage) {
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
      }
      if (result.ok && result.parsed) {
        const passage = result.parsed as Passage;
        passage.type = params.type;
        passage.difficulty = params.difficulty;
        if (!passage.topic || passage.topic === 'random') passage.topic = params.topic;
        const validation = validatePassage(passage, params);
        if (validation.ok) {
          const entry = {
            data: passage,
            provider: fallback.name,
            model: fallback.model,
            validation,
            usage,
            attempts: attempt + 1,
            createdAt: Date.now(),
          };
          await cache.put(keyHash, entry, params.type);
          await enqueue(store, keyHash, entry, params);
          await addTokens(store, usage.inputTokens + usage.outputTokens);
          const meta: GenerateMeta = { provider: fallback.name, cached: false, attempt: attempt + 1, usage, validation };
          return {
            status: 200,
            body: { ok: true, data: entry.data, meta },
            headers: headersWith({}, meta, { limit: rate.limit, remaining: rate.remaining, resetInSec: rate.retryAfterSec }),
          };
        }
        lastErrors = validation.errors;
      } else {
        lastErrors = [result.error ?? '兜底模型返回无法解析'];
      }
    }
  }

  await addTokens(store, usage.inputTokens + usage.outputTokens);
  return {
    status: 422,
    body: {
      ok: false,
      code: 'VALIDATION_FAILED',
      errors: lastErrors,
      meta: { provider: provider.name, attempt, validation: lastValidation },
    },
    headers: headersWith({}, { provider: provider.name, cached: false, attempt, usage, validation: lastValidation ?? ({} as ValidationReport) }, {
      limit: rate.limit,
      remaining: rate.remaining,
      resetInSec: rate.retryAfterSec,
    }),
  };
}

async function enqueue(
  store: Store,
  cacheKeyValue: string,
  entry: { data: Passage; provider: ProviderName; validation: ValidationReport; usage: { inputTokens: number; outputTokens: number } },
  params: GenerateParams,
): Promise<void> {
  const existing = await listQueue(store);
  if (existing.some((q) => q.cacheKey === cacheKeyValue)) return;
  const item: QueueItem & { cacheKey: string } = {
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    cacheKey: cacheKeyValue,
    status: 'pending',
    provider: entry.provider,
    params,
    data: entry.data,
    validation: entry.validation,
    usage: entry.usage,
    createdAt: Date.now(),
  };
  await store.put('reading_queue', item.id, JSON.stringify(item));
}

export async function listQueue(store: Store): Promise<(QueueItem & { cacheKey?: string })[]> {
  const rows = await store.list('reading_queue');
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.value) as QueueItem & { cacheKey?: string };
      } catch {
        return null;
      }
    })
    .filter((x): x is QueueItem & { cacheKey?: string } => x !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function publishQueueItem(store: Store, id: string): Promise<boolean> {
  const raw = await store.get('reading_queue', id);
  if (!raw) return false;
  const item = JSON.parse(raw) as QueueItem;
  item.status = 'published';
  item.publishedAt = Date.now();
  await store.put('reading_queue', id, JSON.stringify(item));
  return true;
}

export async function deleteQueueItem(store: Store, id: string): Promise<boolean> {
  if (!(await store.get('reading_queue', id))) return false;
  await store.del('reading_queue', id);
  return true;
}

export function providersPayload() {
  return listProviders(process.env, readSecrets()).map(providerPublicInfo);
}
