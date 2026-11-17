import type { AppConfig } from './config.js';
import { verifySession } from './session.js';

export interface AuthResult {
  ok: boolean;
  clientId: string;
  code?: 'UNAUTHORIZED' | 'INVALID_PARAMS';
  errors?: string[];
}

/** 令牌 + X-Client-Id 校验；generate 与 settings 共用 */
export function authenticate(headers: Record<string, string | undefined>, config: AppConfig): AuthResult {
  const auth = String(headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const session = auth ? verifySession(auth, config.sessionSecret) : null;
  const tokenOk = Boolean(config.apiAccessToken) && auth === config.apiAccessToken;
  if (!session && !tokenOk) return { ok: false, clientId: '', code: 'UNAUTHORIZED' };

  const clientId = String(headers['x-client-id'] ?? '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) {
    return { ok: false, clientId: '', code: 'INVALID_PARAMS', errors: ['缺少或非法的 X-Client-Id'] };
  }
  // 会话令牌绑定 clientId，防止拿自己的令牌冒充别人的配额
  if (session && session.clientId !== clientId) {
    return { ok: false, clientId: '', code: 'INVALID_PARAMS', errors: ['X-Client-Id 与令牌不匹配'] };
  }
  return { ok: true, clientId };
}
