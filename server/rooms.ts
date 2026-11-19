import { WebSocket } from 'ws'
import { ITEMS, itemById } from '../shared/items'
import { QUESTIONS } from '../shared/questions'
import {
  ROOM_ALPHABET,
  cleanName,
  type ClientMsg,
  type ErrorMsg,
  type Mode,
  type Phase,
  type Question,
  type ServerEvent,
  type Snapshot,
} from '../shared/types'
import { syncIndex, verdictFor } from '../shared/verdicts'
import { buildResult, type ResultInput } from './result'

const ACCIDENT_MS = 1000
const ACCIDENT_COOLDOWN_MS = 2000
const THROW_COOLDOWN_MS = 120
const MAX_SPLATS_PER_SCREEN = 26
const MAX_ROOMS = 800

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

export const timings = {
  countdownMs: intEnv('COUNTDOWN_MS', 3000),
  roundMs: intEnv('ROUND_MS', 60_000),
  questionMs: intEnv('SYNC_QUESTION_MS', 12_000),
  revealMs: intEnv('SYNC_RESULT_MS', 4000),
  syncQuestions: intEnv('SYNC_QUESTIONS', 8),
  mixedBattleMs: intEnv('MIXED_BATTLE_MS', 30_000),
  mixedCycles: intEnv('MIXED_CYCLES', 2),
  graceMs: intEnv('RECONNECT_GRACE_MS', 20_000),
}

type ServerSplat = Snapshot['splats'][number] & { points: number; targetPid: string }

type Player = {
  pid: string
  name: string
  ws: WebSocket | null
  connected: boolean
  host: boolean
  rematch: boolean
  lastThrowAt: number
  lastItem: string | null
  grace: ReturnType<typeof setTimeout> | null
}

type Room = {
  code: string
  mode: Mode
  players: Map<string, Player>
  phase: Phase
  paused: boolean
  pauseText: string
  endsAt: number | null
  remainingMs: number
  phaseDuration: number | null
  timer: ReturnType<typeof setTimeout> | null
  emptyTimer: ReturnType<typeof setTimeout> | null
  splats: Map<string, ServerSplat>
  seq: number
  question: Question | null
  questionIndex: number
  questionTotal: number
  answers: Record<string, string>
  reveal: Snapshot['reveal']
  usedQuestions: Set<string>
  matches: number
  resolved: number
  bonus: number
  lastAccidentAt: number
  result: Snapshot['result']
  forfeitPid: string | null
  forfeitReason: 'disconnect' | 'leave' | null
  finishedCount: number
}

export type Sock = {
  ws: WebSocket
  roomCode: string | null
  pid: string | null
}

const rooms = new Map<string, Room>()

function send(ws: WebSocket | null, msg: Snapshot | ServerEvent | ErrorMsg | { t: 'bye' }) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    /* socket already closing */
  }
}

function fail(ws: WebSocket, message: string, code: ErrorMsg['code'], room?: string) {
  send(ws, { t: 'error', message, code, room })
}

function log(room: Room, message: string) {
  console.log(`[${room.code}] ${message}`)
}

function makePid(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

function makeCode(): string {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let code = ''
    for (let i = 0; i < 4; i += 1) {
      code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]
    }
    if (!rooms.has(code)) return code
  }
  return `Z${Date.now().toString(36).slice(-3).toUpperCase()}`.slice(0, 4)
}

function grossOf(room: Room): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const player of room.players.values()) scores[player.pid] = 0
  for (const splat of room.splats.values()) {
    if (splat.fromPunishment) continue
    if (scores[splat.ownerPid] == null) continue
    const ratio = splat.maxHealth <= 0 ? 0 : Math.max(0, splat.health) / splat.maxHealth
    scores[splat.ownerPid] = (scores[splat.ownerPid] ?? 0) + splat.points * ratio
  }
  for (const pid of Object.keys(scores)) scores[pid] = Math.round(scores[pid] ?? 0)
  return scores
}

function syncOf(room: Room) {
  const index = syncIndex(room.matches, room.resolved, room.bonus)
  return {
    matches: room.matches,
    total: room.resolved,
    bonus: room.bonus,
    index,
    verdict: verdictFor(index),
  }
}

function snapshotFor(room: Room, pid: string): Snapshot {
  const now = Date.now()
  const questionVisible = room.phase === 'sync_question' || room.phase === 'sync_result'
  return {
    t: 'snapshot',
    serverNow: now,
    code: room.code,
    mode: room.mode,
    phase: room.phase,
    paused: room.paused,
    pauseText: room.pauseText,
    endsAt: room.endsAt,
    remainingMs: room.paused ? room.remainingMs : room.endsAt ? Math.max(0, room.endsAt - now) : 0,
    phaseDuration: room.phaseDuration,
    you: pid,
    players: [...room.players.values()].map((player) => ({
      pid: player.pid,
      name: player.name,
      connected: player.connected,
      host: player.host,
      rematch: player.rematch,
    })),
    splats: [...room.splats.values()]
      .filter((splat) => splat.targetPid === pid)
      .map((splat) => ({
        id: splat.id,
        itemId: splat.itemId,
        x: splat.x,
        y: splat.y,
        rot: splat.rot,
        health: splat.health,
        maxHealth: splat.maxHealth,
        ownerPid: splat.ownerPid,
        fromPunishment: splat.fromPunishment,
      })),
    gross: grossOf(room),
    question:
      questionVisible && room.question
        ? {
            id: room.question.id,
            prompt: room.question.prompt,
            options: room.question.options,
            index: room.questionIndex,
            total: room.questionTotal,
            yourOption: room.answers[pid] ?? null,
          }
        : null,
    reveal: room.phase === 'sync_result' ? room.reveal : null,
    sync: syncOf(room),
    result: room.phase === 'result' ? room.result : null,
  }
}

function broadcast(room: Room) {
  for (const player of room.players.values()) send(player.ws, snapshotFor(room, player.pid))
}

function clearTimer(room: Room) {
  if (room.timer) clearTimeout(room.timer)
  room.timer = null
}

function schedule(room: Room) {
  clearTimer(room)
  if (room.paused || room.endsAt == null) return
  const wait = Math.max(0, room.endsAt - Date.now())
  room.timer = setTimeout(() => onTimer(room), wait)
}

function onTimer(room: Room) {
  if (!rooms.has(room.code) || room.paused) return
  if (room.phase === 'countdown') beginRound(room)
  else if (room.phase === 'battle') endBattle(room)
  else if (room.phase === 'sync_question') resolveQuestion(room)
  else if (room.phase === 'sync_result') afterReveal(room)
}

function setTimed(room: Room, phase: Phase, duration: number) {
  room.phase = phase
  room.paused = false
  room.pauseText = ''
  room.phaseDuration = duration
  room.remainingMs = duration
  room.endsAt = Date.now() + duration
  schedule(room)
}

function otherPlayer(room: Room, pid: string): Player | undefined {
  for (const player of room.players.values()) {
    if (player.pid !== pid) return player
  }
  return undefined
}

function questionTotalFor(room: Room): number {
  return room.mode === 'sync' ? timings.syncQuestions : timings.mixedCycles
}

function enterCountdown(room: Room) {
  room.reveal = null
  room.question = null
  room.answers = {}
  room.result = null
  room.forfeitPid = null
  room.forfeitReason = null
  for (const player of room.players.values()) player.rematch = false
  setTimed(room, 'countdown', timings.countdownMs)
  log(room, 'countdown')
  broadcast(room)
}

function beginRound(room: Room) {
  if (room.phase !== 'countdown') return
  if (room.mode === 'sync') enterQuestion(room)
  else enterBattle(room)
}

function enterBattle(room: Room) {
  room.reveal = null
  room.question = null
  room.answers = {}
  clearPunishment(room)
  const duration = room.mode === 'mixed' ? timings.mixedBattleMs : timings.roundMs
  setTimed(room, 'battle', duration)
  log(room, `battle ${duration}ms`)
  broadcast(room)
}

function enterQuestion(room: Room) {
  if (room.usedQuestions.size >= QUESTIONS.length) room.usedQuestions.clear()
  const pool = QUESTIONS.filter((q) => !room.usedQuestions.has(q.id))
  const question = pool[Math.floor(Math.random() * pool.length)] ?? QUESTIONS[0]
  if (!question) return
  room.usedQuestions.add(question.id)
  room.question = question
  room.answers = {}
  room.reveal = null
  room.questionIndex = room.resolved + 1
  room.questionTotal = questionTotalFor(room)
  clearPunishment(room)
  setTimed(room, 'sync_question', timings.questionMs)
  log(room, `question ${question.id} ${room.questionIndex}/${room.questionTotal}`)
  broadcast(room)
}

function optionLabel(question: Question | null, optionId: string | undefined): string | null {
  if (!question || !optionId) return null
  return question.options.find((option) => option.id === optionId)?.label ?? null
}

function resolveQuestion(room: Room) {
  if (room.phase !== 'sync_question' || !room.question) return
  const players = [...room.players.values()]
  const labels = players.map((player) => room.answers[player.pid])
  const matched = labels.length >= 2 && labels.every((label) => label && label === labels[0])
  room.resolved += 1
  if (matched) room.matches += 1
  room.reveal = {
    matched,
    rows: players.map((player) => ({
      pid: player.pid,
      name: player.name,
      label: optionLabel(room.question, room.answers[player.pid]) ?? '在发呆',
    })),
  }
  if (!matched) punish(room)
  setTimed(room, 'sync_result', timings.revealMs)
  log(room, matched ? 'sync match' : 'sync mismatch')
  broadcast(room)
}

function punish(room: Room) {
  const spots: [number, number][] = [
    [0.28, 0.32],
    [0.72, 0.3],
    [0.38, 0.66],
    [0.74, 0.7],
  ]
  for (const player of room.players.values()) {
    spots.forEach(([x, y], index) => {
      const item = ITEMS[Math.floor(Math.random() * ITEMS.length)] ?? ITEMS[0]
      if (!item) return
      const splat = makeSplat(room, item.id, player.pid, player.pid, x + (Math.random() - 0.5) * 0.06, y + (index % 2 === 0 ? 0.02 : -0.02), true)
      if (!splat) return
      send(player.ws, { t: 'event', kind: 'hit', effect: item.effect, itemId: item.id })
    })
  }
}

function makeSplat(
  room: Room,
  itemId: string,
  ownerPid: string,
  targetPid: string,
  x: number,
  y: number,
  fromPunishment: boolean,
): ServerSplat | null {
  const item = itemById(itemId)
  if (!item) return null
  const onTarget = [...room.splats.values()].filter((splat) => splat.targetPid === targetPid)
  if (onTarget.length >= MAX_SPLATS_PER_SCREEN) {
    const oldest = onTarget[0]
    if (oldest) room.splats.delete(oldest.id)
  }
  const splat: ServerSplat = {
    id: `s${room.seq++}`,
    itemId: item.id,
    x: Math.min(0.92, Math.max(0.08, x)),
    y: Math.min(0.9, Math.max(0.1, y)),
    rot: Math.round((Math.random() - 0.5) * 50),
    health: item.health,
    maxHealth: item.health,
    ownerPid,
    fromPunishment,
    points: item.points,
    targetPid,
  }
  room.splats.set(splat.id, splat)
  return splat
}

function clearPunishment(room: Room) {
  for (const [id, splat] of room.splats) {
    if (splat.fromPunishment) room.splats.delete(id)
  }
}

function endBattle(room: Room) {
  if (room.phase !== 'battle') return
  if (room.mode === 'mixed') enterQuestion(room)
  else enterResult(room)
}

function afterReveal(room: Room) {
  if (room.phase !== 'sync_result') return
  clearPunishment(room)
  room.reveal = null
  if (room.mode === 'sync') {
    if (room.resolved < timings.syncQuestions) enterQuestion(room)
    else enterResult(room)
    return
  }
  if (room.mode === 'mixed') {
    const battlesDone = room.resolved
    if (battlesDone < timings.mixedCycles) enterBattle(room)
    else enterResult(room)
    return
  }
  enterResult(room)
}

function enterResult(room: Room) {
  if (room.phase === 'result') return
  clearTimer(room)
  clearPunishment(room)
  room.paused = false
  room.pauseText = ''
  room.endsAt = null
  room.remainingMs = 0
  room.phaseDuration = null
  room.phase = 'result'
  room.finishedCount += 1
  const input: ResultInput = {
    code: room.code,
    mode: room.mode,
    players: [...room.players.values()].map((player) => ({ pid: player.pid, name: player.name })),
    gross: grossOf(room),
    matches: room.matches,
    resolved: room.resolved,
    bonus: room.bonus,
    forfeitPid: room.forfeitPid,
    forfeitReason: room.forfeitReason,
    finishedCount: room.finishedCount,
  }
  room.result = buildResult(input)
  log(room, `result ${room.result.headline}`)
  broadcast(room)
}

function resetMatch(room: Room) {
  room.splats.clear()
  room.matches = 0
  room.resolved = 0
  room.bonus = 0
  room.usedQuestions.clear()
  room.answers = {}
  room.reveal = null
  room.question = null
  room.result = null
  room.forfeitPid = null
  room.forfeitReason = null
  room.lastAccidentAt = 0
  room.paused = false
  room.pauseText = ''
  for (const player of room.players.values()) {
    player.rematch = false
    player.lastItem = null
    player.lastThrowAt = 0
  }
}

function pause(room: Room, text: string) {
  if (room.paused) return
  if (room.phase === 'waiting' || room.phase === 'result' || room.endsAt == null) return
  room.paused = true
  room.remainingMs = Math.max(0, room.endsAt - Date.now())
  room.endsAt = null
  room.pauseText = text
  clearTimer(room)
  broadcast(room)
}

function resume(room: Room) {
  if (!room.paused) return
  room.paused = false
  room.pauseText = ''
  room.endsAt = Date.now() + room.remainingMs
  schedule(room)
  broadcast(room)
}

function bothConnected(room: Room): boolean {
  const players = [...room.players.values()]
  return players.length >= 2 && players.every((player) => player.connected)
}

function ensureHost(room: Room) {
  if ([...room.players.values()].some((player) => player.host && player.connected)) return
  const next = [...room.players.values()].find((player) => player.connected)
  for (const player of room.players.values()) player.host = player === next
}

function destroy(room: Room) {
  clearTimer(room)
  if (room.emptyTimer) clearTimeout(room.emptyTimer)
  for (const player of room.players.values()) {
    if (player.grace) clearTimeout(player.grace)
  }
  rooms.delete(room.code)
  log(room, 'closed')
}

function armEmptyTimer(room: Room) {
  if ([...room.players.values()].some((player) => player.connected)) {
    if (room.emptyTimer) clearTimeout(room.emptyTimer)
    room.emptyTimer = null
    return
  }
  if (room.emptyTimer) clearTimeout(room.emptyTimer)
  room.emptyTimer = setTimeout(() => {
    if ([...room.players.values()].every((player) => !player.connected)) destroy(room)
  }, 30_000)
}

function createRoom(mode: Mode): Room {
  const room: Room = {
    code: makeCode(),
    mode,
    players: new Map(),
    phase: 'waiting',
    paused: false,
    pauseText: '',
    endsAt: null,
    remainingMs: 0,
    phaseDuration: null,
    timer: null,
    emptyTimer: null,
    splats: new Map(),
    seq: 1,
    question: null,
    questionIndex: 0,
    questionTotal: mode === 'sync' ? timings.syncQuestions : timings.mixedCycles,
    answers: {},
    reveal: null,
    usedQuestions: new Set(),
    matches: 0,
    resolved: 0,
    bonus: 0,
    lastAccidentAt: 0,
    result: null,
    forfeitPid: null,
    forfeitReason: null,
    finishedCount: 0,
  }
  rooms.set(room.code, room)
  return room
}

function addPlayer(room: Room, name: string, ws: WebSocket, host: boolean): Player {
  const player: Player = {
    pid: makePid(),
    name,
    ws,
    connected: true,
    host,
    rematch: false,
    lastThrowAt: 0,
    lastItem: null,
    grace: null,
  }
  room.players.set(player.pid, player)
  return player
}

function detach(sock: Sock, reason: 'leave' | 'disconnect') {
  if (!sock.roomCode || !sock.pid) return
  const room = rooms.get(sock.roomCode)
  const pid = sock.pid
  sock.roomCode = null
  sock.pid = null
  if (!room) return
  const player = room.players.get(pid)
  if (!player) return
  if (reason === 'leave') send(sock.ws, { t: 'bye' })
  if (player.ws === sock.ws) player.ws = null
  player.connected = false
  if (player.grace) {
    clearTimeout(player.grace)
    player.grace = null
  }

  if (room.phase === 'waiting' || room.phase === 'result') {
    if (reason === 'leave' || room.phase === 'waiting') {
      if (reason === 'leave') room.players.delete(pid)
      if (room.players.size === 0) {
        destroy(room)
        return
      }
      ensureHost(room)
      if (reason === 'disconnect' && room.phase === 'waiting') armEmptyTimer(room)
      broadcast(room)
      return
    }
    broadcast(room)
    armEmptyTimer(room)
    return
  }

  if (reason === 'leave') {
    room.forfeitPid = pid
    room.forfeitReason = 'leave'
    room.paused = false
    enterResult(room)
    return
  }

  ensureHost(room)
  pause(room, `${player.name} 信号不稳，先捏住鼻子等一等…`)
  player.grace = setTimeout(() => {
    if (!rooms.has(room.code)) return
    if (player.connected) return
    room.forfeitPid = pid
    room.forfeitReason = 'disconnect'
    room.paused = false
    enterResult(room)
  }, timings.graceMs)
  log(room, `${player.name} disconnected`)
}

function activeRoom(sock: Sock): Room | null {
  if (!sock.roomCode || !sock.pid) return null
  return rooms.get(sock.roomCode) ?? null
}

export function handleMessage(sock: Sock, msg: ClientMsg) {
  switch (msg.t) {
    case 'create':
      return onCreate(sock, msg.name, msg.mode)
    case 'join':
      return onJoin(sock, msg.code, msg.name)
    case 'rejoin':
      return onRejoin(sock, msg.code, msg.pid, msg.name)
    case 'start':
      return onStart(sock)
    case 'throw':
      return onThrow(sock, msg.itemId, msg.x, msg.y)
    case 'wipe':
      return onWipe(sock, msg.id, msg.health)
    case 'answer':
      return onAnswer(sock, msg.optionId)
    case 'rematch':
      return onRematch(sock)
    case 'leave':
      return detach(sock, 'leave')
    default:
      return
  }
}

function leaveQuiet(sock: Sock) {
  if (sock.roomCode) detach(sock, 'leave')
}

function onCreate(sock: Sock, rawName: string, mode: Mode) {
  const name = cleanName(rawName)
  if (!name) return fail(sock.ws, '先起个外号', 'bad_name')
  if (mode !== 'gross' && mode !== 'sync' && mode !== 'mixed') return fail(sock.ws, '没这个玩法', 'bad_name')
  if (rooms.size >= MAX_ROOMS) return fail(sock.ws, '服务器太臭了，稍后再来', 'busy')
  leaveQuiet(sock)
  const room = createRoom(mode)
  const player = addPlayer(room, name, sock.ws, true)
  sock.roomCode = room.code
  sock.pid = player.pid
  log(room, `created by ${name} mode=${mode}`)
  broadcast(room)
}

function onJoin(sock: Sock, rawCode: string, rawName: string) {
  const name = cleanName(rawName)
  if (!name) return fail(sock.ws, '先起个外号', 'bad_name')
  const code = rawCode.toUpperCase()
  const room = rooms.get(code)
  if (!room) return fail(sock.ws, '没有这个房间，是不是抄错码了', 'no_room', code)
  if (room.phase !== 'waiting') return fail(sock.ws, '对局已经开始了', 'started', code)
  if (room.players.size >= 2) return fail(sock.ws, '房间满了，你们已经够臭了', 'full', code)
  leaveQuiet(sock)
  const player = addPlayer(room, name, sock.ws, false)
  sock.roomCode = room.code
  sock.pid = player.pid
  log(room, `${name} joined`)
  broadcast(room)
}

function onRejoin(sock: Sock, rawCode: string, pid: string, rawName: string) {
  const code = rawCode.toUpperCase()
  const room = rooms.get(code)
  if (!room) return fail(sock.ws, '这局已经散了', 'no_room', code)
  const player = room.players.get(pid)
  if (!player) return fail(sock.ws, '你不在这个房间里', 'not_member', code)
  if (sock.roomCode && (sock.roomCode !== code || sock.pid !== pid)) leaveQuiet(sock)
  if (player.ws && player.ws !== sock.ws) {
    const previous = player.ws
    player.ws = sock.ws
    try {
      previous.close()
    } catch {
      /* already gone */
    }
  } else {
    player.ws = sock.ws
  }
  player.connected = true
  const name = cleanName(rawName)
  if (name) player.name = name
  if (player.grace) {
    clearTimeout(player.grace)
    player.grace = null
  }
  sock.roomCode = room.code
  sock.pid = player.pid
  ensureHost(room)
  log(room, `${player.name} rejoined`)
  if (room.paused && bothConnected(room)) resume(room)
  else broadcast(room)
}

function onStart(sock: Sock) {
  const room = activeRoom(sock)
  if (!room || !sock.pid) return
  const player = room.players.get(sock.pid)
  if (!player) return
  if (room.phase !== 'waiting') return
  if (!player.host) return fail(sock.ws, '只有房主能开臭', 'not_host', room.code)
  if (room.players.size < 2 || !bothConnected(room)) {
    return fail(sock.ws, '还差一个臭友', 'need_two', room.code)
  }
  enterCountdown(room)
}

function onThrow(sock: Sock, itemId: string, x: number, y: number) {
  const room = activeRoom(sock)
  if (!room || !sock.pid) return
  if (room.phase !== 'battle' || room.paused) return
  const player = room.players.get(sock.pid)
  const target = otherPlayer(room, sock.pid)
  const item = itemById(itemId)
  if (!player || !target || !item) return
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return
  const now = Date.now()
  if (now - player.lastThrowAt < THROW_COOLDOWN_MS) return
  const syncHit =
    player.lastItem !== undefined &&
    target.lastItem === item.id &&
    now - target.lastThrowAt <= ACCIDENT_MS &&
    now - room.lastAccidentAt >= ACCIDENT_COOLDOWN_MS
  player.lastThrowAt = now
  player.lastItem = item.id
  const splat = makeSplat(room, item.id, player.pid, target.pid, x, y, false)
  if (!splat) return
  if (syncHit) {
    room.bonus += 1
    room.lastAccidentAt = now
    player.lastItem = null
    target.lastItem = null
    const event: ServerEvent = { t: 'event', kind: 'accident', itemName: item.name }
    send(player.ws, event)
    send(target.ws, event)
    log(room, `accident sync ${item.id}`)
  }
  send(player.ws, { t: 'event', kind: 'ack', itemId: item.id, x: splat.x, y: splat.y })
  send(target.ws, { t: 'event', kind: 'hit', effect: item.effect, itemId: item.id })
  broadcast(room)
}

function onWipe(sock: Sock, id: string, health: number) {
  const room = activeRoom(sock)
  if (!room || !sock.pid) return
  if (room.phase === 'waiting' || room.phase === 'result') return
  if (typeof health !== 'number' || !Number.isFinite(health)) return
  const splat = room.splats.get(id)
  if (!splat || splat.targetPid !== sock.pid) return
  const next = Math.max(0, Math.min(splat.health, health))
  if (next === splat.health) return
  if (next <= 0) room.splats.delete(id)
  else splat.health = next
  broadcast(room)
}

function onAnswer(sock: Sock, optionId: string) {
  const room = activeRoom(sock)
  if (!room || !sock.pid) return
  if (room.phase !== 'sync_question' || room.paused || !room.question) return
  if (room.answers[sock.pid]) return
  if (!room.question.options.some((option) => option.id === optionId)) return
  room.answers[sock.pid] = optionId
  const players = [...room.players.values()]
  if (players.length >= 2 && players.every((player) => room.answers[player.pid])) resolveQuestion(room)
  else broadcast(room)
}

function onRematch(sock: Sock) {
  const room = activeRoom(sock)
  if (!room || !sock.pid) return
  if (room.phase !== 'result') return
  const player = room.players.get(sock.pid)
  if (!player || !player.connected) return
  player.rematch = true
  const players = [...room.players.values()]
  if (players.length >= 2 && players.every((p) => p.connected && p.rematch)) {
    resetMatch(room)
    log(room, 'rematch')
    enterCountdown(room)
    return
  }
  broadcast(room)
}

export function handleClose(sock: Sock) {
  if (!sock.roomCode || !sock.pid) return
  const room = rooms.get(sock.roomCode)
  const player = room?.players.get(sock.pid)
  if (player && player.ws && player.ws !== sock.ws) return
  detach(sock, 'disconnect')
}

export function roomCount(): number {
  return rooms.size
}
