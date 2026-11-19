import type { ClientMsg, ServerMsg } from '../shared/types'
import { normalizeCode } from '../shared/types'

type Listener = (msg: ServerMsg | { t: 'net'; connected: boolean }) => void
type Transport = 'ws' | 'http'

let socket: WebSocket | null = null
let timer: number | null = null
let started = false
let transport: Transport = 'ws'
let everOpen = false
let wsFailures = 0
let generation = 0
let httpSid: string | null = null
let httpOpen = false
let httpConnecting = false
let httpAfter = 0
let flushing = false
let flushTimer: number | null = null
let pollAbort: AbortController | null = null
const listeners = new Set<Listener>()
const queue: ClientMsg[] = []
const httpOut: ClientMsg[] = []

const RELIABLE = new Set(['create', 'join', 'rejoin', 'start', 'answer', 'rematch', 'leave'])
const WS_OPEN_MS = 3000
const HTTP_BATCH_MS = 40

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

function forcedHttp() {
  return new URLSearchParams(location.search).get('transport') === 'http'
}

function emit(msg: ServerMsg | { t: 'net'; connected: boolean }) {
  for (const listener of listeners) listener(msg)
}

function savedSession(): { pid: string; code: string } | null {
  const pid = sessionStorage.getItem('gross-pid')
  const code = sessionStorage.getItem('gross-room')
  if (!pid || !code) return null
  return { pid, code }
}

function clearTimer() {
  if (timer == null) return
  window.clearTimeout(timer)
  timer = null
}

function retryLater() {
  if (!started) return
  clearTimer()
  timer = window.setTimeout(() => {
    timer = null
    connect()
  }, 700)
}

function pushInitial(sendNow: (msg: ClientMsg) => void) {
  const params = new URLSearchParams(location.search)
  const urlRoom = normalizeCode(params.get('room') || '')
  const saved = savedSession()
  if (saved && urlRoom && urlRoom !== saved.code) {
    sessionStorage.removeItem('gross-pid')
    sessionStorage.removeItem('gross-room')
  } else if (saved) {
    const name = localStorage.getItem('gross-name') || '臭友'
    sendNow({ t: 'rejoin', pid: saved.pid, code: saved.code, name })
  }
  while (queue.length) {
    const next = queue.shift()
    if (next) sendNow(next)
  }
}

function abandonSocket(ws: WebSocket) {
  ws.onopen = null
  ws.onclose = null
  ws.onmessage = null
  ws.onerror = null
  try {
    ws.close()
  } catch {
    /* already closing */
  }
}

function useHttp() {
  transport = 'http'
  clearTimer()
  if (socket) {
    const pending = socket
    socket = null
    abandonSocket(pending)
  }
  void connectHttp()
}

function connectWs() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  const ws = new WebSocket(wsUrl())
  socket = ws
  let opened = false
  let timeout: number | null = null
  if (!everOpen) {
    timeout = window.setTimeout(() => {
      if (opened || socket !== ws || transport !== 'ws') return
      if (socket === ws) socket = null
      abandonSocket(ws)
      useHttp()
    }, WS_OPEN_MS)
  }
  ws.onopen = () => {
    opened = true
    everOpen = true
    wsFailures = 0
    if (timeout != null) window.clearTimeout(timeout)
    emit({ t: 'net', connected: true })
    pushInitial((msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    })
  }
  ws.onmessage = (event) => {
    try {
      emit(JSON.parse(String(event.data)) as ServerMsg)
    } catch {
      /* ignore malformed frames */
    }
  }
  ws.onclose = () => {
    if (timeout != null) window.clearTimeout(timeout)
    if (socket === ws) socket = null
    if (transport !== 'ws') return
    const failedBeforeOpen = !opened && !everOpen
    if (failedBeforeOpen) wsFailures += 1
    emit({ t: 'net', connected: false })
    if (failedBeforeOpen && wsFailures >= 2) {
      useHttp()
      return
    }
    retryLater()
  }
  ws.onerror = () => {
    ws.close()
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function loseHttp() {
  if (transport !== 'http') return
  const wasUp = httpOpen || httpConnecting
  generation += 1
  httpOpen = false
  httpConnecting = false
  httpSid = null
  keepReliable(httpOut.splice(0))
  if (pollAbort) {
    pollAbort.abort()
    pollAbort = null
  }
  if (wasUp) emit({ t: 'net', connected: false })
  retryLater()
}

function scheduleFlush(delayMs: number) {
  if (flushTimer != null) {
    if (delayMs > 0) return
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flushHttp()
  }, delayMs)
}

async function postMsgs(sid: string, batch: ClientMsg[]): Promise<'ok' | 'gone' | 'retry'> {
  try {
    const res = await fetch('/rt/send', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch.length === 1 ? { sid, msg: batch[0] } : { sid, msgs: batch }),
    })
    if (res.status === 404 || res.status === 410) return 'gone'
    if (!res.ok) return 'retry'
    return 'ok'
  } catch {
    return 'retry'
  }
}

function keepReliable(batch: ClientMsg[]) {
  for (const msg of batch) {
    if (RELIABLE.has(msg.t) && queue.length < 20) queue.push(msg)
  }
}

async function flushHttp() {
  if (flushing || !httpOpen || !httpSid) return
  flushing = true
  let failed = 0
  try {
    while (httpOut.length > 0 && httpOpen && httpSid) {
      const sid: string = httpSid
      const batch = httpOut.splice(0, 20)
      const result = await postMsgs(sid, batch)
      if (!httpOpen || httpSid !== sid) {
        keepReliable(batch)
        return
      }
      if (result === 'ok') {
        failed = 0
        continue
      }
      if (result === 'gone') {
        keepReliable(batch)
        while (httpOut.length) {
          const msg = httpOut.shift()
          if (msg) keepReliable([msg])
        }
        loseHttp()
        return
      }
      httpOut.unshift(...batch)
      failed += 1
      if (failed >= 3) {
        keepReliable(httpOut.splice(0))
        loseHttp()
        return
      }
      await delay(200)
    }
  } finally {
    flushing = false
  }
  if (httpOpen && httpOut.length > 0) scheduleFlush(0)
}

async function pollLoop(gen: number) {
  while (gen === generation && httpOpen && httpSid) {
    const sid = httpSid
    const after = httpAfter
    const ctrl = new AbortController()
    pollAbort = ctrl
    try {
      const res = await fetch(`/rt/poll?sid=${encodeURIComponent(sid)}&after=${after}`, {
        cache: 'no-store',
        signal: ctrl.signal,
      })
      if (gen !== generation) return
      if (res.status === 404 || res.status === 410) {
        loseHttp()
        return
      }
      if (!res.ok) {
        await delay(400)
        continue
      }
      const body = (await res.json()) as { msgs?: { n: number; raw: string }[]; closed?: boolean }
      for (const item of body.msgs ?? []) {
        if (!item || typeof item.raw !== 'string') continue
        if (typeof item.n === 'number') httpAfter = Math.max(httpAfter, item.n)
        try {
          emit(JSON.parse(item.raw) as ServerMsg)
        } catch {
          /* ignore malformed frames */
        }
      }
      if (body.closed) {
        loseHttp()
        return
      }
    } catch {
      if (gen !== generation || !httpOpen) return
      await delay(400)
    }
  }
}

async function connectHttp() {
  if (transport !== 'http' || httpOpen || httpConnecting) return
  httpConnecting = true
  const gen = ++generation
  try {
    const res = await fetch('/rt/open', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { sid?: string }
    if (gen !== generation || transport !== 'http') return
    if (!data.sid) throw new Error('no sid')
    httpSid = data.sid
    httpAfter = 0
    httpOpen = true
    httpConnecting = false
    emit({ t: 'net', connected: true })
    pushInitial((msg) => httpOut.push(msg))
    void flushHttp()
    void pollLoop(gen)
  } catch {
    if (gen !== generation) return
    httpConnecting = false
    httpOpen = false
    emit({ t: 'net', connected: false })
    retryLater()
  }
}

function connect() {
  if (!started) return
  if (transport === 'http') void connectHttp()
  else connectWs()
}

export function startNet() {
  started = true
  clearTimer()
  if (forcedHttp()) transport = 'http'
  connect()
}

export function send(msg: ClientMsg) {
  if (transport === 'http') {
    if (httpOpen) {
      httpOut.push(msg)
      scheduleFlush(RELIABLE.has(msg.t) ? 0 : HTTP_BATCH_MS)
    } else if (RELIABLE.has(msg.t) && queue.length < 20) queue.push(msg)
    return
  }
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  else if (RELIABLE.has(msg.t) && queue.length < 20) queue.push(msg)
}

export function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function connectedNow() {
  if (transport === 'http') return httpOpen
  return socket?.readyState === WebSocket.OPEN
}
