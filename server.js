import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { config } from './src/config.js';
import { GameError, GameManager } from './src/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARED_DIR = path.join(__dirname, 'shared');
const manager = new GameManager(config);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function setCommonHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  setCommonHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new GameError('请求太大了', 413, 'TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new GameError('请求格式不对', 400, 'BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(req, res, pathname) {
  let baseDir = PUBLIC_DIR;
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { ok: false, error: '无效路径' });
    return;
  }
  if (relative === '/shared/catalog.js') {
    baseDir = SHARED_DIR;
    relative = '/catalog.js';
  } else if (relative === '/') {
    relative = '/index.html';
  }
  const filePath = path.resolve(baseDir, `.${relative}`);
  const root = path.resolve(baseDir) + path.sep;
  if (!filePath.startsWith(root)) {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    setCommonHeaders(res);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, manager.health());
      return true;
    }
    if (req.method === 'GET' && pathname === '/api/session') {
      const result = manager.getSession(url.searchParams.get('token'));
      sendJson(res, 200, {
        ok: true,
        roomCode: result.room.code,
        playerId: result.player.id,
        snapshot: result.snapshot,
      });
      return true;
    }
    if (req.method === 'POST' && pathname === '/api/create') {
      const body = await readJson(req);
      const result = manager.createRoom(body.name);
      sendJson(res, 200, {
        ok: true,
        roomCode: result.room.code,
        token: result.player.token,
        playerId: result.player.id,
        slot: result.player.slot,
        snapshot: result.snapshot,
      });
      return true;
    }
    if (req.method === 'POST' && pathname === '/api/join') {
      const body = await readJson(req);
      const result = manager.joinRoom(body.code, body.name);
      sendJson(res, 200, {
        ok: true,
        roomCode: result.room.code,
        token: result.player.token,
        playerId: result.player.id,
        slot: result.player.slot,
        snapshot: result.snapshot,
      });
      return true;
    }
    if (req.method === 'POST' && pathname === '/api/action') {
      const body = await readJson(req);
      const result = manager.action(body.token, body.action);
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }
    if (req.method === 'GET' && pathname === '/api/poll') {
      const payload = await manager.poll(
        url.searchParams.get('token'),
        url.searchParams.get('since'),
      );
      sendJson(res, 200, { ok: true, ...payload });
      return true;
    }
    return false;
  } catch (err) {
    if (err instanceof GameError) {
      sendJson(res, err.status, { ok: false, error: err.message, code: err.code });
    } else {
      console.error('[api]', err);
      sendJson(res, 500, { ok: false, error: '服务器打了个嗝，再试一次', code: 'INTERNAL' });
    }
    return true;
  }
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendJson(res, 400, { ok: false, error: 'Bad request' });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, url);
    if (!handled) sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  serveFile(req, res, url.pathname);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function wsSend(ws, payload) {
  if (ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }
}

server.on('upgrade', (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch {
    socket.destroy();
    return;
  }
  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  let connectedToken = null;
  let authed = false;
  let authTimer = setTimeout(() => {
    if (!authed) {
      wsSend(ws, { type: 'error', message: '连接超时' });
      ws.close(4001, 'auth_timeout');
    }
  }, 6000);
  authTimer.unref?.();

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      wsSend(ws, { type: 'error', message: '消息格式不对' });
      return;
    }
    if (!authed) {
      if (msg?.type !== 'auth' || typeof msg.token !== 'string') {
        wsSend(ws, { type: 'error', message: '请先登录房间' });
        return;
      }
      try {
        const attached = manager.attachSocket(msg.token, ws);
        connectedToken = msg.token;
        authed = true;
        clearTimeout(authTimer);
        wsSend(ws, {
          type: 'hello',
          snapshot: attached.snapshot,
          cursor: attached.cursor,
          transport: 'ws',
        });
        manager.afterAttach(attached.room, attached.player, attached.wasOffline);
      } catch (err) {
        wsSend(ws, {
          type: 'auth_error',
          message: err instanceof GameError ? err.message : '连接失败',
        });
        ws.close(4001, 'auth_failed');
      }
      return;
    }
    if (msg?.type === 'action') {
      try {
        const result = manager.action(connectedToken, msg.action);
        wsSend(ws, { type: 'ack', action: msg.action?.type, result });
      } catch (err) {
        if (err instanceof GameError) {
          wsSend(ws, { type: 'error', message: err.message, code: err.code });
        } else {
          console.error('[ws action]', err);
          wsSend(ws, { type: 'error', message: '操作失败了，再试一次' });
        }
      }
      return;
    }
    if (msg?.type === 'ping') {
      wsSend(ws, { type: 'pong', at: Date.now() });
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (authed && connectedToken) manager.detachSocket(connectedToken, ws);
  });

  ws.on('error', () => {
    /* close handles cleanup */
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 30000);
heartbeat.unref?.();

server.on('error', (err) => {
  console.error('[server]', err);
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  console.log(`互相恶心大作战 running at http://${config.host}:${port}`);
  console.log(`WebSocket: ws://${config.host}:${port}/ws  |  polling: /api/poll`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] shutting down (${signal})`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    try {
      ws.close(1001, 'server_shutdown');
    } catch {
      /* ignore */
    }
  }
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
