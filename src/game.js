import crypto from 'node:crypto';
import { ITEM_MAP, ITEMS, PLAYER_AVATARS } from '../shared/catalog.js';
import { QUESTIONS } from './questions.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ACTIVE_PHASES = new Set(['intro', 'battle', 'quiz']);
const MODES = new Set(['battle', 'quiz', 'mixed']);

export class GameError extends Error {
  constructor(message, status = 400, code = 'BAD_ACTION') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function randHex(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

function token() {
  return crypto.randomBytes(24).toString('base64url');
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanName(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  const name = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
  return name || fallback;
}

function publicSplat(splat) {
  return {
    id: splat.id,
    itemId: splat.itemId,
    byId: splat.byId,
    x: splat.x,
    y: splat.y,
    size: splat.size,
    rot: splat.rot,
    stretch: splat.stretch,
    shape: splat.shape,
    hp: splat.hp,
    cover: splat.cover,
    createdAt: splat.createdAt,
  };
}

export class GameManager {
  constructor(config) {
    this.config = config;
    this.rooms = new Map();
    this.tokenIndex = new Map();
    this.tickTimer = setInterval(() => this.tickAll(), 150);
    this.presenceTimer = setInterval(() => this.presenceSweep(), 1000);
    this.cleanupTimer = setInterval(() => this.cleanupRooms(), 60000);
    this.tickTimer.unref?.();
    this.presenceTimer.unref?.();
    this.cleanupTimer.unref?.();
  }

  health() {
    return {
      ok: true,
      rooms: this.rooms.size,
      players: this.tokenIndex.size,
      uptime: Math.round(process.uptime()),
    };
  }

  createRoom(rawName) {
    const code = this.makeRoomCode();
    const player = this.makePlayer('A', rawName, '臭屁王');
    const room = {
      code,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      hostId: player.id,
      mode: 'battle',
      phase: 'lobby',
      players: [player],
      cursor: 0,
      events: [],
      pollWaiters: new Set(),
      pausedAt: null,
      pausedBy: null,
      stageIndex: -1,
      sequence: [],
      stageIntro: null,
      stage: null,
      match: null,
      result: null,
    };
    this.rooms.set(code, room);
    this.tokenIndex.set(player.token, { code, playerId: player.id });
    return { room, player, snapshot: this.buildSnapshot(room, player) };
  }

  joinRoom(rawCode, rawName) {
    const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = this.rooms.get(code);
    if (!room) throw new GameError('房间不存在，检查一下房间码？', 404, 'ROOM_NOT_FOUND');
    if (room.players.length >= 2) {
      throw new GameError('这个房间已经满员啦，去开个新房间吧', 409, 'ROOM_FULL');
    }
    if (room.phase !== 'lobby') {
      throw new GameError('这局已经开始了，等等下一局吧', 409, 'ROOM_STARTED');
    }
    const player = this.makePlayer('B', rawName, '臭豆腐侠');
    room.players.push(player);
    room.lastActivityAt = Date.now();
    this.tokenIndex.set(player.token, { code, playerId: player.id });
    this.publish(room, {
      type: 'presence',
      playerId: player.id,
      name: player.name,
      slot: player.slot,
      connected: true,
      joined: true,
    });
    this.broadcastState(room);
    return { room, player, snapshot: this.buildSnapshot(room, player) };
  }

  getSession(rawToken) {
    const found = this.findPlayer(rawToken);
    if (!found) throw new GameError('连接已失效，请重新进入房间', 401, 'BAD_TOKEN');
    return { room: found.room, player: found.player, snapshot: this.buildSnapshot(found.room, found.player) };
  }

  attachSocket(rawToken, ws) {
    const found = this.findPlayer(rawToken);
    if (!found) throw new GameError('连接已失效，请重新进入房间', 401, 'BAD_TOKEN');
    const { room, player } = found;
    if (player.ws && player.ws !== ws) {
      try {
        player.ws.close(4000, 'replaced');
      } catch {
        /* ignore */
      }
    }
    const wasOffline = !player.connected;
    player.ws = ws;
    player.channel = 'ws';
    player.connected = true;
    player.lastSeen = Date.now();
    player.lastPollAt = Date.now();
    const resumed = this.maybeResume(room);
    return {
      room,
      player,
      wasOffline,
      resumed,
      snapshot: this.buildSnapshot(room, player),
      cursor: room.cursor,
    };
  }

  afterAttach(room, player, wasOffline) {
    if (wasOffline) {
      this.publish(room, {
        type: 'presence',
        playerId: player.id,
        name: player.name,
        slot: player.slot,
        connected: true,
        rejoined: true,
      });
    }
    this.broadcastState(room);
  }

  detachSocket(rawToken, ws) {
    const found = this.findPlayer(rawToken);
    if (!found) return;
    const { room, player } = found;
    if (player.ws !== ws) return;
    player.ws = null;
    if (player.channel === 'ws') {
      this.markOffline(room, player, 'socket_closed');
    }
  }

  markPoll(rawToken) {
    const found = this.findPlayer(rawToken);
    if (!found) throw new GameError('连接已失效，请重新进入房间', 401, 'BAD_TOKEN');
    const { room, player } = found;
    const wasOffline = !player.connected;
    const switched = player.channel !== 'poll';
    if (player.ws) {
      const old = player.ws;
      player.ws = null;
      try {
        old.close(4002, 'polling');
      } catch {
        /* ignore */
      }
    }
    player.connected = true;
    player.channel = 'poll';
    player.lastSeen = Date.now();
    player.lastPollAt = Date.now();
    this.maybeResume(room);
    if (wasOffline) {
      this.publish(room, {
        type: 'presence',
        playerId: player.id,
        name: player.name,
        slot: player.slot,
        connected: true,
        rejoined: true,
        transport: 'poll',
      });
      this.broadcastState(room);
    } else if (switched) {
      this.broadcastState(room);
    }
    return found;
  }

  async poll(rawToken, sinceRaw) {
    const { room, player } = this.markPoll(rawToken);
    const since = Math.max(0, Number.parseInt(sinceRaw, 10) || 0);
    const immediate = this.buildPollPayload(room, player, since);
    const firstPoll = !player.pollDelivered;
    player.pollDelivered = true;
    if (firstPoll || immediate.events.length > 0) {
      return immediate;
    }
    return new Promise((resolve) => {
      const waiter = {
        room,
        player,
        since,
        resolve: (payload) => {
          clearTimeout(waiter.timer);
          resolve(payload);
        },
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        if (!room.pollWaiters.has(waiter)) return;
        room.pollWaiters.delete(waiter);
        waiter.resolve(this.buildPollPayload(room, player, since));
      }, this.config.pollTimeoutMs);
      waiter.timer.unref?.();
      room.pollWaiters.add(waiter);
    });
  }

  buildPollPayload(room, player, since) {
    const events = room.events.filter((event) => event.seq > since);
    return {
      events,
      cursor: room.cursor,
      truncated: room.events.length > 0 ? since < room.events[0].seq - 1 && since !== 0 : false,
      snapshot: this.buildSnapshot(room, player),
      transport: 'poll',
      serverNow: Date.now(),
    };
  }

  action(rawToken, action) {
    const found = this.findPlayer(rawToken);
    if (!found) throw new GameError('连接已失效，请刷新页面', 401, 'BAD_TOKEN');
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      throw new GameError('无效的操作', 400, 'BAD_ACTION');
    }
    const { room, player } = found;
    room.lastActivityAt = Date.now();
    player.lastSeen = Date.now();

    if (room.pausedAt && ['throw', 'wipe', 'quizAnswer'].includes(action.type)) {
      throw new GameError('对方掉线，比赛暂停中，等一下下～', 409, 'PAUSED');
    }

    switch (action.type) {
      case 'setMode':
        return this.setMode(room, player, action.mode);
      case 'start':
        return this.startRoom(room, player);
      case 'throw':
        return this.throwItem(room, player, action.itemId);
      case 'wipe':
        return this.wipeSplats(room, player, action.ids);
      case 'quizAnswer':
        return this.answerQuiz(room, player, action);
      case 'rematch':
        return this.voteRematch(room, player);
      case 'toLobby':
        return this.returnToLobby(room, player);
      case 'ping':
        return { ok: true };
      default:
        throw new GameError('未知操作', 400, 'UNKNOWN_ACTION');
    }
  }

  setMode(room, player, mode) {
    if (room.phase !== 'lobby') throw new GameError('现在不能切换模式', 409, 'BAD_PHASE');
    if (!MODES.has(mode)) throw new GameError('没有这个模式', 400, 'BAD_MODE');
    room.mode = mode;
    this.publish(room, {
      type: 'mode',
      mode,
      playerId: player.id,
      name: player.name,
    });
    this.broadcastState(room);
    return { ok: true, mode };
  }

  startRoom(room, player) {
    if (player.id !== room.hostId) throw new GameError('只有房主可以开始游戏', 403, 'NOT_HOST');
    if (room.phase !== 'lobby') throw new GameError('游戏已经开始了', 409, 'BAD_PHASE');
    if (room.players.length < 2) throw new GameError('还差一个敢玩的对手', 409, 'WAITING_PLAYER');
    if (room.players.some((p) => !p.connected)) {
      throw new GameError('等双方都连上再开战吧', 409, 'OPPONENT_OFFLINE');
    }
    this.startMatch(room);
    return { ok: true };
  }

  startMatch(room) {
    room.result = null;
    room.pausedAt = null;
    room.pausedBy = null;
    room.stage = null;
    room.stageIntro = null;
    room.match = {
      startedAt: Date.now(),
      battleSyncs: 0,
      quizTotal: 0,
      quizMatches: 0,
      lastSyncAt: 0,
      sequence: this.buildSequence(room.mode),
    };
    room.sequence = room.match.sequence;
    room.stageIndex = -1;
    for (const player of room.players) {
      player.rematch = false;
      player.hits = 0;
      player.battlePoints = 0;
      player.coverPercent = 0;
      player.peakCoverPercent = 0;
      player.wiped = 0;
      player.quizMatches = 0;
      player.speedPoints = 0;
      player.answeredCount = 0;
      player.answerTimeTotal = 0;
      player.syncMoments = 0;
      player.splats = [];
      player.lastThrowItem = null;
      player.lastThrowAt = 0;
      player.lastThrowServerAt = 0;
    }
    this.publish(room, { type: 'matchStart', mode: room.mode });
    this.goToStageIntro(room, 0);
  }

  buildSequence(mode) {
    if (mode === 'quiz') {
      return [{ type: 'quiz', label: '默契大考验', questions: this.config.quizQuestions }];
    }
    if (mode === 'mixed') {
      return [
        { type: 'battle', label: '第 1 回合' },
        { type: 'quiz', label: '默契时间', questions: this.config.mixedQuizQuestions },
        { type: 'battle', label: '终极回合' },
      ];
    }
    return [{ type: 'battle', label: '第 1 回合' }];
  }

  goToStageIntro(room, index) {
    const stageDef = room.sequence[index];
    if (!stageDef) {
      this.finishMatch(room);
      return;
    }
    room.stageIndex = index;
    room.phase = 'intro';
    room.stage = null;
    const intro = {
      type: stageDef.type,
      endsAt: Date.now() + this.config.stageIntroMs,
      title: stageDef.type === 'quiz' ? '默契大考验' : stageDef.label,
      subtitle:
        stageDef.type === 'quiz'
          ? '同时作答，看看你们的脑电波还通不通'
          : index === room.sequence.length - 1 && room.sequence.length > 1
            ? '最后一回合，把对方糊成抽象画！'
            : '抓住道具，往对方屏幕上糊！',
    };
    room.stageIntro = intro;
    this.publish(room, {
      type: 'stageIntro',
      stageIndex: index,
      stageCount: room.sequence.length,
      stageType: stageDef.type,
      title: intro.title,
      subtitle: intro.subtitle,
    });
    this.broadcastState(room);
  }

  beginStage(room) {
    const stageDef = room.sequence[room.stageIndex];
    if (!stageDef) {
      this.finishMatch(room);
      return;
    }
    room.stageIntro = null;
    if (stageDef.type === 'battle') {
      room.phase = 'battle';
      room.stage = {
        type: 'battle',
        endsAt: Date.now() + this.config.roundSeconds * 1000,
      };
      for (const player of room.players) {
        player.splats = [];
        player.lastThrowItem = null;
        player.lastThrowAt = 0;
        player.lastThrowServerAt = 0;
      }
      this.recomputeCovers(room);
      this.publish(room, {
        type: 'stageStart',
        stageIndex: room.stageIndex,
        stageType: 'battle',
        label: stageDef.label,
        endsAt: room.stage.endsAt,
      });
      this.broadcastState(room);
      return;
    }
    room.phase = 'quiz';
    room.stage = {
      type: 'quiz',
      questions: this.pickQuestions(room, stageDef.questions || this.config.quizQuestions),
      qIndex: 0,
      answers: {},
      questionStartedAt: 0,
      questionEndsAt: 0,
      revealAt: null,
      revealed: false,
      reveal: null,
      nextAt: null,
      selfSplats: { A: [], B: [] },
    };
    this.publish(room, {
      type: 'stageStart',
      stageIndex: room.stageIndex,
      stageType: 'quiz',
      label: stageDef.label,
    });
    this.startQuizQuestion(room);
  }

  pickQuestions(room, count) {
    return shuffle(QUESTIONS)
      .slice(0, Math.max(1, Math.min(count, QUESTIONS.length)))
      .map((q) => ({ id: q.id, text: q.text, options: [...q.options] }));
  }

  startQuizQuestion(room) {
    const stage = room.stage;
    stage.answers = {};
    stage.questionStartedAt = Date.now();
    stage.questionEndsAt = stage.questionStartedAt + this.config.quizSeconds * 1000;
    stage.revealAt = null;
    stage.revealed = false;
    stage.reveal = null;
    stage.nextAt = null;
    stage.selfSplats = { A: [], B: [] };
    this.publish(room, {
      type: 'quizQuestion',
      qIndex: stage.qIndex,
      total: stage.questions.length,
      questionId: stage.questions[stage.qIndex].id,
    });
    this.broadcastState(room);
  }

  answerQuiz(room, player, action) {
    if (room.phase !== 'quiz' || !room.stage || room.stage.type !== 'quiz') {
      throw new GameError('现在不是答题时间', 409, 'BAD_PHASE');
    }
    const stage = room.stage;
    const question = stage.questions[stage.qIndex];
    if (!question) throw new GameError('题目走丢了', 500, 'NO_QUESTION');
    if (stage.revealed || stage.revealAt) throw new GameError('这题已经揭晓啦', 409, 'ALREADY_REVEALED');
    if (action.questionId !== question.id) throw new GameError('题目对不上，刷新一下？', 409, 'WRONG_QUESTION');
    if (stage.answers[player.id]) throw new GameError('你已经选过了', 409, 'ALREADY_ANSWERED');
    const choice = Number(action.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= question.options.length) {
      throw new GameError('这个选项不存在', 400, 'BAD_CHOICE');
    }
    stage.answers[player.id] = { choice, at: Date.now() };
    player.answeredCount += 1;
    const answeredCount = Object.keys(stage.answers).length;
    this.publish(room, {
      type: 'quizAnswer',
      playerId: player.id,
      slot: player.slot,
      answeredCount,
      totalPlayers: room.players.length,
    });
    if (answeredCount >= 2) {
      stage.revealAt = Date.now() + this.config.quizSuspenseMs;
      this.publish(room, { type: 'quizLocked', qIndex: stage.qIndex });
    }
    this.broadcastState(room);
    return { ok: true };
  }

  throwItem(room, player, itemId) {
    if (room.phase !== 'battle') throw new GameError('现在不是投掷时间', 409, 'BAD_PHASE');
    const item = ITEM_MAP[itemId];
    if (!item) throw new GameError('没有这个道具', 400, 'BAD_ITEM');
    const other = room.players.find((p) => p.id !== player.id);
    if (!other) throw new GameError('对手不见了', 409, 'NO_OPPONENT');
    const now = Date.now();
    if (now - (player.lastThrowServerAt || 0) < this.config.throwCooldownMs) {
      throw new GameError('手太快了，喘口气', 429, 'COOLDOWN');
    }
    player.lastThrowServerAt = now;
    const splat = this.makeSplat(item, player.id);
    other.splats.push(splat);
    if (other.splats.length > this.config.maxSplatsPerPlayer) {
      other.splats.splice(0, other.splats.length - this.config.maxSplatsPerPlayer);
    }
    player.hits += 1;
    player.battlePoints += item.points;
    player.lastThrowItem = item.id;
    player.lastThrowAt = now;
    this.recomputeCovers(room);
    this.publish(room, {
      type: 'throw',
      fromId: player.id,
      fromSlot: player.slot,
      fromName: player.name,
      targetId: other.id,
      targetSlot: other.slot,
      item: {
        id: item.id,
        name: item.name,
        emoji: item.emoji,
        effect: item.effect,
        color: item.color,
      },
      splat: publicSplat(splat),
    });

    const delta = now - (other.lastThrowAt || 0);
    if (
      other.lastThrowItem === item.id &&
      delta >= 0 &&
      delta <= this.config.syncWindowMs &&
      now - (room.match?.lastSyncAt || 0) > 1200
    ) {
      player.battlePoints += 6;
      other.battlePoints += 6;
      player.syncMoments += 1;
      other.syncMoments += 1;
      room.match.battleSyncs += 1;
      room.match.lastSyncAt = now;
      this.publish(room, {
        type: 'sync',
        itemId: item.id,
        itemName: item.name,
        emoji: item.emoji,
        playerIds: [player.id, other.id],
        text: '居然有默契！',
        bonus: 6,
      });
    }
    this.broadcastState(room);
    return { ok: true, splatId: splat.id };
  }

  wipeSplats(room, player, rawIds) {
    if (room.phase !== 'battle') throw new GameError('现在不用擦屏幕', 409, 'BAD_PHASE');
    if (!Array.isArray(rawIds)) throw new GameError('无效的擦拭操作', 400, 'BAD_WIPE');
    const ids = [...new Set(rawIds.filter((id) => typeof id === 'string').slice(0, 24))];
    if (ids.length === 0) return { ok: true, removed: [], damaged: [] };
    const byId = new Map(player.splats.map((s) => [s.id, s]));
    const removed = [];
    const damaged = [];
    for (const id of ids) {
      const splat = byId.get(id);
      if (!splat) continue;
      if (splat.hp > 1) {
        splat.hp -= 1;
        damaged.push({ id, hp: splat.hp });
      } else {
        removed.push(id);
      }
    }
    if (removed.length) {
      const removeSet = new Set(removed);
      player.splats = player.splats.filter((s) => !removeSet.has(s.id));
      player.wiped += removed.length;
    }
    if (!removed.length && !damaged.length) return { ok: true, removed: [], damaged: [] };
    this.recomputeCovers(room);
    this.publish(room, {
      type: 'wipe',
      byId: player.id,
      bySlot: player.slot,
      byName: player.name,
      ids,
      removed,
      damaged,
      remaining: player.splats.length,
    });
    this.broadcastState(room);
    return { ok: true, removed, damaged };
  }

  voteRematch(room, player) {
    if (room.phase !== 'results') throw new GameError('还没到重赛的时候', 409, 'BAD_PHASE');
    player.rematch = true;
    const votes = room.players.filter((p) => p.rematch).length;
    this.publish(room, {
      type: 'rematch',
      playerId: player.id,
      name: player.name,
      slot: player.slot,
      votes,
      needed: room.players.length,
    });
    if (votes >= 2) {
      this.startMatch(room);
      return { ok: true, starting: true };
    }
    this.broadcastState(room);
    return { ok: true, votes, needed: 2 };
  }

  returnToLobby(room, player) {
    if (room.phase !== 'results') throw new GameError('现在不能回大厅', 409, 'BAD_PHASE');
    if (player.id !== room.hostId) throw new GameError('只有房主可以带大家回大厅', 403, 'NOT_HOST');
    room.phase = 'lobby';
    room.result = null;
    room.stage = null;
    room.stageIntro = null;
    room.match = null;
    room.sequence = [];
    room.stageIndex = -1;
    room.pausedAt = null;
    for (const p of room.players) {
      p.rematch = false;
      p.splats = [];
    }
    this.publish(room, { type: 'toLobby', playerId: player.id });
    this.broadcastState(room);
    return { ok: true };
  }

  tickAll() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.pausedAt) continue;
      if (room.phase === 'intro' && room.stageIntro && now >= room.stageIntro.endsAt) {
        this.beginStage(room);
      } else if (room.phase === 'battle' && room.stage && now >= room.stage.endsAt) {
        this.endBattleStage(room);
      } else if (room.phase === 'quiz' && room.stage) {
        this.tickQuiz(room, now);
      }
    }
  }

  tickQuiz(room, now) {
    const stage = room.stage;
    if (stage.revealed) {
      if (stage.nextAt && now >= stage.nextAt) {
        if (stage.qIndex + 1 < stage.questions.length) {
          stage.qIndex += 1;
          this.startQuizQuestion(room);
        } else {
          this.endQuizStage(room);
        }
      }
      return;
    }
    if (stage.revealAt) {
      if (now >= stage.revealAt) this.revealQuiz(room);
      return;
    }
    if (stage.questionEndsAt && now >= stage.questionEndsAt) {
      stage.revealAt = now + Math.max(60, Math.min(this.config.quizSuspenseMs, 500));
      this.publish(room, { type: 'quizTimeout', qIndex: stage.qIndex });
      this.broadcastState(room);
    }
  }

  revealQuiz(room) {
    const stage = room.stage;
    const question = stage.questions[stage.qIndex];
    if (!question || stage.revealed) return;
    const a = room.players.find((p) => p.slot === 'A');
    const b = room.players.find((p) => p.slot === 'B');
    const aAns = a ? stage.answers[a.id] : null;
    const bAns = b ? stage.answers[b.id] : null;
    const aChoice = aAns ? aAns.choice : null;
    const bChoice = bAns ? bAns.choice : null;
    const matched = aChoice !== null && bChoice !== null && aChoice === bChoice;

    room.match.quizTotal += 1;
    if (matched) {
      room.match.quizMatches += 1;
      for (const p of room.players) p.quizMatches += 1;
    }
    if (aAns && bAns) {
      if (aAns.at < bAns.at) a.speedPoints += 2;
      else if (bAns.at < aAns.at) b.speedPoints += 2;
      else {
        a.speedPoints += 1;
        b.speedPoints += 1;
      }
    }
    for (const p of room.players) {
      const ans = stage.answers[p.id];
      if (ans) p.answerTimeTotal += Math.max(0, ans.at - stage.questionStartedAt);
    }

    const choices = room.players.map((p) => {
      const ans = stage.answers[p.id];
      return {
        playerId: p.id,
        slot: p.slot,
        name: p.name,
        choice: ans ? ans.choice : null,
        choiceText: ans ? question.options[ans.choice] : '超时没选',
        answered: Boolean(ans),
      };
    });
    stage.selfSplats = { A: [], B: [] };
    if (!matched) {
      for (const p of room.players) {
        stage.selfSplats[p.slot] = Array.from({ length: 3 }, () => this.makeQuizSplat());
      }
    }
    stage.revealed = true;
    stage.reveal = {
      matched,
      choices,
      questionId: question.id,
      questionText: question.text,
      matchedOption: matched ? question.options[aChoice] : null,
    };
    stage.nextAt = Date.now() + this.config.quizRevealMs;
    this.publish(room, {
      type: 'quizReveal',
      qIndex: stage.qIndex,
      total: stage.questions.length,
      matched,
      choices,
      selfSplats: stage.selfSplats,
      questionId: question.id,
      verdict: matched ? '默契 +1！' : '没有默契了！',
    });
    this.broadcastState(room);
  }

  endQuizStage(room) {
    this.publish(room, {
      type: 'stageEnd',
      stageIndex: room.stageIndex,
      stageType: 'quiz',
      quizMatches: room.match.quizMatches,
      quizTotal: room.match.quizTotal,
    });
    this.advanceStage(room);
  }

  endBattleStage(room) {
    this.recomputeCovers(room);
    this.publish(room, {
      type: 'stageEnd',
      stageIndex: room.stageIndex,
      stageType: 'battle',
      players: room.players.map((p) => ({
        id: p.id,
        slot: p.slot,
        hits: p.hits,
        coverPercent: p.coverPercent,
        peakCoverPercent: p.peakCoverPercent,
      })),
    });
    this.advanceStage(room);
  }

  advanceStage(room) {
    const next = room.stageIndex + 1;
    if (next < room.sequence.length) {
      this.goToStageIntro(room, next);
    } else {
      this.finishMatch(room);
    }
  }

  finishMatch(room) {
    const players = room.players.map((p) => ({
      id: p.id,
      slot: p.slot,
      name: p.name,
      avatar: p.avatar,
      score:
        p.battlePoints +
        Math.round(p.peakCoverPercent) +
        p.quizMatches * 25 +
        p.speedPoints,
      battlePoints: p.battlePoints,
      hits: p.hits,
      peakCoverPercent: p.peakCoverPercent,
      coverPercent: p.coverPercent,
      wiped: p.wiped,
      quizMatches: p.quizMatches,
      speedPoints: p.speedPoints,
      answeredCount: p.answeredCount,
      answerTimeTotal: p.answerTimeTotal,
      syncMoments: p.syncMoments,
    }));
    const sorted = [...players].sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      if (y.battlePoints !== x.battlePoints) return y.battlePoints - x.battlePoints;
      if (y.speedPoints !== x.speedPoints) return y.speedPoints - x.speedPoints;
      if (x.answerTimeTotal !== y.answerTimeTotal) return x.answerTimeTotal - y.answerTimeTotal;
      return 0;
    });
    const tie = sorted[0].score === sorted[1]?.score &&
      sorted[0].battlePoints === sorted[1]?.battlePoints &&
      sorted[0].speedPoints === sorted[1]?.speedPoints &&
      sorted[0].answerTimeTotal === sorted[1]?.answerTimeTotal;
    const winner = tie ? null : sorted[0];
    const loser = tie ? null : sorted[1];
    const quizTotal = room.match?.quizTotal || 0;
    const quizMatches = room.match?.quizMatches || 0;
    const syncs = room.match?.battleSyncs || 0;
    const hasBattle = room.sequence.some((s) => s.type === 'battle');
    const quizRatio = quizTotal > 0 ? quizMatches / quizTotal : null;
    const syncRatio = hasBattle ? Math.min(1, syncs / 5) : null;
    let syncIndex = 0;
    if (quizRatio !== null && syncRatio !== null) {
      syncIndex = Math.round(quizRatio * 65 + syncRatio * 35);
    } else if (quizRatio !== null) {
      syncIndex = Math.round(quizRatio * 100);
    } else if (syncRatio !== null) {
      syncIndex = Math.round(syncRatio * 100);
    }
    syncIndex = clamp(syncIndex, 0, 100);
    let verdict;
    if (syncIndex <= 30) {
      verdict = {
        key: 'nope',
        title: '已经没有默契了',
        sub: '建议重连脑电波，顺便互相再糊一下',
        emoji: '💔',
      };
    } else if (syncIndex <= 59) {
      verdict = {
        key: 'plastic',
        title: '塑料兄弟情',
        sub: '默契有一点，但不多',
        emoji: '🩹',
      };
    } else if (syncIndex <= 89) {
      verdict = {
        key: 'almost',
        title: '勉强心有灵犀',
        sub: '脑电波偶尔能连上，继续保持',
        emoji: '📡',
      };
    } else {
      verdict = {
        key: 'soulmate',
        title: '心灵相通的恶心搭档',
        sub: '建议一起出道，团名就叫臭气冲天',
        emoji: '💚',
      };
    }
    const winnerTitles = ['恶心界的天花板', '防毒面具代言人', '生化武器大师', '糊脸冠军', '臭味相投之星'];
    const loserTitles = ['今日最臭王', '鼻涕泡收藏家', '人形蟑螂屋', '隔夜榴莲之王', '生化武器体验官', '臭袜子终身成就奖'];
    const pickTitle = (arr) => arr[Math.floor(Math.random() * arr.length)];
    room.phase = 'results';
    room.stage = null;
    room.stageIntro = null;
    room.pausedAt = null;
    for (const p of room.players) p.rematch = false;
    room.result = {
      winnerId: winner?.id || null,
      loserId: loser?.id || null,
      tie,
      winnerTitle: tie ? '臭味相投双黄蛋' : pickTitle(winnerTitles),
      loserTitle: tie ? '臭味相投双黄蛋' : pickTitle(loserTitles),
      syncIndex,
      verdict,
      quizTotal,
      quizMatches,
      battleSyncs: syncs,
      mode: room.mode,
      players,
      finishedAt: Date.now(),
      durationMs: Date.now() - (room.match?.startedAt || Date.now()),
    };
    this.publish(room, { type: 'result', result: room.result });
    this.broadcastState(room);
  }

  makeSplatBase() {
    const shape = Math.floor(Math.random() * 5);
    return {
      id: `s_${randHex(6)}`,
      x: rand(0.12, 0.88),
      y: rand(0.16, 0.8),
      rot: rand(-180, 180),
      stretch: rand(0.75, 1.25),
      shape,
      hp: 1,
      cover: 5,
      createdAt: Date.now(),
    };
  }

  makeSplat(item, byId) {
    const base = this.makeSplatBase();
    return {
      ...base,
      itemId: item.id,
      byId,
      size: rand(item.size * 0.86, item.size * 1.16),
      hp: item.hp,
      cover: Math.round(item.cover * rand(0.85, 1.15)),
    };
  }

  makeQuizSplat() {
    const item = pick(ITEMS);
    const base = this.makeSplatBase();
    return {
      ...base,
      itemId: item.id,
      byId: 'quiz',
      size: rand(item.size * 0.8, item.size * 1.05),
      hp: 1,
      cover: 0,
    };
  }

  recomputeCovers(room) {
    for (const player of room.players) {
      const target = room.players.find((p) => p.id !== player.id);
      const attackSplats = target ? target.splats.filter((s) => s.byId === player.id) : [];
      const coverage = attackSplats.reduce((sum, s) => sum + s.cover, 0);
      player.coverPercent = Math.min(100, Math.round(coverage));
      player.peakCoverPercent = Math.max(player.peakCoverPercent || 0, player.coverPercent);
    }
  }

  maybeResume(room) {
    if (!room.pausedAt) return false;
    if (!room.players.every((p) => p.connected)) return false;
    const pausedFor = Date.now() - room.pausedAt;
    if (room.phase === 'intro' && room.stageIntro) {
      room.stageIntro.endsAt += pausedFor;
    } else if (room.phase === 'battle' && room.stage) {
      room.stage.endsAt += pausedFor;
    } else if (room.phase === 'quiz' && room.stage) {
      const stage = room.stage;
      if (stage.questionStartedAt) stage.questionStartedAt += pausedFor;
      if (stage.questionEndsAt) stage.questionEndsAt += pausedFor;
      if (stage.revealAt) stage.revealAt += pausedFor;
      if (stage.nextAt) stage.nextAt += pausedFor;
    }
    room.pausedAt = null;
    room.pausedBy = null;
    this.publish(room, { type: 'resume' });
    this.broadcastState(room);
    return true;
  }

  pauseRoom(room, player) {
    if (room.pausedAt || !ACTIVE_PHASES.has(room.phase)) return false;
    room.pausedAt = Date.now();
    room.pausedBy = player?.id || null;
    this.publish(room, {
      type: 'presence',
      playerId: player?.id || null,
      name: player?.name || '',
      slot: player?.slot || '',
      connected: false,
      paused: true,
    });
    this.broadcastState(room);
    return true;
  }

  markOffline(room, player, reason) {
    if (!player.connected && !player.channel) return;
    player.connected = false;
    player.channel = null;
    if (player.ws) {
      try {
        player.ws.close(4003, 'offline');
      } catch {
        /* ignore */
      }
      player.ws = null;
    }
    player.lastSeen = Date.now();
    if (ACTIVE_PHASES.has(room.phase)) {
      this.pauseRoom(room, player);
    } else {
      this.publish(room, {
        type: 'presence',
        playerId: player.id,
        name: player.name,
        slot: player.slot,
        connected: false,
        reason,
      });
      this.broadcastState(room);
    }
  }

  presenceSweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      for (const player of room.players) {
        if (!player.connected) continue;
        if (player.channel === 'pending' && now - player.lastSeen > 12000) {
          this.markOffline(room, player, 'never_connected');
        } else if (player.channel === 'poll' && now - player.lastPollAt > this.config.offlineThresholdMs) {
          this.markOffline(room, player, 'poll_timeout');
        }
      }
    }
  }

  cleanupRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const allOffline = room.players.every((p) => !p.connected);
      if (allOffline && now - room.lastActivityAt > this.config.roomTtlMs) {
        this.destroyRoom(room);
        this.rooms.delete(code);
      }
    }
  }

  destroyRoom(room) {
    for (const waiter of room.pollWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(this.buildPollPayload(room, waiter.player, waiter.since));
    }
    room.pollWaiters.clear();
    for (const player of room.players) {
      if (player.ws) {
        try {
          player.ws.close(4004, 'room_closed');
        } catch {
          /* ignore */
        }
      }
      this.tokenIndex.delete(player.token);
    }
  }

  makePlayer(slot, rawName, fallback) {
    return {
      id: `p_${randHex(6)}`,
      token: token(),
      slot,
      name: cleanName(rawName, fallback),
      avatar: PLAYER_AVATARS[slot === 'A' ? 0 : 1],
      connected: true,
      channel: 'pending',
      ws: null,
      pollDelivered: false,
      lastSeen: Date.now(),
      lastPollAt: Date.now(),
      rematch: false,
      splats: [],
      hits: 0,
      battlePoints: 0,
      coverPercent: 0,
      peakCoverPercent: 0,
      wiped: 0,
      quizMatches: 0,
      speedPoints: 0,
      answeredCount: 0,
      answerTimeTotal: 0,
      syncMoments: 0,
      lastThrowItem: null,
      lastThrowAt: 0,
      lastThrowServerAt: 0,
    };
  }

  makeRoomCode() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let code = '';
      for (let i = 0; i < 4; i += 1) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError('房间太多了，稍后再试', 503, 'NO_ROOM_CODE');
  }

  findPlayer(rawToken) {
    if (typeof rawToken !== 'string' || rawToken.length < 10) return null;
    const index = this.tokenIndex.get(rawToken);
    if (!index) return null;
    const room = this.rooms.get(index.code);
    if (!room) return null;
    const player = room.players.find((p) => p.id === index.playerId);
    if (!player) return null;
    return { room, player };
  }

  publish(room, event) {
    room.cursor += 1;
    const enriched = { ...event, seq: room.cursor, at: Date.now() };
    room.events.push(enriched);
    if (room.events.length > 400) room.events.splice(0, room.events.length - 400);
    for (const player of room.players) {
      if (player.ws && player.ws.readyState === 1) {
        try {
          player.ws.send(JSON.stringify(enriched));
        } catch {
          /* socket errors are handled by close */
        }
      }
    }
    this.wakePollers(room);
    return enriched;
  }

  broadcastState(room) {
    for (const player of room.players) {
      if (player.ws && player.ws.readyState === 1) {
        try {
          player.ws.send(JSON.stringify({ type: 'state', snapshot: this.buildSnapshot(room, player) }));
        } catch {
          /* ignore */
        }
      }
    }
    this.wakePollers(room);
  }

  wakePollers(room) {
    if (room.pollWaiters.size === 0) return;
    const waiters = [...room.pollWaiters];
    room.pollWaiters.clear();
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(this.buildPollPayload(room, waiter.player, waiter.since));
    }
  }

  remaining(deadline, room) {
    if (!deadline) return 0;
    const ref = room.pausedAt || Date.now();
    return Math.max(0, deadline - ref);
  }

  buildSnapshot(room, viewer) {
    const now = Date.now();
    const stageSequence = room.sequence[room.stageIndex] || null;
    const other = room.players.find((p) => p.id !== viewer.id) || null;
    const stage = room.stage;
    let quiz = null;
    if (room.phase === 'quiz' && stage?.type === 'quiz') {
      const question = stage.questions[stage.qIndex];
      const showChoices = stage.revealed;
      quiz = {
        qIndex: stage.qIndex,
        qNumber: stage.qIndex + 1,
        total: stage.questions.length,
        question: question ? { id: question.id, text: question.text, options: [...question.options] } : null,
        remainingMs: stage.revealed ? 0 : this.remaining(stage.questionEndsAt, room),
        nextInMs: stage.revealed ? this.remaining(stage.nextAt, room) : 0,
        answered: room.players.map((p) => ({
          id: p.id,
          name: p.name,
          slot: p.slot,
          answered: Boolean(stage.answers[p.id]),
          choice: showChoices ? (stage.answers[p.id]?.choice ?? null) : null,
        })),
        revealed: stage.revealed,
        reveal: stage.reveal
          ? {
              matched: stage.reveal.matched,
              choices: stage.reveal.choices,
              matchedOption: stage.reveal.matchedOption,
            }
          : null,
        selfSplats: stage.revealed ? stage.selfSplats[viewer.slot] || [] : [],
      };
    }
    const intro = room.phase === 'intro' && room.stageIntro
      ? {
          endsAt: room.stageIntro.endsAt,
          remainingMs: this.remaining(room.stageIntro.endsAt, room),
          title: room.stageIntro.title,
          subtitle: room.stageIntro.subtitle,
          nextType: room.stageIntro.type,
        }
      : null;
    const battle = room.phase === 'battle' && stage
      ? {
          remainingMs: this.remaining(stage.endsAt, room),
          durationMs: this.config.roundSeconds * 1000,
        }
      : null;

    let pausedByName = '';
    if (room.pausedAt) {
      const pauser = room.players.find((p) => p.id === room.pausedBy);
      pausedByName = pauser?.name || '';
    }

    return {
      code: room.code,
      mode: room.mode,
      phase: room.phase,
      hostId: room.hostId,
      isHost: viewer.id === room.hostId,
      paused: Boolean(room.pausedAt),
      pausedByName,
      pausedById: room.pausedBy || null,
      stageIndex: room.stageIndex,
      stageNumber: room.stageIndex + 1,
      stageCount: room.sequence.length,
      stageType: stageSequence?.type || null,
      stageLabel: stageSequence?.label || '',
      intro,
      battle,
      quiz,
      splats: room.phase === 'battle' ? viewer.splats.map(publicSplat) : [],
      players: room.players.map((p) => ({
        id: p.id,
        slot: p.slot,
        name: p.name,
        avatar: p.avatar,
        connected: p.connected,
        isHost: p.id === room.hostId,
        rematch: p.rematch,
        hits: p.hits,
        battlePoints: p.battlePoints,
        coverPercent: p.coverPercent,
        peakCoverPercent: p.peakCoverPercent,
        wiped: p.wiped,
        quizMatches: p.quizMatches,
        speedPoints: p.speedPoints,
        answeredCount: p.answeredCount,
        syncMoments: p.syncMoments,
      })),
      me: {
        id: viewer.id,
        slot: viewer.slot,
        name: viewer.name,
        avatar: viewer.avatar,
        isHost: viewer.id === room.hostId,
        rematch: viewer.rematch,
        connected: viewer.connected,
        transport: viewer.channel || 'pending',
      },
      opponent: other
        ? {
            id: other.id,
            name: other.name,
            avatar: other.avatar,
            connected: other.connected,
            slot: other.slot,
          }
        : null,
      result: room.result,
      config: {
        roundSeconds: this.config.roundSeconds,
        quizSeconds: this.config.quizSeconds,
        syncWindowMs: this.config.syncWindowMs,
        throwCooldownMs: this.config.throwCooldownMs,
      },
      serverNow: now,
    };
  }
}
