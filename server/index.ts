import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { loadConfig, loadDotEnv } from './lib/config.js';
import { openStore } from './lib/store.js';
import { issueSession } from './lib/session.js';
import {
  deleteQueueItem,
  generateReading,
  listQueue,
  providersPayload,
  publishQueueItem,
} from './api/generate-reading.js';
import { deleteSettings, getSettings, saveSettings, testProvider } from './api/settings.js';

loadDotEnv();
const config = loadConfig();
const store = openStore(config.cacheDriver, config.sqlitePath);
const DIST = resolve(process.cwd(), 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function send(res: import('node:http').ServerResponse, status: number, body: unknown, headers: Record<string, string>) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, headers);
  res.end(payload);
}

async function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

async function serveStatic(pathname: string, res: import('node:http').ServerResponse): Promise<boolean> {
  const safe = pathname === '/' ? '/index.html' : pathname;
  const file = join(DIST, safe.replace(/\.\./g, ''));
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const headers = req.headers as Record<string, string | undefined>;

  try {
    if (req.method === 'GET' && url.pathname === '/api/providers') {
      return send(res, 200, {
        ok: true,
        providers: providersPayload(),
        cache: store.driver,
        promptVersion: config.promptVersion,
        limits: { perClientDaily: config.perClientDaily, perIpDaily: config.perIpDaily, minIntervalMs: config.minIntervalMs },
      }, { 'Content-Type': 'application/json; charset=utf-8' });
    }

    if (req.method === 'POST' && url.pathname === '/api/session') {
      const body = (await readBody(req)) as { clientId?: string };
      const clientId = String(body.clientId ?? '').trim();
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) {
        return send(res, 400, { ok: false, code: 'INVALID_PARAMS', errors: ['clientId 不合法'] }, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      return send(res, 200, { ok: true, ...issueSession(clientId, config.sessionSecret, config.sessionTtlMs) }, { 'Content-Type': 'application/json; charset=utf-8' });
    }

    if (req.method === 'POST' && url.pathname === '/api/generate-reading') {
      const body = await readBody(req);
      const out = await generateReading({ body, headers, ip }, { store, config });
      return send(res, out.status, out.body, out.headers);
    }

    if (url.pathname === '/api/settings') {
      if (req.method === 'GET') {
        const out = getSettings({ headers }, config);
        return send(res, out.status, out.body, out.headers);
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const out = saveSettings({ headers, body }, config);
        return send(res, out.status, out.body, out.headers);
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/settings/test') {
      const body = await readBody(req);
      const out = await testProvider({ headers, body }, config);
      return send(res, out.status, out.body, out.headers);
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/settings/')) {
      const name = decodeURIComponent(url.pathname.slice('/api/settings/'.length));
      const out = deleteSettings({ headers }, config, name);
      return send(res, out.status, out.body, out.headers);
    }

    if (req.method === 'GET' && url.pathname === '/api/queue') {
      const items = await listQueue(store);
      return send(res, 200, { ok: true, items }, { 'Content-Type': 'application/json; charset=utf-8' });
    }

    const queueMatch = url.pathname.match(/^\/api\/queue\/([^/]+)(?:\/(publish))?$/);
    if (queueMatch) {
      const id = decodeURIComponent(queueMatch[1]);
      if (req.method === 'POST' && queueMatch[2] === 'publish') {
        const ok = await publishQueueItem(store, id);
        return send(res, ok ? 200 : 404, { ok }, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (req.method === 'DELETE') {
        const ok = await deleteQueueItem(store, id);
        return send(res, ok ? 200 : 404, { ok }, { 'Content-Type': 'application/json; charset=utf-8' });
      }
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (await serveStatic(url.pathname, res)) return;
    }

    send(res, 404, { ok: false, code: 'NOT_FOUND' }, { 'Content-Type': 'application/json; charset=utf-8' });
  } catch (err) {
    send(res, 500, { ok: false, code: 'INTERNAL', errors: [(err as Error).message] }, { 'Content-Type': 'application/json; charset=utf-8' });
  }
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`[reading-ai] http://127.0.0.1:${config.port}  cache=${store.driver}  providers=${providersPayload().map((p) => p.name).join(',') || '(none)'}`);
});

process.on('SIGINT', () => {
  store.close();
  server.close(() => process.exit(0));
});
