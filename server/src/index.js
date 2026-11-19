// Точка входа: один http-сервер на /mcp, /api/*, /healthz и статику панели.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createApi } from './api.js';
import { createMcpServer } from './mcp.js';
import { TelegramBot } from './telegram.js';
import { createMonitor } from './monitor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '..', 'public');
const MAX_BODY = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

// --- Rate limiter (in-memory sliding window) ---
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;
const rateBuckets = new Map();

function rateLimit(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT_MAX;
}

// Периодическая очистка устаревших bucket'ов (раз в 5 минут)
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateBuckets.delete(ip);
  }
}, 300_000).unref();

// --- Structured logger ---
function log(level, msg, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };
  const out = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(out + '\n');
  } else {
    process.stdout.write(out + '\n');
  }
}

// --- CORS & Security headers ---
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization, Accept, X-Request-Id',
  'access-control-allow-credentials': 'true',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-xss-protection': '0',
};

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(JSON.stringify(body));
}

const rpcError = (res, status, code, message) =>
  sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const e = new Error('payload too large');
      e.status = 413;
      throw e;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Безопасно превращает URL-путь в файл внутри publicDir.
 * Возвращает null, если путь выходит за каталог (traversal) или битый.
 */
export function resolveStaticPath(publicDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  const root = path.resolve(publicDir);
  const full = path.resolve(root, rel);
  // path.relative надёжнее startsWith: соседний «public-evil» не принимается за «public».
  const back = path.relative(root, full);
  if (back.startsWith('..') || path.isAbsolute(back)) return null;
  return full;
}

async function serveStatic(req, res, publicDir, requestId) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Только GET' } }, { allow: 'GET, HEAD' });
  }
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const file = resolveStaticPath(publicDir, pathname);
  if (!file) {
    log('warn', 'static_path_traversal_attempt', { requestId, pathname });
    return sendJson(res, 404, { error: { code: 'not_found', message: 'Не найдено' } });
  }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
      ...CORS_HEADERS,
      ...SECURITY_HEADERS,
      'x-request-id': requestId,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    log('warn', 'static_file_not_found', { requestId, pathname, error: err?.message ?? String(err) });
    sendJson(res, 404, { error: { code: 'not_found', message: 'Не найдено' } });
  }
}

// Stateless: на каждый POST свежий сервер и транспорт, иначе запросы разных
// клиентов делили бы одно состояние протокола.
async function handleMcp(req, res, deps) {
  if (req.method !== 'POST') {
    return rpcError(res, 405, -32000, 'Method not allowed');
  }
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (err) {
    if (err.status === 413) return rpcError(res, 413, -32000, 'Payload too large');
    return rpcError(res, 400, -32700, 'Parse error');
  }
  const server = createMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed);
  } catch (err) {
    if (!res.headersSent) rpcError(res, 500, -32603, err?.message ?? 'Internal error');
  }
}

/**
 * Собирает http.Server, но не запускает его: так его можно проверить в тестах.
 * @param {{ db: any, sites: any, bridge: any, llm?: any, autopilot?: any, publicDir?: string, telegram?: any, monitor?: any }} deps
 */
export function createApp({ db, sites, bridge, llm, autopilot, telegram, monitor, publicDir = PUBLIC_DIR }) {
  const api = createApi({ db, llm, autopilot, monitor });
  const mon = monitor || null;
  return http.createServer(async (req, res) => {
    const startTime = Date.now();
    const requestId = randomUUID();
    const ip = req.socket?.remoteAddress ?? 'unknown';

    // Monitor middleware
    if (mon) mon.middleware(req, res, startTime);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...CORS_HEADERS,
        ...SECURITY_HEADERS,
        'content-length': '0',
      });
      return res.end();
    }

    // Rate limiting
    if (!rateLimit(ip)) {
      log('warn', 'rate_limit_exceeded', { requestId, ip, method: req.method, url: req.url });
      return sendJson(res, 429, { error: { code: 'too_many_requests', message: 'Слишком много запросов. Попробуйте позже.' } });
    }

    try {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      if (pathname === '/healthz') return sendJson(res, 200, { ok: true, requestId });
      if (pathname === '/metrics' && mon) return sendJson(res, 200, mon.getStats());
      if (pathname === '/mcp') return await handleMcp(req, res, { db, sites, bridge, llm, autopilot });
      if (await api.handle(req, res)) return;
      await serveStatic(req, res, publicDir, requestId);
    } catch (err) {
      log('error', 'request_error', { requestId, method: req.method, url: req.url, error: err?.message ?? String(err) });
      if (mon) mon.recordError('request_error', err?.message ?? String(err), { method: req.method, url: req.url });
      if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal_error', message: 'Внутренняя ошибка сервера' } });
      else res.end();
    }

    const durationMs = Date.now() - startTime;
    log('info', 'request', {
      requestId,
      method: req.method,
      url: req.url,
      status: res.statusCode,
      durationMs,
    });
  });
}

export async function start() {
  // Тяжёлые модули грузим здесь, чтобы импорт index.js в тестах ничего не открывал.
  const [{ createDb }, { createBridge }, { createSites }, { createLlmClient }, { AutopilotEngine }] = await Promise.all([
    import('./db.js'),
    import('./bridge.js'),
    import('./sites/index.js'),
    import('./core/llm.js'),
    import('./core/autopilot.js')
  ]);
  const dbPath = process.env.DB_PATH ?? ':memory:';
  const db = createDb(dbPath);
  const bridge = createBridge();
  const sites = createSites(bridge);

  // Telegram bot
  const telegram = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, db);
  if (telegram.enabled) {
    await telegram.init();
    telegram.startPolling();
    log('info', 'telegram_bot_started', {});
  }

  // Monitor
  const monitor = createMonitor(db);

  const llm = createLlmClient();
  const autopilot = new AutopilotEngine({ db, sites, bridge, llm, monitor });

  const rawSettings = db.getSettings ? db.getSettings() : {};
  if (rawSettings.autopilot?.enabled) {
    autopilot.updateConfig(rawSettings.autopilot);
  }

  const port = Number(process.env.PORT ?? 8765);
  const host = process.env.HOST ?? '0.0.0.0';
  const server = createApp({ db, sites, bridge, llm, autopilot, telegram, monitor });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  log('info', 'server_started', { port, host, dbPath });
  const stop = () => {
    log('info', 'server_stopping', {});
    if (autopilot) autopilot.stop();
    if (telegram) telegram.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

// Запуск только как главный модуль, импорт из тестов порт не открывает.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
