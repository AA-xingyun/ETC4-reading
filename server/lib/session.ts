import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  clientId: string;
  exp: number;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** 浏览器拿到的短期会话令牌：绑定 clientId，默认 1 小时 */
export function issueSession(clientId: string, secret: string, ttlMs = 3600_000): { token: string; expiresAt: number } {
  const exp = Date.now() + ttlMs;
  const payload = Buffer.from(JSON.stringify({ clientId, exp }), 'utf8').toString('base64url');
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt: exp };
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionPayload;
    if (!data.clientId || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
