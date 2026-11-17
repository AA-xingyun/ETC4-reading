import type { GenerateMeta, Passage, ProviderName, ValidationReport } from '@shared/types';

export interface GenerateResponse {
  ok: boolean;
  data?: Passage;
  meta?: GenerateMeta;
  code?: string;
  errors?: string[];
  cached?: boolean;
}

export interface ClientSession {
  token: string;
  expiresAt: number;
}

const CLIENT_KEY = 'reading-ai.client-id';
const SESSION_KEY = 'reading-ai.session';

export function clientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

export async function ensureSession(): Promise<ClientSession> {
  const raw = localStorage.getItem(SESSION_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ClientSession;
      if (parsed.token && parsed.expiresAt > Date.now() + 30_000) return parsed;
    } catch {
      /* 失效则重新申请 */
    }
  }
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: clientId() }),
  });
  if (!res.ok) throw new Error(`会话申请失败：${res.status}`);
  const data = (await res.json()) as ClientSession & { ok: boolean };
  const session = { token: data.token, expiresAt: data.expiresAt };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export interface GenerateArgs {
  type: string;
  targetWords: { spell: string; cn: string }[];
  difficulty: string;
  topic: string;
  provider?: ProviderName;
  signal?: AbortSignal;
}

export async function generateReading(args: GenerateArgs): Promise<GenerateResponse> {
  let session = await ensureSession();
  const res = await fetch('/api/generate-reading', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
      'X-Client-Id': clientId(),
    },
    body: JSON.stringify({
      type: args.type,
      targetWords: args.targetWords,
      difficulty: args.difficulty,
      topic: args.topic,
      provider: args.provider,
    }),
    signal: args.signal,
  });
  // 服务端换了会话密钥（或重启）时，清掉本地 token 重试一次
  if (res.status === 401) {
    localStorage.removeItem(SESSION_KEY);
    session = await ensureSession();
    return generateReading(args);
  }
  const meta = {
    remaining: res.headers.get('RateLimit-Remaining'),
    limit: res.headers.get('RateLimit-Limit'),
    provider: res.headers.get('X-Provider'),
    cache: res.headers.get('X-Cache'),
  };
  const body = (await res.json()) as GenerateResponse & { code?: string; errors?: string[] };
  if (!res.ok) {
    return { ok: false, code: body.code ?? `HTTP_${res.status}`, errors: body.errors ?? [], ...(body as object) };
  }
  return { ...body, ok: true };
}

export interface ProviderInfo {
  name: ProviderName;
  model: string;
  structuredOutput: string;
  supportsStrictSchema: boolean;
}

async function authedHeaders(): Promise<Record<string, string>> {
  const session = await ensureSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.token}`,
    'X-Client-Id': clientId(),
  };
}

export interface ProviderSetting {
  name: ProviderName;
  model: string;
  baseURL: string;
  structuredOutput: string;
  supportsStrictSchema: boolean;
  configured: boolean;
  source: 'settings' | 'env' | 'none';
  maskedKey: string;
}

export async function fetchSettings(): Promise<ProviderSetting[]> {
  const res = await fetch('/api/settings', { headers: await authedHeaders() });
  if (!res.ok) throw new Error(`读取设置失败：${res.status}`);
  const body = (await res.json()) as { providers: ProviderSetting[] };
  return body.providers ?? [];
}

export async function saveProviderKey(input: {
  provider: ProviderName;
  apiKey?: string;
  model?: string;
  baseURL?: string;
}): Promise<{ ok: boolean; errors?: string[]; provider?: ProviderSetting }> {
  const res = await fetch('/api/settings', { method: 'POST', headers: await authedHeaders(), body: JSON.stringify(input) });
  return (await res.json()) as { ok: boolean; errors?: string[]; provider?: ProviderSetting };
}

export async function clearProviderKey(provider: ProviderName): Promise<boolean> {
  const res = await fetch(`/api/settings/${encodeURIComponent(provider)}`, { method: 'DELETE', headers: await authedHeaders() });
  return res.ok;
}

export async function testProviderConnection(provider: ProviderName): Promise<{ ok: boolean; latencyMs?: number; error?: string; errors?: string[] }> {
  const res = await fetch('/api/settings/test', { method: 'POST', headers: await authedHeaders(), body: JSON.stringify({ provider }) });
  return (await res.json()) as { ok: boolean; latencyMs?: number; error?: string; errors?: string[] };
}
export async function fetchProviders(): Promise<{ providers: ProviderInfo[]; cache: string; promptVersion: string }> {
  const res = await fetch('/api/providers');
  if (!res.ok) throw new Error(`读取 provider 失败：${res.status}`);
  return res.json();
}

export interface QueueRow {
  id: string;
  status: 'pending' | 'published';
  provider: string;
  data: Passage;
  validation: ValidationReport;
  createdAt: number;
}

export async function fetchQueue(): Promise<QueueRow[]> {
  const res = await fetch('/api/queue');
  if (!res.ok) return [];
  const body = (await res.json()) as { items: QueueRow[] };
  return body.items ?? [];
}

export async function publishItem(id: string): Promise<boolean> {
  const res = await fetch(`/api/queue/${encodeURIComponent(id)}/publish`, { method: 'POST' });
  return res.ok;
}

export async function deleteItem(id: string): Promise<boolean> {
  const res = await fetch(`/api/queue/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.ok;
}
