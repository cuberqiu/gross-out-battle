export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type Mode = 'gross' | 'sync' | 'mixed'

export type Phase =
  | 'waiting'
  | 'countdown'
  | 'battle'
  | 'sync_question'
  | 'sync_result'
  | 'result'

export type Effect = 'stink' | 'shake' | 'drip' | 'slime' | 'fart' | 'crawl' | 'flip' | 'plop'

export type ItemDef = {
  id: string
  name: string
  short: string
  points: number
  radius: number
  health: number
  effect: Effect
  hint: string
  color: string
}

export type Question = {
  id: string
  prompt: string
  options: { id: string; label: string }[]
}

export type Splat = {
  id: string
  itemId: string
  x: number
  y: number
  rot: number
  health: number
  maxHealth: number
  ownerPid: string
  fromPunishment: boolean
}

export type PlayerPublic = {
  pid: string
  name: string
  connected: boolean
  host: boolean
  rematch: boolean
}

export type ResultCard = {
  pid: string
  name: string
  title: string
  role: 'win' | 'lose' | 'tie'
}

export type ResultPayload = {
  headline: string
  sub: string
  stamp: string
  stampWho: string
  stampTone: 'bad' | 'good' | 'mid'
  verdict: string
  syncIndex: number
  gross: Record<string, number>
  cards: ResultCard[]
  forfeit: boolean
}

export type Snapshot = {
  t: 'snapshot'
  serverNow: number
  code: string
  mode: Mode
  phase: Phase
  paused: boolean
  pauseText: string
  endsAt: number | null
  remainingMs: number
  phaseDuration: number | null
  you: string
  players: PlayerPublic[]
  splats: Splat[]
  gross: Record<string, number>
  question: null | {
    id: string
    prompt: string
    options: { id: string; label: string }[]
    index: number
    total: number
    yourOption: string | null
  }
  reveal: null | {
    matched: boolean
    rows: { pid: string; name: string; label: string }[]
  }
  sync: { matches: number; total: number; bonus: number; index: number; verdict: string }
  result: ResultPayload | null
}

export type ClientMsg =
  | { t: 'create'; name: string; mode: Mode }
  | { t: 'join'; code: string; name: string }
  | { t: 'rejoin'; code: string; pid: string; name: string }
  | { t: 'start' }
  | { t: 'throw'; itemId: string; x: number; y: number }
  | { t: 'wipe'; id: string; health: number }
  | { t: 'answer'; optionId: string }
  | { t: 'rematch' }
  | { t: 'leave' }

export type ServerEvent =
  | { t: 'event'; kind: 'ack'; itemId: string; x: number; y: number }
  | { t: 'event'; kind: 'hit'; effect: Effect; itemId: string }
  | { t: 'event'; kind: 'accident'; itemName: string }

export type ErrorMsg = {
  t: 'error'
  message: string
  code?: 'no_room' | 'full' | 'started' | 'not_member' | 'bad_name' | 'not_host' | 'need_two' | 'busy'
  room?: string
}

export type ByeMsg = { t: 'bye' }

export type ServerMsg = Snapshot | ServerEvent | ErrorMsg | ByeMsg

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((c) => ROOM_ALPHABET.includes(c))
    .slice(0, 4)
    .join('')
}

export function cleanName(input: unknown): string {
  if (typeof input !== 'string') return ''
  const stripped = input.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim()
  return [...stripped].slice(0, 12).join('')
}
