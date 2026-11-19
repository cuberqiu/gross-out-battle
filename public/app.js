import { ITEMS, ITEM_MAP, MODE_INFO } from '/shared/catalog.js';
import { SoundBoard } from '/audio.js';
import { Realtime } from '/realtime.js';

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SESSION_KEY = 'gross-session-v1';
const NAME_KEY = 'gross-player-name';
const HELP_KEY = 'gross-help-seen-v1';
const SHAPES = [
  '42% 58% 63% 37% / 45% 38% 62% 55%',
  '58% 42% 33% 67% / 55% 62% 38% 45%',
  '37% 63% 55% 45% / 62% 42% 58% 38%',
  '63% 37% 45% 55% / 40% 62% 38% 60%',
  '50% 50% 38% 62% / 57% 41% 59% 43%',
];
const MODE_EMOJI = { battle: '💥', quiz: '🧠', mixed: '🌪️' };
const sound = new SoundBoard();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  token: null,
  roomCode: null,
  playerId: null,
  snapshot: null,
  screen: 'home',
  realtime: null,
  countdown: { kind: 'none', remainingMs: 0, totalMs: 0, paused: false, at: performance.now() },
  introKey: null,
  quizKey: null,
  quizChoice: null,
  grossKey: null,
  resultKey: null,
  splatEls: new Map(),
  pendingWipes: new Map(),
  wipeCooldowns: new Map(),
  lastWipeAt: 0,
  lastWipeSoundAt: 0,
  throwLockedUntil: 0,
  hasWipedOnce: false,
  fallbackToastShown: false,
  bannerHideTimer: null,
  helpReturnFocus: null,
  leaving: false,
};

// ---------------------------------------------------------------- basic helpers
function showScreen(name) {
  state.screen = name;
  for (const screen of $$('.screen')) {
    screen.classList.toggle('active', screen.id === `${name}Screen`);
  }
  document.body.dataset.screen = name;
  $('appFooter').classList.toggle('hidden', name === 'game');
}

function toast(message, tone = 'info', duration = 2800) {
  if (!message) return;
  const stack = $('toastStack');
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.textContent = message;
  stack.append(el);
  while (stack.children.length > 4) stack.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 260);
  }, duration);
}

function saveSession() {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: state.token, roomCode: state.roomCode, playerId: state.playerId }),
    );
  } catch {
    /* private mode */
  }
}

function clearSavedSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function loadSavedSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* ignore */
  }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `请求失败 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function copyText(text, message = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, 'success');
    return;
  } catch {
    /* fall back */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try {
    document.execCommand('copy');
    toast(message, 'success');
  } catch {
    toast('复制失败，手动选一下吧', 'warn');
  }
  area.remove();
}

function formatInviteLink(code = state.roomCode) {
  return `${location.origin}/?room=${encodeURIComponent(code || '')}`;
}

function sanitizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
}

function escapeEmoji(value, fallback = '🤢') {
  return typeof value === 'string' && value.length <= 6 ? value : fallback;
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.originalLabel) button.dataset.originalLabel = button.innerHTML;
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  if (busy && label) {
    button.innerHTML = `<span>${label}</span><b class="btn-arrow spinner">◌</b>`;
  } else if (!busy) {
    button.innerHTML = button.dataset.originalLabel;
  }
}

// ---------------------------------------------------------------- boot / session
function init() {
  $$('.screen').forEach((screen) => {
    screen.classList.toggle('active', screen.id === 'homeScreen');
  });
  const storedName = localStorage.getItem(NAME_KEY);
  if (storedName) $('nameInput').value = storedName;

  const invite = sanitizeCode(new URLSearchParams(location.search).get('room'));
  if (invite.length === 4) {
    $('codeInput').value = invite;
    $('inviteHint').classList.remove('hidden');
    setTimeout(() => $('codeInput').focus(), 120);
  }

  buildModeCards();
  buildItemDock();
  bindUi();
  updateSoundButton();
  tick();
  setInterval(tick, 100);
  restoreSessionIfAny(invite);

  if (!localStorage.getItem(HELP_KEY)) {
    setTimeout(() => {
      if (!$('helpModal').classList.contains('hidden')) return;
      if (!state.token) openHelp();
    }, 550);
  }
}

async function restoreSessionIfAny(invite) {
  const saved = loadSavedSession();
  if (!saved?.token) return;
  if (invite && saved.roomCode && invite !== saved.roomCode) {
    clearSavedSession();
    return;
  }
  try {
    const data = await api(`/api/session?token=${encodeURIComponent(saved.token)}`);
    if (!data?.snapshot) throw new Error('no snapshot');
    adoptSession({
      token: saved.token,
      roomCode: data.roomCode,
      playerId: data.playerId,
      snapshot: data.snapshot,
      restored: true,
    });
    toast('欢迎回来，继续互相恶心', 'success');
  } catch {
    clearSavedSession();
  }
}

function adoptSession({ token, roomCode, playerId, snapshot }) {
  state.token = token;
  state.roomCode = roomCode;
  state.playerId = playerId;
  saveSession();
  state.snapshot = snapshot;
  state.splatEls.clear();
  state.pendingWipes.clear();
  state.resultKey = null;
  state.quizKey = null;
  state.introKey = null;
  if (location.search) {
    history.replaceState(null, '', location.pathname);
  }
  showScreen(snapshot.phase === 'lobby' ? 'lobby' : snapshot.phase === 'results' ? 'result' : 'game');
  if (snapshot) handleSnapshot(snapshot);
  startRealtime();
}

function startRealtime() {
  if (state.realtime) state.realtime.stop();
  const realtime = new Realtime({
    token: state.token,
    onState: (snapshot) => {
      if (state.realtime !== realtime) return;
      handleSnapshot(snapshot);
    },
    onEvent: (event) => {
      if (state.realtime !== realtime) return;
      handleEvent(event);
    },
    onStatus: (status) => {
      if (state.realtime !== realtime) return;
      handleConnectionStatus(status);
    },
    onError: (message) => {
      if (state.realtime !== realtime) return;
      toast(message, 'warn');
    },
    onFatal: (message) => {
      if (state.realtime !== realtime) return;
      toast(message || '连接失效，请重新进入', 'error', 3600);
      leaveToHome({ quiet: true });
    },
  });
  state.realtime = realtime;
  realtime.start();
}

function leaveToHome({ quiet = false } = {}) {
  if (state.leaving) return;
  state.leaving = true;
  if (state.realtime) {
    state.realtime.stop();
    state.realtime = null;
  }
  clearSavedSession();
  state.token = null;
  state.roomCode = null;
  state.playerId = null;
  state.snapshot = null;
  clearSplatLayer();
  resetQuizUi();
  $('battleScene').classList.remove('hidden');
  $('quizScene').classList.add('hidden');
  $('stageIntroOverlay').classList.add('hidden');
  $('pauseOverlay').classList.add('hidden');
  hideConnectionBanner();
  if (location.search) history.replaceState(null, '', location.pathname);
  if (!quiet) toast('已离开房间，下次再来互相恶心', 'info');
  state.leaving = false;
  showScreen('home');
}

// ---------------------------------------------------------------- UI construction
function buildModeCards() {
  const grid = $('modeGrid');
  grid.replaceChildren();
  for (const [mode, info] of Object.entries(MODE_INFO)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mode-card';
    button.dataset.mode = mode;
    button.innerHTML = `
      <span class="mode-emoji">${MODE_EMOJI[mode]}</span>
      <span class="mode-copy">
        <strong>${info.name}</strong>
        <small>${info.desc}</small>
      </span>
      <span class="mode-check">✓</span>
    `;
    button.addEventListener('click', () => {
      if (!state.snapshot || state.snapshot.phase !== 'lobby') return;
      if (button.classList.contains('selected')) return;
      sound.play('click');
      state.realtime?.send({ type: 'setMode', mode });
    });
    grid.append(button);
  }
}

function buildItemDock() {
  const dock = $('itemDock');
  dock.replaceChildren();
  ITEMS.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item-btn';
    button.dataset.item = item.id;
    button.title = `${item.name}：${item.blurb}`;
    button.innerHTML = `
      <span class="item-hotkey">${index + 1}</span>
      <span class="item-emoji">${item.emoji}</span>
      <span class="item-name">${item.name}</span>
      <span class="item-tag">${item.tag}</span>
    `;
    button.addEventListener('click', () => throwItem(item, button));
    dock.append(button);
  });
}

function bindUi() {
  $('createBtn').addEventListener('click', createRoom);
  $('joinBtn').addEventListener('click', joinRoom);
  $('copyCodeBtn').addEventListener('click', () => copyText(state.roomCode || '', '房间码已复制'));
  $('shareBtn').addEventListener('click', shareInvite);
  $('startBtn').addEventListener('click', () => {
    if ($('startBtn').disabled) return;
    sound.play('click');
    state.realtime?.send({ type: 'start' });
  });
  $('rematchBtn').addEventListener('click', () => {
    if ($('rematchBtn').disabled) return;
    sound.play('click');
    state.realtime?.send({ type: 'rematch' });
  });
  $('toLobbyBtn').addEventListener('click', () => {
    sound.play('click');
    state.realtime?.send({ type: 'toLobby' });
  });
  $('jokeBtn').addEventListener('click', () => {
    const code = sanitizeCode($('codeInput').value);
    if (code.length === 4) {
      $('joinBtn').focus();
      toast('先加入房间，准备室里选「默契大考验」', 'info', 3200);
    } else {
      $('codeInput').focus();
      toast('拿到朋友的房间码后，选「默契大考验」开测', 'info', 3600);
    }
  });
  $('codeInput').addEventListener('input', (event) => {
    event.target.value = sanitizeCode(event.target.value);
    $('inviteHint').classList.add('hidden');
  });
  $('codeInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinRoom();
  });
  $('nameInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') createRoom();
  });
  $('soundBtn').addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    updateSoundButton();
    if (!sound.muted) {
      sound.unlock();
      sound.play('ding');
    }
  });
  $('helpBtn').addEventListener('click', openHelp);
  $('helpCloseBtn').addEventListener('click', closeHelp);
  $('helpGotItBtn').addEventListener('click', closeHelp);
  $$('[data-close-help]').forEach((el) => el.addEventListener('click', closeHelp));
  $('brandBtn').addEventListener('click', () => {
    if (!state.token || state.screen === 'home') {
      showScreen('home');
      return;
    }
    if (window.confirm('要离开当前房间吗？这局就当你去洗手间了。')) {
      leaveToHome();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('helpModal').classList.contains('hidden')) closeHelp();
    if (!$('helpModal').classList.contains('hidden')) return;
    if (state.screen !== 'game' || !state.snapshot || state.snapshot.phase !== 'battle') return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < ITEMS.length) {
      const button = $$('.item-btn')[index];
      if (button) throwItem(ITEMS[index], button);
    }
  });
  document.addEventListener('pointerdown', () => sound.unlock(), { once: true });
  bindWipeEvents();
}

function updateSoundButton() {
  const button = $('soundBtn');
  button.textContent = sound.muted ? '🔇' : '🔊';
  button.setAttribute('aria-label', sound.muted ? '打开声音' : '关闭声音');
  button.classList.toggle('is-muted', sound.muted);
}

function openHelp() {
  const modal = $('helpModal');
  state.helpReturnFocus = document.activeElement;
  modal.classList.remove('hidden');
  localStorage.setItem(HELP_KEY, '1');
  setTimeout(() => $('helpCloseBtn').focus(), 80);
}

function closeHelp() {
  $('helpModal').classList.add('hidden');
  state.helpReturnFocus?.focus?.();
}

async function createRoom() {
  if (state.token) return;
  const button = $('createBtn');
  const name = $('nameInput').value.trim();
  if (name) localStorage.setItem(NAME_KEY, name);
  setButtonBusy(button, true, '开门中…');
  try {
    const data = await api('/api/create', { method: 'POST', body: JSON.stringify({ name }) });
    sound.unlock();
    sound.play('celebrate');
    adoptSession(data);
    toast('房间开好了，快把房间码发给朋友', 'success', 3200);
  } catch (error) {
    toast(error.message || '创建失败，再试一下', 'error');
  } finally {
    setButtonBusy(button, false);
  }
}

async function joinRoom() {
  if (state.token) return;
  const button = $('joinBtn');
  const name = $('nameInput').value.trim();
  const code = sanitizeCode($('codeInput').value);
  if (code.length !== 4) {
    toast('房间码是 4 位哦', 'warn');
    $('codeInput').focus();
    return;
  }
  if (name) localStorage.setItem(NAME_KEY, name);
  setButtonBusy(button, true, '敲门中…');
  try {
    const data = await api('/api/join', {
      method: 'POST',
      body: JSON.stringify({ code, name }),
    });
    sound.unlock();
    sound.play('ding');
    adoptSession(data);
    toast('成功混进房间！', 'success');
  } catch (error) {
    toast(error.message || '加入失败，再试一下', 'error');
  } finally {
    setButtonBusy(button, false);
  }
}

async function shareInvite() {
  if (!state.roomCode) return;
  const link = formatInviteLink();
  if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try {
      await navigator.share({
        title: '互相恶心大作战',
        text: `房间码 ${state.roomCode}，来互相恶心一下（无害版）`,
        url: link,
      });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  copyText(link, '邀请链接已复制');
}

// ---------------------------------------------------------------- snapshots / connection
function handleSnapshot(snapshot) {
  if (!snapshot || !state.token) return;
  const previous = state.snapshot;
  state.snapshot = snapshot;
  state.roomCode = snapshot.code;
  if (previous && previous.phase === 'battle' && snapshot.phase !== 'battle') {
    clearSplatLayer();
  }
  if (!previous || previous.phase !== snapshot.phase) {
    if (snapshot.phase === 'results') {
      state.resultKey = null;
    }
    if (snapshot.phase === 'lobby') {
      resetQuizUi();
      clearSplatLayer();
    }
  }
  updateCountdown(snapshot);
  renderSnapshot(snapshot, previous);
  if (snapshot.phase === 'lobby' && state.screen !== 'lobby') showScreen('lobby');
  if (snapshot.phase === 'results' && state.screen !== 'result') showScreen('result');
  if (['intro', 'battle', 'quiz'].includes(snapshot.phase) && state.screen !== 'game') {
    showScreen('game');
  }
}

function updateCountdown(snapshot) {
  let kind = 'none';
  let remainingMs = 0;
  let totalMs = 0;
  if (snapshot.phase === 'intro' && snapshot.intro) {
    kind = 'intro';
    remainingMs = snapshot.intro.remainingMs;
    totalMs = Math.max(2600, remainingMs);
  } else if (snapshot.phase === 'battle' && snapshot.battle) {
    kind = 'battle';
    remainingMs = snapshot.battle.remainingMs;
    totalMs = snapshot.battle.durationMs;
  } else if (snapshot.phase === 'quiz' && snapshot.quiz) {
    kind = snapshot.quiz.revealed ? 'quizReveal' : 'quiz';
    remainingMs = snapshot.quiz.revealed ? snapshot.quiz.nextInMs : snapshot.quiz.remainingMs;
    totalMs = Math.max(1000, snapshot.config?.quizSeconds * 1000 || remainingMs);
  }
  state.countdown = {
    kind,
    remainingMs,
    totalMs,
    paused: Boolean(snapshot.paused),
    at: performance.now(),
  };
}

function handleConnectionStatus(status) {
  const banner = $('connectionBanner');
  if (status.state === 'online') {
    if (status.transport === 'poll' && !state.fallbackToastShown) {
      state.fallbackToastShown = true;
      toast('WebSocket 被网络拦住了，已自动切到长轮询', 'info', 3800);
    }
    $('connectionText').textContent = '已连接';
    banner.classList.add('banner-ok');
    clearTimeout(state.bannerHideTimer);
    state.bannerHideTimer = setTimeout(() => {
      banner.classList.add('hidden');
      banner.classList.remove('banner-ok');
    }, 900);
  } else {
    if (state.bannerHideTimer) clearTimeout(state.bannerHideTimer);
    banner.classList.remove('hidden', 'banner-ok');
    $('connectionText').textContent =
      status.state === 'reconnecting' ? '连接抖了一下，正在重连…' : '正在连接房间…';
  }
}

function hideConnectionBanner() {
  if (state.bannerHideTimer) clearTimeout(state.bannerHideTimer);
  $('connectionBanner').classList.add('hidden');
  $('connectionBanner').classList.remove('banner-ok');
}

function renderSnapshot(snapshot, previous) {
  if (snapshot.phase === 'lobby') {
    renderLobby(snapshot);
    return;
  }
  if (snapshot.phase === 'results') {
    renderResult(snapshot);
    return;
  }
  renderGame(snapshot, previous);
}

// ---------------------------------------------------------------- lobby
function renderLobby(snapshot) {
  showScreen('lobby');
  $('lobbyCode').textContent = snapshot.code;
  const players = snapshot.players;
  const container = $('lobbyPlayers');
  container.replaceChildren();

  players.forEach((player) => {
    const card = document.createElement('div');
    card.className = `player-card ${player.id === snapshot.me.id ? 'is-me' : ''} ${
      player.connected ? 'is-online' : 'is-offline'
    }`;
    card.innerHTML = `
      <div class="player-avatar-wrap">
        <span class="player-avatar">${escapeEmoji(player.avatar)}</span>
        <span class="presence-dot"></span>
      </div>
      <div class="player-info">
        <strong>${escapeText(player.name)}${player.id === snapshot.me.id ? ' <em>你</em>' : ''}</strong>
        <span>${player.isHost ? '👑 房主' : '😈 挑战者'} · ${
          player.connected ? '已就位' : '掉线中'
        }</span>
      </div>
      <span class="player-ready">${player.connected ? '就位' : '等待'}</span>
    `;
    container.append(card);
  });

  if (players.length < 2) {
    const placeholder = document.createElement('div');
    placeholder.className = 'player-card is-empty';
    placeholder.innerHTML = `
      <div class="player-avatar-wrap"><span class="player-avatar">❓</span></div>
      <div class="player-info"><strong>等一个倒霉蛋</strong><span>把房间码发出去，别自己玩</span></div>
      <span class="player-ready">...</span>
    `;
    container.append(placeholder);
  }

  $$('.mode-card', $('modeGrid')).forEach((card) => {
    card.classList.toggle('selected', card.dataset.mode === snapshot.mode);
    card.setAttribute('aria-pressed', String(card.dataset.mode === snapshot.mode));
  });

  const both = players.length === 2;
  const allOnline = players.every((p) => p.connected);
  const startBtn = $('startBtn');
  const canStart = snapshot.isHost && snapshot.phase === 'lobby' && both && allOnline;
  startBtn.disabled = !canStart;
  const label = startBtn.querySelector('span');
  if (label) {
    label.textContent = snapshot.isHost
      ? !both
        ? '还差一人'
        : !allOnline
          ? '等对方重连'
          : '开战！'
      : '等房主开战';
  }
  $('lobbyStatus').textContent = !both
    ? '把房间码发给朋友，等他/她上钩'
    : !allOnline
      ? '有人掉线了，正在等重连'
      : snapshot.isHost
        ? '都到齐了，选好玩法就开战'
        : '都到齐了，等房主按下开战';
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

// ---------------------------------------------------------------- game view
function renderGame(snapshot, previous) {
  showScreen('game');
  const me = snapshot.players.find((p) => p.id === snapshot.me.id) || {
    ...snapshot.me,
    hits: 0,
    coverPercent: 0,
    quizMatches: 0,
    answeredCount: 0,
  };
  const opponent =
    snapshot.players.find((p) => p.id !== snapshot.me.id) || {
      name: '等对手',
      avatar: '❓',
      hits: 0,
      coverPercent: 0,
      quizMatches: 0,
      answeredCount: 0,
      connected: false,
    };
  const quizVisible = snapshot.phase === 'quiz' || (snapshot.phase === 'intro' && snapshot.stageType === 'quiz');

  $('hudMeAvatar').textContent = escapeEmoji(me.avatar);
  $('hudMeName').textContent = me.name || '我';
  $('hudOppAvatar').textContent = escapeEmoji(opponent.avatar);
  $('hudOppName').textContent = opponent.name || '对方';
  if (quizVisible) {
    $('hudMeStats').textContent = `默契 ${me.quizMatches ?? 0} · 已答 ${me.answeredCount ?? 0}`;
    $('hudOppStats').textContent = `默契 ${opponent.quizMatches ?? 0} · 已答 ${opponent.answeredCount ?? 0}`;
  } else {
    $('hudMeStats').textContent = `${me.hits ?? 0} 发 · ${me.coverPercent ?? 0}%`;
    $('hudOppStats').textContent = `${opponent.hits ?? 0} 发 · ${opponent.coverPercent ?? 0}%`;
  }
  $('hudOpp').classList.toggle('is-offline', !opponent.connected);

  $('timerLabel').textContent =
    snapshot.phase === 'intro'
      ? '准备开战'
      : snapshot.phase === 'quiz'
        ? '默契倒计时'
        : snapshot.paused
          ? '已暂停'
          : '糊脸倒计时';

  if (previous && previous.stageIndex !== snapshot.stageIndex) {
    state.hasWipedOnce = false;
    $('comboFeed').replaceChildren();
  }
  if (previous && previous.phase !== snapshot.phase && snapshot.phase === 'battle') {
    state.throwLockedUntil = 0;
  }

  $('battleScene').classList.toggle('hidden', quizVisible);
  $('quizScene').classList.toggle('hidden', !quizVisible);
  $('battleBadge').textContent = snapshot.stageLabel
    ? `${snapshot.stageLabel}${snapshot.stageCount > 1 ? ` · ${snapshot.stageNumber}/${snapshot.stageCount}` : ''}`
    : '作战中';

  const inBattle = snapshot.phase === 'battle';
  $$('.item-btn').forEach((button) => {
    button.classList.toggle('dock-disabled', !inBattle || snapshot.paused);
  });
  $('itemDock').classList.toggle('dock-locked', !inBattle || snapshot.paused);

  if (snapshot.phase === 'battle') {
    renderSplats(snapshot);
    $('wipeHint').classList.toggle(
      'hidden',
      !snapshot.splats?.length || state.hasWipedOnce || snapshot.paused,
    );
  } else {
    clearSplatLayer();
    $('wipeHint').classList.add('hidden');
  }

  renderStageIntro(snapshot);
  renderPauseOverlay(snapshot);
  if (snapshot.phase === 'quiz') renderQuiz(snapshot);
  if (snapshot.phase !== 'quiz') resetLiveQuizVisuals();
}

function renderStageIntro(snapshot) {
  const overlay = $('stageIntroOverlay');
  if (snapshot.phase !== 'intro' || !snapshot.intro) {
    overlay.classList.add('hidden');
    state.introKey = null;
    return;
  }
  overlay.classList.remove('hidden');
  const key = `${snapshot.code}:${snapshot.stageIndex}:${snapshot.stageType}`;
  if (state.introKey !== key) {
    state.introKey = key;
    $('stageIntroKicker').textContent = snapshot.stageCount > 1
      ? `第 ${snapshot.stageNumber} / ${snapshot.stageCount} 幕`
      : '即将开战';
    $('stageIntroEmoji').textContent = snapshot.stageType === 'quiz' ? '🧠' : '💥';
    $('stageIntroTitle').textContent = snapshot.intro.title;
    $('stageIntroSub').textContent = snapshot.intro.subtitle;
    overlay.classList.remove('intro-pop');
    void overlay.offsetWidth;
    overlay.classList.add('intro-pop');
    sound.play(snapshot.stageType === 'quiz' ? 'ding' : 'count');
  }
}

function renderPauseOverlay(snapshot) {
  const overlay = $('pauseOverlay');
  if (!snapshot.paused) {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  const who = snapshot.pausedByName;
  $('pauseText').textContent = who
    ? `${who} 掉线了，比赛自动暂停。正在重连，稍等一下下…`
    : '有人掉线了，比赛自动暂停。正在重连，稍等一下下…';
}

function renderQuiz(snapshot) {
  const quiz = snapshot.quiz;
  if (!quiz || !quiz.question) return;
  const me = snapshot.players.find((p) => p.id === snapshot.me.id);
  const questionKey = `${snapshot.code}:${snapshot.stageIndex}:${quiz.qIndex}:${quiz.question.id}`;
  const isNewQuestion = state.quizKey !== questionKey;

  if (isNewQuestion) {
    state.quizKey = questionKey;
    state.quizChoice = null;
    state.grossKey = null;
    $('quizGrossLayer').replaceChildren();
    $('quizBanner').classList.add('hidden');
    $('quizBanner').className = 'quiz-banner hidden';
    $('quizQuestion').textContent = quiz.question.text;
    $('quizChip').textContent = `默契题 ${quiz.qNumber}/${quiz.total}`;
    buildQuizOptions(quiz.question, questionKey);
  }

  $('quizChip').textContent = `默契题 ${quiz.qNumber}/${quiz.total}`;
  if ($('quizQuestion').textContent !== quiz.question.text) {
    $('quizQuestion').textContent = quiz.question.text;
  }
  $('quizProgressFill').style.width = `${(quiz.qNumber / quiz.total) * 100}%`;

  const myAnswer = quiz.answered.find((a) => a.id === snapshot.me.id);
  const otherAnswer = quiz.answered.find((a) => a.id !== snapshot.me.id);
  const myAnswered = Boolean(myAnswer?.answered) || state.quizChoice !== null;
  const bothAnswered = quiz.answered.every((a) => a.answered);

  const options = $$('.quiz-option', $('quizOptions'));

  options.forEach((button, index) => {
    button.classList.remove('is-selected', 'is-correct', 'is-picked');
    $$('.pick-tag', button).forEach((tag) => tag.remove());
    const chosenBy = quiz.revealed
      ? quiz.reveal?.choices?.filter((choice) => choice.choice === index) || []
      : [];
    const selected = state.quizChoice === index || chosenBy.some((choice) => choice.playerId === snapshot.me.id);
    if (selected) button.classList.add('is-selected');
    if (quiz.revealed && quiz.reveal?.matched && chosenBy.length) button.classList.add('is-correct');
    if (quiz.revealed && !quiz.reveal?.matched && chosenBy.length) button.classList.add('is-picked');

    for (const choice of chosenBy) {
      const tag = document.createElement('span');
      tag.className = 'pick-tag';
      const player = snapshot.players.find((p) => p.id === choice.playerId);
      tag.textContent = `${player?.id === snapshot.me.id ? '你' : player?.name || '对方'} `;
      tag.prepend(document.createTextNode(escapeEmoji(player?.avatar, '🤢')));
      button.append(tag);
    }

    button.disabled =
      quiz.revealed ||
      myAnswered ||
      snapshot.paused ||
      state.quizChoice !== null ||
      Boolean(myAnswer?.answered);
  });

  const waiting = $('quizWaiting');
  if (quiz.revealed) {
    waiting.classList.add('hidden');
  } else {
    waiting.classList.remove('hidden');
    let waitingText;
    if (bothAnswered) waitingText = '双方都选好了，答案锁定…';
    else if (myAnswered) waitingText = '已锁定！等对方做决定…';
    else if (otherAnswer?.answered) waitingText = '对方选好了，就差你！';
    else waitingText = '等双方同时作答…';
    $('quizWaitingText').textContent = snapshot.paused ? '比赛暂停中…' : waitingText;
  }

  const revealKey = `${questionKey}:reveal`;
  if (quiz.revealed && quiz.reveal && state.grossKey !== revealKey) {
    state.grossKey = revealKey;
    renderQuizReveal(quiz, snapshot, me);
  }
}

function buildQuizOptions(question, questionKey) {
  const container = $('quizOptions');
  container.replaceChildren();
  const letters = ['A', 'B', 'C', 'D'];
  question.options.forEach((option, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiz-option';
    button.dataset.choice = String(index);
    button.innerHTML = `
      <span class="option-letter">${letters[index] || index + 1}</span>
      <span class="option-text">${escapeText(option)}</span>
      <span class="option-mark">✓</span>
    `;
    button.addEventListener('click', () => chooseQuizAnswer(index, question.id, questionKey));
    container.append(button);
  });
}

function chooseQuizAnswer(index, questionId, questionKey) {
  if (state.quizChoice !== null) return;
  const snapshot = state.snapshot;
  if (!snapshot || snapshot.phase !== 'quiz' || snapshot.paused) return;
  if (state.quizKey !== questionKey) return;
  const quiz = snapshot.quiz;
  if (!quiz || quiz.revealed) return;
  const myAnswer = quiz.answered.find((a) => a.id === snapshot.me.id);
  if (myAnswer?.answered) return;
  state.quizChoice = index;
  sound.play('click');
  const option = $$('.quiz-option', $('quizOptions'))[index];
  if (option) {
    option.classList.add('is-selected');
    option.disabled = true;
  }
  $('quizWaiting').classList.remove('hidden');
  $('quizWaitingText').textContent = '已锁定！等对方做决定…';
  state.realtime?.send({ type: 'quizAnswer', questionId, choice: index });
}

function renderQuizReveal(quiz, snapshot, me) {
  const banner = $('quizBanner');
  const matched = Boolean(quiz.reveal?.matched);
  banner.className = `quiz-banner ${matched ? 'is-match' : 'is-miss'}`;
  banner.replaceChildren();
  const emoji = document.createElement('span');
  emoji.className = 'banner-big-emoji';
  emoji.textContent = matched ? '💞' : '💔';
  const copy = document.createElement('span');
  copy.className = 'banner-copy';
  const strong = document.createElement('strong');
  strong.textContent = matched ? '默契 +1！' : '没有默契了！';
  const small = document.createElement('span');
  if (matched) {
    small.textContent = `你们都选了「${quiz.reveal?.matchedOption || ''}」`;
  } else {
    const parts = (quiz.reveal?.choices || []).map(
      (choice) => `${choice.playerId === snapshot.me.id ? '你' : choice.name}选了「${choice.choiceText}」`,
    );
    small.textContent = `${parts.join('，')}。两边都被糊了！`;
  }
  copy.append(strong, small);
  banner.append(emoji, copy);

  const gross = $('quizGrossLayer');
  gross.replaceChildren();
  if (!matched) {
    for (const splat of quiz.selfSplats || []) {
      gross.append(createSplatElement(splat, { gross: true }));
    }
    const label = document.createElement('div');
    label.className = 'gross-penalty-label';
    label.textContent = '没有默契惩罚：两边一起被糊！';
    gross.append(label);
    addShake($('quizScene'), 'fx-shake', 500);
    spawnEmojiRain(gross, ['😭', '💔', '😱', '🧦', '🍅', '💨'], 22);
    try {
      navigator.vibrate?.([40, 40, 80]);
    } catch {
      /* ignore */
    }
  } else {
    spawnEmojiRain(gross, ['💚', '💞', '✨', '🎉'], 16);
    spawnHearts($('quizScene'), 8);
  }
}

function resetLiveQuizVisuals() {
  if (state.snapshot?.phase === 'quiz') return;
  state.quizKey = null;
  state.quizChoice = null;
  state.grossKey = null;
  $('quizGrossLayer').replaceChildren();
  $('quizBanner').classList.add('hidden');
  $('quizWaiting').classList.add('hidden');
}

function resetQuizUi() {
  state.quizKey = null;
  state.quizChoice = null;
  state.grossKey = null;
  $('quizGrossLayer')?.replaceChildren();
  $('quizOptions')?.replaceChildren();
  $('quizBanner')?.classList.add('hidden');
  $('quizWaiting')?.classList.add('hidden');
}

// ---------------------------------------------------------------- battle splats
function createSplatElement(splat, { gross = false } = {}) {
  const item = ITEM_MAP[splat.itemId] || ITEMS[0];
  const element = document.createElement('div');
  element.className = `splat ${gross ? 'gross-splat' : ''} shape-${Math.abs(splat.shape || 0) % SHAPES.length}`;
  element.dataset.id = splat.id;
  element.dataset.hp = String(splat.hp || 1);
  element.setAttribute('aria-hidden', 'true');
  element.style.left = `${(splat.x ?? 0.5) * 100}%`;
  element.style.top = `${(splat.y ?? 0.5) * 100}%`;
  element.style.setProperty('--size', String(splat.size || 18));
  element.style.setProperty('--rot', `${splat.rot || 0}deg`);
  element.style.setProperty('--stretch', String(splat.stretch || 1));
  element.style.setProperty('--splat-color', item.color);
  element.style.setProperty('--splat-dark', item.dark);
  element.style.setProperty('--blob-shape', SHAPES[Math.abs(splat.shape || 0) % SHAPES.length]);

  const inner = document.createElement('div');
  inner.className = 'splat-inner';
  const blob = document.createElement('div');
  blob.className = 'splat-blob';
  const shine = document.createElement('i');
  shine.className = 'splat-shine';
  blob.append(shine);
  const emoji = document.createElement('span');
  emoji.className = 'splat-emoji';
  emoji.textContent = item.emoji;
  const drips = document.createElement('span');
  drips.className = 'splat-drips';
  for (let i = 0; i < 3; i += 1) {
    const drip = document.createElement('i');
    drips.append(drip);
  }
  inner.append(blob, drips, emoji);
  if ((splat.hp || 1) > 1 && !gross) {
    const hp = document.createElement('span');
    hp.className = 'splat-hp';
    hp.textContent = `黏！擦×${splat.hp}`;
    inner.append(hp);
  }
  element.append(inner);
  return element;
}

function renderSplats(snapshot) {
  const layer = $('splatLayer');
  const splats = Array.isArray(snapshot.splats) ? snapshot.splats : [];
  const serverIds = new Set(splats.map((s) => s.id));

  for (const [id, record] of state.splatEls) {
    if (!serverIds.has(id)) {
      record.el.remove();
      state.splatEls.delete(id);
      state.pendingWipes.delete(id);
    }
  }

  for (const splat of splats) {
    if (state.pendingWipes.has(splat.id)) {
      const record = state.splatEls.get(splat.id);
      if (record) record.el.classList.add('splat-gone');
      continue;
    }
    let record = state.splatEls.get(splat.id);
    if (!record) {
      const el = createSplatElement(splat);
      layer.append(el);
      record = { el, hp: splat.hp };
      state.splatEls.set(splat.id, record);
    }
    record.hp = splat.hp;
    if (record.el.dataset.hp !== String(splat.hp)) {
      record.el.dataset.hp = String(splat.hp);
      const hp = record.el.querySelector('.splat-hp');
      if (hp) hp.textContent = `黏！擦×${splat.hp}`;
      if (splat.hp > 1 && !hp) {
        const label = document.createElement('span');
        label.className = 'splat-hp';
        label.textContent = `黏！擦×${splat.hp}`;
        record.el.querySelector('.splat-inner')?.append(label);
      }
      record.el.classList.remove('splat-hit');
      void record.el.offsetWidth;
      record.el.classList.add('splat-hit');
    }
  }
}

function clearSplatLayer() {
  $('splatLayer')?.replaceChildren();
  state.splatEls.clear();
  state.pendingWipes.clear();
  state.wipeCooldowns.clear();
}

function bindWipeEvents() {
  const field = $('battleField');
  let wiping = false;

  const start = (event) => {
    const snapshot = state.snapshot;
    if (!snapshot || snapshot.phase !== 'battle' || snapshot.paused) return;
    wiping = true;
    try {
      field.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    wipeAt(event.clientX, event.clientY);
  };
  const move = (event) => {
    if (!wiping) return;
    wipeAt(event.clientX, event.clientY);
  };
  const end = () => {
    wiping = false;
  };

  field.addEventListener('pointerdown', start);
  field.addEventListener('pointermove', move);
  field.addEventListener('pointerup', end);
  field.addEventListener('pointercancel', end);
  field.addEventListener('pointerleave', (event) => {
    if (event.buttons === 0) end();
  });
  field.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('blur', () => end());
}

function wipeAt(clientX, clientY) {
  const snapshot = state.snapshot;
  if (!snapshot || snapshot.phase !== 'battle' || snapshot.paused) return;
  const now = performance.now();
  if (now - state.lastWipeAt < 70) return;
  state.lastWipeAt = now;

  const field = $('battleField');
  const rect = field.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const vmin = Math.min(window.innerWidth, window.innerHeight);
  const hitIds = [];
  const normalIds = [];

  for (const splat of snapshot.splats || []) {
    const record = state.splatEls.get(splat.id);
    if (!record || state.pendingWipes.has(splat.id)) continue;
    const centerX = rect.left + splat.x * rect.width;
    const centerY = rect.top + splat.y * rect.height;
    const radius = ((splat.size || 18) / 100) * vmin * 0.55;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    if (dx * dx + dy * dy > radius * radius) continue;
    const last = state.wipeCooldowns.get(splat.id) || 0;
    if (now - last < 170) continue;
    state.wipeCooldowns.set(splat.id, now);
    hitIds.push(splat.id);
    if ((splat.hp || 1) <= 1) {
      normalIds.push(splat.id);
      state.pendingWipes.set(splat.id, performance.now());
      record.el.classList.add('splat-gone');
      setTimeout(() => {
        state.pendingWipes.delete(splat.id);
        if (state.snapshot?.phase === 'battle') renderSplats(state.snapshot);
      }, 1400);
    } else {
      record.el.classList.remove('splat-hit');
      void record.el.offsetWidth;
      record.el.classList.add('splat-hit');
    }
  }

  if (!hitIds.length) return;
  state.hasWipedOnce = true;
  $('wipeHint').classList.add('hidden');
  state.realtime?.send({ type: 'wipe', ids: hitIds });
  state.lastWipeSoundAt = state.lastWipeSoundAt || 0;
  if (now - state.lastWipeSoundAt > 100) {
    state.lastWipeSoundAt = now;
    sound.play('wipe');
  }
  if (normalIds.length) {
    spawnWipePuff(clientX, clientY);
    try {
      navigator.vibrate?.(12);
    } catch {
      /* ignore */
    }
  }
}

function spawnWipePuff(x, y) {
  const puff = document.createElement('span');
  puff.className = 'wipe-puff';
  puff.textContent = '擦！';
  puff.style.left = `${x}px`;
  puff.style.top = `${y}px`;
  document.body.append(puff);
  setTimeout(() => puff.remove(), 550);
}

function throwItem(item, button) {
  const snapshot = state.snapshot;
  if (!snapshot || snapshot.phase !== 'battle') {
    toast('等战斗开始再丢', 'info', 1400);
    return;
  }
  if (snapshot.paused) {
    toast('比赛暂停中，等对方重连', 'warn', 1600);
    return;
  }
  const now = Date.now();
  if (now < state.throwLockedUntil) return;
  state.throwLockedUntil = now + (snapshot.config?.throwCooldownMs || 320);
  sound.play('throw');
  button.classList.remove('item-cooling');
  void button.offsetWidth;
  button.classList.add('item-cooling');
  setTimeout(() => button.classList.remove('item-cooling'), 320);
  spawnThrowFly(item);
  const sent = state.realtime?.send({ type: 'throw', itemId: item.id });
  if (sent === false) state.throwLockedUntil = 0;
}

function spawnThrowFly(item) {
  if (reduceMotion) return;
  const fly = document.createElement('span');
  fly.className = 'throw-fly';
  fly.textContent = item.emoji;
  fly.style.left = `${18 + Math.random() * 64}%`;
  document.body.append(fly);
  setTimeout(() => fly.remove(), 700);
}

// ---------------------------------------------------------------- result
function renderResult(snapshot) {
  showScreen('result');
  const result = snapshot.result;
  if (!result) return;
  const me = snapshot.players.find((p) => p.id === snapshot.me.id);
  const winner = result.players.find((p) => p.id === result.winnerId);
  const loser = result.players.find((p) => p.id === result.loserId);
  const iWon = !result.tie && result.winnerId === snapshot.me.id;
  const iLost = !result.tie && result.loserId === snapshot.me.id;
  const resultKey = `${snapshot.code}:${result.finishedAt}`;

  $('resultEyebrow').textContent = `本局战报 · ${MODE_INFO[result.mode]?.name || '恶心对决'} · ${
    result.tie ? '平局' : iWon ? '胜利' : '惜败'
  }`;
  $('resultTitle').textContent = result.tie
    ? '臭味相投，平局！'
    : iWon
      ? '你赢了！'
      : iLost
        ? '你被腌入味了'
        : '本局战报';
  $('resultSubtitle').textContent = result.tie
    ? '连胜负都分不出来，也算另一种默契。'
    : iWon
      ? `荣获「${result.winnerTitle}」，建议对方先去洗个澡。`
      : iLost
        ? `喜提「${result.loserTitle}」，这味道一时半会儿散不掉。`
        : '';
  $('resultMascot').textContent = result.tie ? '🤝' : iWon ? '🏆' : '💩';

  if (state.resultKey !== resultKey) {
    state.resultKey = resultKey;
    $('syncIndex').textContent = `${result.syncIndex}%`;
    $('syncGauge').style.setProperty('--pct', String(result.syncIndex));
    $('syncGauge').classList.toggle('is-high', result.syncIndex >= 90);
    $('syncGauge').classList.toggle('is-low', result.syncIndex <= 30);
    $('verdictTitle').textContent = `${result.verdict.emoji} ${result.verdict.title}`;
    $('verdictSub').textContent = result.verdict.sub;
    $('syncBreakdown').innerHTML = `
      <span><b>${result.quizMatches}/${result.quizTotal}</b> 默契题</span>
      <span><b>${result.battleSyncs}</b> 次同步投掷</span>
    `;
    renderScoreboard(result, snapshot);
    spawnConfetti(result, iWon);
  }

  const myVote = Boolean(me?.rematch);
  const votes = snapshot.players.filter((p) => p.rematch).length;
  const otherVote = snapshot.players.some((p) => p.id !== snapshot.me.id && p.rematch);
  const rematchBtn = $('rematchBtn');
  rematchBtn.disabled = myVote;
  rematchBtn.querySelector('span').textContent = myVote ? `已举手 ${votes}/2` : '再来一局';
  $('rematchHint').textContent = myVote
    ? '等对方也按下再来一局…'
    : otherVote
      ? '对方已经举手了，就差你了！'
      : '双方都按下就重开';
  $('toLobbyBtn').classList.toggle('hidden', !snapshot.isHost);
}

function renderScoreboard(result, snapshot) {
  const container = $('resultScoreboard');
  container.replaceChildren();
  const rankClass = (player) => {
    if (result.tie) return 'is-tie';
    if (player.id === result.winnerId) return 'is-winner';
    return 'is-loser';
  };
  result.players.forEach((player) => {
    const card = document.createElement('div');
    const isMe = player.id === snapshot.me.id;
    card.className = `score-card ${rankClass(player)} ${isMe ? 'is-me' : ''}`;
    const title = result.tie ? result.winnerTitle : player.id === result.winnerId ? result.winnerTitle : result.loserTitle;
    const titleLabel = result.tie ? '双黄蛋' : player.id === result.winnerId ? '胜者' : '败者';
    card.innerHTML = `
      <div class="score-card-top">
        <span class="score-avatar">${escapeEmoji(player.avatar)}</span>
        <div class="score-name">
          <strong>${escapeText(player.name)}${isMe ? ' <em>你</em>' : ''}</strong>
          <span>${titleLabel} · ${escapeText(title)}</span>
        </div>
        <strong class="final-score">${player.score}</strong>
      </div>
      <div class="score-breakdown">
        <span><b>${player.hits}</b> 发命中</span>
        <span><b>${player.peakCoverPercent}%</b> 最高糊屏</span>
        <span><b>${player.quizMatches}</b> 默契题</span>
        <span><b>${player.wiped}</b> 坨擦掉</span>
      </div>
      <div class="score-formula">糊脸分 ${player.battlePoints} + 糊屏 ${Math.round(player.peakCoverPercent)} + 默契 ${
        player.quizMatches * 25
      } + 手速 ${player.speedPoints}</div>
    `;
    container.append(card);
  });
}

function spawnConfetti(result, iWon) {
  const layer = $('confettiLayer');
  layer.replaceChildren();
  const emojis = iWon
    ? ['🎉', '🏆', '💚', '🧦', '🤢', '✨']
    : result.tie
      ? ['🤝', '🤢', '💚', '✨']
      : ['💩', '🧦', '🍅', '😭', '💨'];
  const count = reduceMotion ? 8 : 42;
  for (let i = 0; i < count; i += 1) {
    const span = document.createElement('span');
    span.className = 'confetti';
    span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    span.style.left = `${Math.random() * 100}%`;
    span.style.setProperty('--fall-delay', `${Math.random() * 1.4}s`);
    span.style.setProperty('--fall-duration', `${2.2 + Math.random() * 2.4}s`);
    span.style.setProperty('--drift', `${-70 + Math.random() * 140}px`);
    span.style.fontSize = `${16 + Math.random() * 26}px`;
    layer.append(span);
  }
}

// ---------------------------------------------------------------- events & effects
function handleEvent(event) {
  if (!event || !event.type) return;
  switch (event.type) {
    case 'throw': {
      const item = event.item || {};
      if (event.targetId === state.playerId) {
        feed(`${event.fromName} 丢来 ${item.emoji || '🗑️'} ${item.name || '垃圾'}！快擦！`, 'incoming');
        applyIncomingItem(item);
        try {
          navigator.vibrate?.(35);
        } catch {
          /* ignore */
        }
      } else if (event.fromId === state.playerId) {
        feed(`你丢出 ${item.emoji || '🗑️'} ${item.name || '垃圾'}，正中对方屏幕`, 'outgoing');
      }
      break;
    }
    case 'sync':
      feed(`✨ 居然有默契！你们同时丢了 ${event.emoji || '🗑️'}`, 'sync');
      showSyncBurst(event);
      sound.play('sync');
      spawnEmojiRain($('gameScreen'), ['💚', '✨', '🤝', '🤢'], 14);
      break;
    case 'wipe':
      if (event.byId === state.playerId) {
        if (event.removed?.length) sound.play('wipe');
      } else if (event.removed?.length) {
        feed(`🧽 对方擦掉了 ${event.removed.length} 坨`, 'info');
      }
      break;
    case 'quizAnswer':
      if (event.playerId !== state.playerId) {
        $('quizWaitingText').textContent = '对方已作答…';
      }
      break;
    case 'quizReveal':
      if (event.matched) {
        sound.play('celebrate');
      } else {
        sound.play('sad');
      }
      break;
    case 'quizQuestion':
      sound.play('ding');
      break;
    case 'quizTimeout':
      toast('有人没来得及作答，默契测试失败！', 'warn', 2400);
      break;
    case 'quizLocked':
      sound.play('ding');
      break;
    case 'stageStart':
      if (event.stageType === 'battle') {
        toast(event.stageIndex > 0 ? '继续互糊！' : '开战！把对方糊成抽象画', 'info', 2200);
      } else {
        toast('默契时间到，同时作答！', 'info', 2200);
      }
      break;
    case 'stageEnd':
      if (event.stageType === 'battle') {
        toast('回合结束，看看谁更脏', 'info', 2200);
      }
      break;
    case 'matchStart':
      state.resultKey = null;
      state.hasWipedOnce = false;
      $('comboFeed').replaceChildren();
      resetQuizUi();
      break;
    case 'result':
      if (event.result?.tie) sound.play('ding');
      else if (event.result?.winnerId === state.playerId) sound.play('celebrate');
      else sound.play('sad');
      break;
    case 'presence':
      if (event.joined) toast(`${event.name || '对手'} 混进房间了`, 'success');
      else if (event.connected === false && event.paused) {
        toast(`${event.name || '对手'} 掉线了，比赛暂停`, 'warn', 3200);
      } else if (event.rejoined) {
        toast(`${event.name || '对手'} 杀回来了！`, 'success');
      }
      break;
    case 'resume':
      toast('重新连上了，继续互相恶心！', 'success', 2200);
      break;
    case 'rematch':
      if (event.playerId !== state.playerId) {
        toast(`${event.name || '对方'} 想再来一局（${event.votes}/${event.needed}）`, 'info', 2400);
        sound.play('ding');
      }
      break;
    case 'mode': {
      if (event.playerId !== state.playerId) {
        const modeName = MODE_INFO[event.mode]?.name;
        if (modeName) toast(`${event.name || '对方'} 把模式换成了「${modeName}」`, 'info', 2000);
      }
      break;
    }
    case 'toLobby':
      toast('房主带大家回大厅了', 'info');
      break;
    case 'error':
      toast(event.message || '操作没成功', 'warn');
      break;
    default:
      break;
  }
}

function feed(text, tone = 'info') {
  const feedEl = $('comboFeed');
  const line = document.createElement('div');
  line.className = `feed-line feed-${tone}`;
  line.textContent = text;
  feedEl.append(line);
  while (feedEl.children.length > 4) feedEl.firstElementChild.remove();
  setTimeout(() => {
    line.classList.add('feed-out');
    setTimeout(() => line.remove(), 260);
  }, 2600);
}

function applyIncomingItem(item) {
  const stage = $('battleStage');
  switch (item.effect) {
    case 'fart':
      sound.play('fart');
      addShake(stage, 'fx-shake-hard', 520);
      $('stinkLayer').classList.add('stink-active');
      setTimeout(() => $('stinkLayer').classList.remove('stink-active'), 1600);
      break;
    case 'flip':
      sound.play('flip');
      if (!reduceMotion) {
        stage.classList.add('fx-flip');
        setTimeout(() => stage.classList.remove('fx-flip'), 2000);
      } else {
        addShake(stage, 'fx-wobble', 400);
      }
      toast('你的屏幕被倒过来了！', 'warn', 1600);
      break;
    case 'roach':
      sound.play('roach');
      spawnRoach();
      toast('假蟑螂出没！别打屏幕！', 'warn', 2000);
      break;
    case 'stink':
      sound.play('splat');
      $('stinkLayer').classList.add('stink-active');
      setTimeout(() => $('stinkLayer').classList.remove('stink-active'), 1400);
      addShake(stage, 'fx-wobble', 400);
      break;
    case 'jiggle':
      sound.play('splat');
      addShake(stage, 'fx-jiggle', 500);
      break;
    case 'sticky':
      sound.play('splat');
      addShake(stage, 'fx-wobble', 300);
      break;
    case 'splat':
    default:
      sound.play('splat');
      addShake(stage, 'fx-shake', 300);
      break;
  }
}

function addShake(element, className, ms) {
  if (!element || reduceMotion) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  setTimeout(() => element.classList.remove(className), ms);
}

function spawnRoach() {
  if (reduceMotion) return;
  const layer = $('roachLayer');
  for (let i = 0; i < 2; i += 1) {
    const roach = document.createElement('span');
    roach.className = 'roach-runner';
    roach.textContent = '🪳';
    roach.style.setProperty('--start-y', `${20 + Math.random() * 55}%`);
    roach.style.setProperty('--end-y', `${20 + Math.random() * 55}%`);
    roach.style.setProperty('--roach-delay', `${i * 0.18}s`);
    roach.style.setProperty('--roach-size', `${30 + Math.random() * 20}px`);
    layer.append(roach);
    setTimeout(() => roach.remove(), 2500);
  }
}

function showSyncBurst(event) {
  const burst = document.createElement('div');
  burst.className = 'sync-burst';
  burst.innerHTML = `
    <span class="sync-burst-item">${escapeEmoji(event.emoji, '✨')}</span>
    <strong>居然有默契！</strong>
    <span>同步丢出 ${escapeText(event.itemName || '同款垃圾')} · +${event.bonus || 0} 分</span>
  `;
  $('gameScreen').append(burst);
  setTimeout(() => burst.remove(), 2200);
}

function spawnEmojiRain(container, emojis, count) {
  if (!container) return;
  const actual = reduceMotion ? Math.min(6, count) : count;
  for (let i = 0; i < actual; i += 1) {
    const span = document.createElement('span');
    span.className = 'emoji-rain';
    span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    span.style.left = `${Math.random() * 94}%`;
    span.style.setProperty('--rain-delay', `${Math.random() * 0.8}s`);
    span.style.setProperty('--rain-duration', `${1.6 + Math.random() * 1.4}s`);
    span.style.fontSize = `${16 + Math.random() * 22}px`;
    container.append(span);
    setTimeout(() => span.remove(), 3600);
  }
}

function spawnHearts(container, count) {
  if (!container) return;
  for (let i = 0; i < count; i += 1) {
    const heart = document.createElement('span');
    heart.className = 'heart-pop';
    heart.textContent = ['💚', '💞', '✨', '🫶'][i % 4];
    heart.style.left = `${15 + Math.random() * 70}%`;
    heart.style.top = `${25 + Math.random() * 45}%`;
    heart.style.setProperty('--heart-delay', `${Math.random() * 0.5}s`);
    container.append(heart);
    setTimeout(() => heart.remove(), 2200);
  }
}

// ---------------------------------------------------------------- clock
function tick() {
  const snapshot = state.snapshot;
  if (!snapshot || !['intro', 'battle', 'quiz'].includes(snapshot.phase)) return;
  const countdown = state.countdown;
  const elapsed = countdown.paused ? 0 : performance.now() - countdown.at;
  const remaining = Math.max(0, countdown.remainingMs - elapsed);
  const seconds = Math.ceil(remaining / 1000);
  const percent = countdown.totalMs > 0 ? Math.max(0, Math.min(100, (remaining / countdown.totalMs) * 100)) : 0;

  $('timerNum').textContent = String(seconds).padStart(2, '0');
  $('timerFill').style.width = `${percent}%`;
  $('timerFill').classList.toggle('timer-low', remaining <= 10000 && countdown.kind === 'battle');
  $('timerFill').classList.toggle('timer-paused', countdown.paused);

  if (snapshot.phase === 'intro') {
    $('stageIntroCount').textContent = String(Math.max(1, Math.ceil(remaining / 1000)));
    $('stageIntroRing').style.setProperty('--pct', String(Math.max(0, percent)));
  }
  if (snapshot.phase === 'quiz' && snapshot.quiz) {
    $('quizClock').textContent = snapshot.quiz.revealed
      ? `${(remaining / 1000).toFixed(1)}s`
      : `${Math.ceil(remaining / 1000)}s`;
    $('quizClock').classList.toggle('is-urgent', remaining < 3000 && !snapshot.quiz.revealed);
    $('quizProgressFill').style.width = `${(snapshot.quiz.qNumber / snapshot.quiz.total) * 100}%`;
    if (remaining <= 0 && !snapshot.quiz.revealed) {
      $('quizWaitingText').textContent = '时间到，正在揭晓…';
    }
  }
}

init();

