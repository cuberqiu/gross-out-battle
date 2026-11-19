#!/usr/bin/env node
/**
 * End-to-end two-client test.
 * Host uses WebSocket. Guest uses the HTTP long-polling fallback.
 * Runs a full match of battle, quiz and mixed modes against a temporary server.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { QUESTIONS } from '../src/questions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FAST_ENV = {
  ROUND_SECONDS: '7',
  QUIZ_SECONDS: '3',
  QUIZ_QUESTIONS: '2',
  MIXED_QUIZ_QUESTIONS: '2',
  STAGE_INTRO_MS: '250',
  QUIZ_SUSPENSE_MS: '80',
  QUIZ_REVEAL_MS: '700',
  SYNC_WINDOW_MS: '2000',
  THROW_COOLDOWN_MS: '180',
  OFFLINE_THRESHOLD_MS: '10000',
  POLL_TIMEOUT_MS: '5000',
};

let passed = 0;
function check(label, condition, detail = '') {
  if (!condition) throw new Error(`${label}${detail ? ` — ${detail}` : ''}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(base, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(120);
  }
  throw new Error('temporary test server did not become ready');
}

async function postJson(base, pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`${pathname} failed: ${res.status} ${data.error || ''}`);
  }
  return data;
}

class BaseClient {
  constructor(label, session) {
    this.label = label;
    this.session = session;
    this.token = session.token;
    this.playerId = session.playerId;
    this.snapshot = session.snapshot;
    this.events = [];
    this.errors = [];
    this.transport = null;
    this.closed = false;
  }

  get slot() {
    return this.snapshot?.me?.slot;
  }

  me() {
    return this.snapshot?.players?.find((p) => p.id === this.playerId);
  }

  opponent() {
    return this.snapshot?.players?.find((p) => p.id !== this.playerId);
  }

  _acceptSnapshot(snapshot) {
    if (!snapshot) return;
    this.snapshot = snapshot;
  }

  _acceptEvent(event) {
    if (!event) return;
    this.events.push(event);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    if (event.type === 'error') this.errors.push(event.message || 'server error');
  }

  allEvents(type) {
    return this.events.filter((event) => event.type === type);
  }

  lastEvent(type) {
    return [...this.events].reverse().find((event) => event.type === type) || null;
  }

  waitUntil(predicate, timeoutMs, label) {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const interval = setInterval(() => {
        if (this.closed) {
          clearInterval(interval);
          reject(new Error(`${label} failed: client closed`));
          return;
        }
        if (predicate()) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(interval);
          const errors = this.errors.length ? ` serverErrors=${JSON.stringify(this.errors.slice(-3))}` : '';
          reject(
            new Error(
              `${label} timed out after ${timeoutMs}ms; phase=${this.snapshot?.phase} stage=${this.snapshot?.stageIndex}${errors}`,
            ),
          );
        }
      }, 35);
    });
  }
}

class WsClient extends BaseClient {
  static async create(base, name) {
    const data = await postJson(base, '/api/create', { name });
    return new WsClient('WS-host', data, base);
  }

  static async join(base, code, name) {
    const data = await postJson(base, '/api/join', { code, name });
    return new WsClient('WS-guest', data, base);
  }

  static async reconnect(base, previous) {
    const client = new WsClient(
      'WS-host',
      { token: previous.token, playerId: previous.playerId, snapshot: previous.snapshot },
      base,
    );
    return client.connect();
  }

  constructor(label, session, base) {
    super(label, session);
    this.base = base;
    this.wsUrl = base.replace(/^http/, 'ws') + '/ws';
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 4000);
      this.ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    this.ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        this.transport = msg.transport;
        this._acceptSnapshot(msg.snapshot);
      } else if (msg.type === 'state') {
        this._acceptSnapshot(msg.snapshot);
      } else if (msg.type === 'error' || msg.type === 'auth_error') {
        this._acceptEvent({ type: 'error', ...msg });
      } else if (msg.type !== 'ack' && msg.type !== 'pong') {
        this._acceptEvent(msg);
      }
    });
    this.ws.send(JSON.stringify({ type: 'auth', token: this.token, since: 0 }));
    await this.waitUntil(() => this.transport === 'ws', 4000, 'WS hello');
    return this;
  }

  send(action) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    this.ws.send(JSON.stringify({ type: 'action', action }));
  }

  async close() {
    this.closed = true;
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        ws.close(1000, 'test_done');
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}

class PollClient extends BaseClient {
  static async join(base, code, name) {
    const data = await postJson(base, '/api/join', { code, name });
    return new PollClient('Poll-guest', data, base);
  }

  constructor(label, session, base) {
    super(label, session);
    this.base = base;
    this.cursor = 0;
    this.active = false;
    this.controller = null;
    this.loopPromise = null;
    this.pollCount = 0;
  }

  start() {
    if (this.active) return this;
    this.active = true;
    this.loopPromise = this.pollLoop();
    return this;
  }

  async pollLoop() {
    while (this.active && !this.closed) {
      const controller = new AbortController();
      this.controller = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(
          `${this.base}/api/poll?token=${encodeURIComponent(this.token)}&since=${this.cursor}`,
          { signal: controller.signal },
        );
        clearTimeout(timeout);
        if (!this.active || this.closed) return;
        if (!response.ok) throw new Error(`poll failed ${response.status}`);
        const data = await response.json();
        if (!this.active || this.closed) return;
        this.transport = data.transport;
        this.pollCount += 1;
        if (data.snapshot) this._acceptSnapshot(data.snapshot);
        if (Array.isArray(data.events)) {
          for (const event of data.events) this._acceptEvent(event);
        }
        if (Number.isFinite(data.cursor)) this.cursor = data.cursor;
      } catch (error) {
        clearTimeout(timeout);
        if (!this.active || this.closed) return;
        this.errors.push(`poll: ${error.message}`);
        await sleep(350);
      }
    }
  }

  async waitForPoll() {
    await this.waitUntil(() => this.pollCount > 0 && this.transport === 'poll', 4000, 'poll first response');
  }

  async send(action) {
    const res = await fetch(`${this.base}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.token, action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const error = new Error(`poll action ${action.type} failed: ${data.error || res.status}`);
      this.errors.push(error.message);
      throw error;
    }
    return data;
  }

  async close() {
    this.closed = true;
    this.active = false;
    if (this.controller) {
      try {
        this.controller.abort();
      } catch {
        /* ignore */
      }
    }
    await Promise.race([this.loopPromise, sleep(500)]);
  }
}

async function both(clients, predicate, label, timeoutMs = 9000) {
  await Promise.all(clients.map((client) => client.waitUntil(() => predicate(client), timeoutMs, label)));
}

async function startRoom(host, guest, mode) {
  host.send({ type: 'setMode', mode });
  await both([host, guest], (c) => c.snapshot?.mode === mode, `mode ${mode} synced`);
  host.send({ type: 'start' });
  await both(
    [host, guest],
    (c) => ['intro', 'battle', 'quiz'].includes(c.snapshot?.phase),
    `match started (${mode})`,
  );
}

async function setupFastRoom(base, mode, suffix = '') {
  const host = await WsClient.create(base, `阿臭${suffix}`);
  await host.connect();
  check('host connected over WebSocket', host.transport === 'ws');
  const guest = await PollClient.join(base, host.snapshot.code, `阿呆${suffix}`);
  guest.start();
  await guest.waitForPoll();
  check('guest connected over HTTP long-polling', guest.transport === 'poll');
  await both(
    [host, guest],
    (c) => c.snapshot?.players?.length === 2 && c.snapshot.players.every((p) => p.connected),
    'both players present in lobby',
  );
  await startRoom(host, guest, mode);
  return { host, guest };
}

async function waitForPhase(client, phase, label, timeout = 12000, extra = () => true) {
  await client.waitUntil(
    () => client.snapshot?.phase === phase && extra(client.snapshot),
    timeout,
    `${client.label}: ${label}`,
  );
}

async function runBattleScenario(base) {
  console.log('\n▶ 场景 1 / 恶心大作战（掉线暂停、擦拭、同步投掷、结算、重赛）');
  const setup = await setupFastRoom(base, 'battle', 'A');
  const guest = setup.guest;
  let host = setup.host;
  try {
    await both([host, guest], (c) => c.snapshot.phase === 'battle', 'battle phase reached');
    check('battle mode enters a live 7s round', host.snapshot.stageType === 'battle');

    await host.close();
    await guest.waitUntil(() => Boolean(guest.snapshot?.paused), 5000, 'pause after host disconnect');
    check('host disconnect pauses the live match', guest.snapshot.paused === true);
    host = await WsClient.reconnect(base, host);
    await both([host, guest], (c) => c.snapshot?.paused === false, 'resume after reconnect', 6000);
    check('host reconnect resumes the paused match', true);

    guest.send({ type: 'throw', itemId: 'tomato' });
    await host.waitUntil(
      () => host.snapshot?.splats?.some((s) => s.itemId === 'tomato'),
      3000,
      'host receives guest splat',
    );
    check('guest throw lands on host screen in real time', host.snapshot.splats.length >= 1);
    check('guest hit is scored', (guest.me()?.hits || 0) >= 1);
    const incomingSplat = host.snapshot.splats.find((s) => s.itemId === 'tomato');
    host.send({ type: 'wipe', ids: [incomingSplat.id] });
    await host.waitUntil(
      () => !host.snapshot?.splats?.some((s) => s.id === incomingSplat.id),
      3000,
      'host wipes tomato',
    );
    await guest.waitUntil(
      () => guest.snapshot?.players?.some((p) => p.id === host.playerId && p.wiped >= 1),
      3000,
      'wipe stats sync to guest',
    );
    check('host wipe removes splat and syncs stats', true);

    host.send({ type: 'throw', itemId: 'sock' });
    await guest.waitUntil(
      () => guest.snapshot?.splats?.some((s) => s.itemId === 'sock'),
      3000,
      'guest receives host splat',
    );
    const guestSplat = guest.snapshot.splats.find((s) => s.itemId === 'sock');
    await guest.send({ type: 'wipe', ids: [guestSplat.id] });
    await guest.waitUntil(
      () => !guest.snapshot?.splats?.some((s) => s.id === guestSplat.id),
      3000,
      'guest wipes sock',
    );
    check('both clients can throw and wipe', true);

    await sleep(280);
    await Promise.all([
      new Promise((resolve) => {
        host.send({ type: 'throw', itemId: 'slime' });
        resolve();
      }),
      guest.send({ type: 'throw', itemId: 'slime' }),
    ]);
    await both([host, guest], (c) => Boolean(c.lastEvent('sync')), 'synchronized throw detected', 4000);
    check('near-simultaneous same item triggers 居然有默契', true);
    check('sync moment counted for both', (host.me()?.syncMoments || 0) >= 1 && (guest.me()?.syncMoments || 0) >= 1);

    await waitForPhase(host, 'results', 'battle results', 12000);
    await waitForPhase(guest, 'results', 'battle results', 12000);
    const result = host.snapshot.result;
    check('battle result synced to both clients', Boolean(result) && guest.snapshot.result?.finishedAt === result.finishedAt);
    check('battle scores and hits are positive', result.players.every((p) => p.score > 0 && p.hits > 0));
    check('winner and loser titles are present', Boolean(result.winnerTitle) && Boolean(result.loserTitle));
    check('默契指数 generated', Number.isInteger(result.syncIndex) && result.syncIndex >= 0);
    console.log(
      `    result: ${result.players.map((p) => `${p.name} ${p.score}分`).join(' vs ')} · 默契 ${result.syncIndex}% (${result.verdict.title})`,
    );

    host.send({ type: 'rematch' });
    guest.send({ type: 'rematch' });
    await both(
      [host, guest],
      (c) => ['intro', 'battle'].includes(c.snapshot.phase) && c.snapshot.stageIndex === 0 && !c.snapshot.result,
      'rematch starts',
    );
    await both(
      [host, guest],
      (c) => c.snapshot.players.every((p) => p.hits === 0 && p.battlePoints === 0),
      'rematch resets scores',
    );
    check('both players can rematch and scores reset', true);
  } finally {
    await host.close();
    await guest.close();
  }
}

async function runQuizScenario(base) {
  console.log('\n▶ 场景 2 / 默契大考验（同选、分歧、惩罚、结算、重赛）');
  const { host, guest } = await setupFastRoom(base, 'quiz', 'Q');
  try {
    await both([host, guest], (c) => c.snapshot.phase === 'quiz' && Boolean(c.snapshot.quiz?.question), 'first quiz question');
    const q1 = host.snapshot.quiz;
    check('both players see the same quiz question', q1.question.id === guest.snapshot.quiz.question.id);
    host.send({ type: 'quizAnswer', questionId: q1.question.id, choice: 0 });
    guest.send({ type: 'quizAnswer', questionId: q1.question.id, choice: 0 });
    await both([host, guest], (c) => Boolean(c.lastEvent('quizReveal')) && c.snapshot.quiz?.revealed, 'quiz 1 reveal');
    check('matching answers produce 默契 +1', host.snapshot.quiz.reveal.matched && guest.snapshot.quiz.reveal.matched);
    check('quiz answer choices are synced', host.snapshot.quiz.answered.every((a) => a.choice === 0));

    await both(
      [host, guest],
      (c) => c.snapshot.phase === 'quiz' && c.snapshot.quiz?.qNumber === 2 && !c.snapshot.quiz.revealed,
      'second quiz question',
    );
    const q2 = host.snapshot.quiz;
    host.send({ type: 'quizAnswer', questionId: q2.question.id, choice: 0 });
    guest.send({ type: 'quizAnswer', questionId: q2.question.id, choice: 1 });
    await both([host, guest], (c) => Boolean(c.snapshot.quiz?.revealed), 'quiz 2 reveal', 6000);
    await both([host, guest], (c) => c.lastEvent('quizReveal')?.qIndex === 1, 'mismatch event', 4000);
    const mismatch = host.lastEvent('quizReveal');
    check('different answers produce 没有默契了', mismatch.matched === false && guest.snapshot.quiz.reveal.matched === false);
    check(
      'mismatch splats both players own screens',
      mismatch.selfSplats?.A?.length === 3 && mismatch.selfSplats?.B?.length === 3,
    );
    check('mismatch self splats appear in snapshots', guest.snapshot.quiz.selfSplats.length === 3);

    await waitForPhase(host, 'results', 'quiz results', 12000);
    await waitForPhase(guest, 'results', 'quiz results', 12000);
    const result = host.snapshot.result;
    check('quiz match completes two questions', result.quizTotal === 2 && result.quizMatches === 1);
    check('quiz-only sync index reflects match rate', result.syncIndex === 50);
    check('quiz winner/loser and verdict rendered', Boolean(result.winnerId) && Boolean(result.loserTitle) && Boolean(result.verdict.title));
    console.log(`    result: 默契 ${result.syncIndex}% (${result.verdict.title})`);

    host.send({ type: 'rematch' });
    guest.send({ type: 'rematch' });
    await both(
      [host, guest],
      (c) => ['intro', 'quiz'].includes(c.snapshot.phase) && c.snapshot.stageIndex === 0 && !c.snapshot.result,
      'quiz rematch starts',
    );
    check('quiz rematch restarts a fresh match', true);
  } finally {
    await host.close();
    await guest.close();
  }
}

async function answerQuizPair(host, guest, questionNumber) {
  await both(
    [host, guest],
    (c) =>
      c.snapshot.phase === 'quiz' &&
      c.snapshot.quiz?.qNumber === questionNumber &&
      c.snapshot.quiz?.question &&
      !c.snapshot.quiz.revealed,
    `mixed quiz question ${questionNumber}`,
    8000,
  );
  const question = host.snapshot.quiz.question;
  host.send({ type: 'quizAnswer', questionId: question.id, choice: 0 });
  guest.send({ type: 'quizAnswer', questionId: question.id, choice: 0 });
  await both(
    [host, guest],
    (c) => c.snapshot.quiz?.revealed && c.snapshot.quiz.qNumber === questionNumber,
    `mixed quiz reveal ${questionNumber}`,
    7000,
  );
  check(`mixed quiz question ${questionNumber} answered in sync`, host.snapshot.quiz.reveal.matched);
}

async function runMixedScenario(base) {
  console.log('\n▶ 场景 3 / 混合双打（投掷 → 默契问答 → 终极投掷）');
  const { host, guest } = await setupFastRoom(base, 'mixed', 'M');
  try {
    await both(
      [host, guest],
      (c) => c.snapshot.phase === 'battle' && c.snapshot.stageIndex === 0,
      'mixed battle stage 1',
    );
    check('mixed mode starts with battle stage', host.snapshot.stageType === 'battle');
    host.send({ type: 'throw', itemId: 'fart' });
    await guest.waitUntil(
      () => guest.snapshot.splats?.some((s) => s.itemId === 'fart'),
      3000,
      'mixed battle throw lands',
    );
    guest.send({ type: 'throw', itemId: 'roach' });
    await host.waitUntil(
      () => host.snapshot.splats?.some((s) => s.itemId === 'roach'),
      3000,
      'mixed return throw lands',
    );
    const splat = guest.snapshot.splats.find((s) => s.itemId === 'fart');
    if (splat) await guest.send({ type: 'wipe', ids: [splat.id] });
    check('mixed battle allows throws and wipes', true);

    await both(
      [host, guest],
      (c) => c.snapshot.phase === 'quiz' && c.snapshot.stageIndex === 1,
      'mixed quiz stage',
      12000,
    );
    check('mixed mode alternates into quiz', host.snapshot.stageType === 'quiz');
    await answerQuizPair(host, guest, 1);
    await answerQuizPair(host, guest, 2);

    await both(
      [host, guest],
      (c) => c.snapshot.phase === 'battle' && c.snapshot.stageIndex === 2,
      'mixed battle stage 2',
      12000,
    );
    check('mixed mode alternates back to final battle', host.snapshot.stageType === 'battle');
    host.send({ type: 'throw', itemId: 'booger' });
    guest.send({ type: 'throw', itemId: 'tomato' });
    await both(
      [host, guest],
      (c) => (c.me()?.hits || 0) >= 1,
      'final battle throws score',
      4000,
    );

    await waitForPhase(host, 'results', 'mixed results', 14000);
    await waitForPhase(guest, 'results', 'mixed results', 14000);
    const result = host.snapshot.result;
    check('mixed mode completes all three stages', result.mode === 'mixed' && host.snapshot.stageCount === 3);
    check('mixed final scores include battle and quiz', result.players.every((p) => p.score > 0));
    check('mixed result and rematch button data synced', result.finishedAt === guest.snapshot.result.finishedAt);
    console.log(
      `    result: ${result.players.map((p) => `${p.name} ${p.score}分`).join(' vs ')} · 默契 ${result.syncIndex}% (${result.verdict.title})`,
    );
  } finally {
    await host.close();
    await guest.close();
  }
}

async function main() {
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const serverLog = [];
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ...FAST_ENV,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => serverLog.push(String(chunk)));
  server.stderr.on('data', (chunk) => serverLog.push(String(chunk)));

  let exitCode = 0;
  try {
    await waitForServer(base);
    check('question bank contains 20+ questions with 3–4 options', QUESTIONS.length >= 20 && QUESTIONS.every((q) => q.options.length >= 3 && q.options.length <= 4));
    console.log(`Temporary server on ${base} (fast timers, WebSocket + long-poll)`);
    await runBattleScenario(base);
    await runQuizScenario(base);
    await runMixedScenario(base);
    console.log(`\n✅ E2E PASS — ${passed} checks. All three modes, synced throws, wipes, quiz answers, scores and rematch.`);
  } catch (error) {
    exitCode = 1;
    console.error(`\n❌ E2E FAIL: ${error.message}`);
    console.error(error.stack);
    if (serverLog.length) {
      console.error('\n--- server log ---');
      console.error(serverLog.join('').slice(-5000));
    }
  } finally {
    try {
      server.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    const exited = await Promise.race([
      new Promise((resolve) => server.once('exit', () => resolve(true))),
      sleep(2500).then(() => false),
    ]);
    if (!exited) {
      try {
        server.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    await sleep(150);
    console.log('Temporary server stopped; no server is left running.');
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
