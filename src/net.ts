import type { ClientMsg, ServerMsg } from '../shared/types'
import { normalizeCode } from '../shared/types'

type Listener = (msg: ServerMsg | { t: 'net'; connected: boolean }) => void

let socket: WebSocket | null = null
let timer: number | null = null
let started = false
const listeners = new Set<Listener>()
const queue: ClientMsg[] = []

const RELIABLE = new Set(['create', 'join', 'rejoin', 'start', 'answer', 'rematch', 'leave'])

function url() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
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

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  const ws = new WebSocket(url())
  socket = ws
  ws.onopen = () => {
    emit({ t: 'net', connected: true })
    const params = new URLSearchParams(location.search)
    const urlRoom = normalizeCode(params.get('room') || '')
    const saved = savedSession()
    if (saved && urlRoom && urlRoom !== saved.code) {
      sessionStorage.removeItem('gross-pid')
      sessionStorage.removeItem('gross-room')
    } else if (saved && ws.readyState === WebSocket.OPEN) {
      const name = localStorage.getItem('gross-name') || '臭友'
      ws.send(JSON.stringify({ t: 'rejoin', pid: saved.pid, code: saved.code, name }))
    }
    while (queue.length && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(queue.shift()))
    }
  }
  ws.onmessage = (event) => {
    try {
      emit(JSON.parse(String(event.data)) as ServerMsg)
    } catch {
      /* ignore malformed frames */
    }
  }
  ws.onclose = () => {
    if (socket === ws) socket = null
    emit({ t: 'net', connected: false })
    if (started) timer = window.setTimeout(connect, 700)
  }
  ws.onerror = () => {
    ws.close()
  }
}

export function startNet() {
  started = true
  if (timer) window.clearTimeout(timer)
  connect()
}

export function send(msg: ClientMsg) {
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
  return socket?.readyState === WebSocket.OPEN
}
