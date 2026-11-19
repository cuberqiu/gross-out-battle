import type { Express, Request, Response } from 'express'
import express from 'express'
import { randomBytes } from 'node:crypto'
import type { ClientMsg } from '../shared/types'
import { handleClose, handleMessage, LINK_OPEN, type Link, type Sock } from './rooms'

const POLL_MS = 20_000
const IDLE_MS = 25_000
const MAX_BUFFER = 300
const MAX_SESSIONS = 4000
const LINK_CLOSED = 3

type Queued = { n: number; raw: string }
type PollResult = { msgs: Queued[]; closed: boolean }

type Waiter = {
  after: number
  done: boolean
  timer: ReturnType<typeof setTimeout>
  resolve: (result: PollResult) => void
}

/**
 * HTTP stand-in for one WebSocket client.
 * Room code only uses send(), close(), and readyState (liveness).
 * Messages stay in order and are replayed until the client's `after` cursor moves past them.
 */
class HttpSession implements Link {
  readonly sid = randomBytes(16).toString('hex')
  readyState = LINK_OPEN
  sock: Sock | null = null
  private seq = 0
  private buf: Queued[] = []
  private waiters: Waiter[] = []
  private polling = 0
  private expireTimer: ReturnType<typeof setTimeout> | null = null
  private onClose: (() => void) | null = null

  constructor() {
    this.arm()
  }

  attach(sock: Sock, onClose: () => void) {
    this.sock = sock
    this.onClose = onClose
  }

  send(data: string) {
    if (this.readyState !== LINK_OPEN) return
    this.seq += 1
    this.buf.push({ n: this.seq, raw: data })
    if (this.buf.length > MAX_BUFFER) this.buf.splice(0, this.buf.length - MAX_BUFFER)
    const waiter = this.waiters[0]
    if (!waiter) return
    this.remove(waiter)
    this.settle(waiter, { msgs: this.collect(waiter.after), closed: false })
  }

  close() {
    if (this.readyState !== LINK_OPEN) return
    this.readyState = LINK_CLOSED
    if (this.expireTimer) {
      clearTimeout(this.expireTimer)
      this.expireTimer = null
    }
    const pending = this.waiters.splice(0)
    for (const waiter of pending) {
      this.settle(waiter, { msgs: this.collect(waiter.after), closed: true })
    }
    const finish = this.onClose
    this.onClose = null
    finish?.()
  }

  poll(after: number): { promise: Promise<PollResult>; cancel: () => void } {
    this.beginPoll()
    let waiter: Waiter | null = null
    const promise = new Promise<PollResult>((resolve) => {
      const ready = this.collect(after)
      if (ready.length > 0 || this.readyState !== LINK_OPEN) {
        this.endPoll()
        resolve({ msgs: ready, closed: this.readyState !== LINK_OPEN })
        return
      }
      const parked: Waiter = {
        after,
        done: false,
        resolve,
        timer: setTimeout(() => {
          this.remove(parked)
          this.settle(parked, { msgs: this.collect(after), closed: this.readyState !== LINK_OPEN })
        }, POLL_MS),
      }
      waiter = parked
      this.waiters.push(parked)
    })
    return {
      promise,
      cancel: () => {
        if (!waiter || waiter.done) return
        this.remove(waiter)
        this.settle(waiter, { msgs: [], closed: false })
      },
    }
  }

  private beginPoll() {
    this.polling += 1
    this.arm()
  }

  private endPoll() {
    this.polling = Math.max(0, this.polling - 1)
    this.arm()
  }

  /** 25s with no in-flight poll closes the session the same way a socket close does. */
  private arm() {
    if (this.expireTimer) clearTimeout(this.expireTimer)
    if (this.readyState !== LINK_OPEN) return
    this.expireTimer = setTimeout(() => {
      if (this.readyState !== LINK_OPEN) return
      if (this.polling > 0) {
        this.arm()
        return
      }
      this.close()
    }, IDLE_MS)
  }

  private collect(after: number): Queued[] {
    const cursor = Number.isFinite(after) && after > 0 ? after : 0
    if (cursor > 0) this.buf = this.buf.filter((item) => item.n > cursor)
    return this.buf.slice()
  }

  private remove(waiter: Waiter) {
    const index = this.waiters.indexOf(waiter)
    if (index >= 0) this.waiters.splice(index, 1)
  }

  private settle(waiter: Waiter, result: PollResult) {
    if (waiter.done) return
    waiter.done = true
    clearTimeout(waiter.timer)
    this.endPoll()
    waiter.resolve(result)
  }
}

const sessions = new Map<string, HttpSession>()

export function readClientMsg(value: unknown): ClientMsg | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  let text = ''
  try {
    text = JSON.stringify(value)
  } catch {
    return null
  }
  if (text.length > 4000) return null
  if (typeof (value as { t?: unknown }).t !== 'string') return null
  return value as ClientMsg
}

export function readClientText(text: string): ClientMsg | null {
  if (text.length > 4000) return null
  try {
    return readClientMsg(JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

function noStore(res: Response) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Accel-Buffering': 'no',
  })
}

function sidOf(value: unknown): string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) ? value : ''
}

function cursorOf(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : 0
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function openSession(): HttpSession | null {
  if (sessions.size >= MAX_SESSIONS) return null
  const session = new HttpSession()
  const sock: Sock = { ws: session, roomCode: null, pid: null }
  session.attach(sock, () => {
    sessions.delete(session.sid)
    handleClose(sock)
  })
  sessions.set(session.sid, session)
  return session
}

export function mountRealtime(app: Express) {
  const json = express.json({ limit: '64kb' })

  app.post('/rt/open', (_req, res) => {
    noStore(res)
    const session = openSession()
    if (!session) {
      res.status(503).json({ error: 'busy' })
      return
    }
    res.json({ sid: session.sid })
  })

  app.get('/rt/poll', (req, res) => {
    noStore(res)
    const session = sessions.get(sidOf(req.query.sid))
    if (!session || session.readyState !== LINK_OPEN) {
      res.status(404).json({ error: 'gone' })
      return
    }
    const handle = session.poll(cursorOf(req.query.after))
    let finished = false
    req.on('aborted', () => {
      if (finished) return
      handle.cancel()
    })
    void handle.promise
      .then((payload) => {
        finished = true
        if (res.writableEnded || res.destroyed || req.aborted) return
        res.json(payload)
      })
      .catch(() => {
        finished = true
        if (!res.writableEnded) res.status(500).end()
      })
  })

  app.post('/rt/send', json, (req: Request, res: Response) => {
    noStore(res)
    const body = (req.body ?? {}) as { sid?: unknown; msg?: unknown; msgs?: unknown }
    const session = sessions.get(sidOf(body.sid))
    if (!session || session.readyState !== LINK_OPEN || !session.sock) {
      res.status(404).json({ error: 'gone' })
      return
    }
    const list = Array.isArray(body.msgs) ? body.msgs : body.msg != null ? [body.msg] : []
    if (list.length > 40) {
      res.status(400).json({ error: 'too_many' })
      return
    }
    for (const item of list) {
      const msg = readClientMsg(item)
      if (msg) handleMessage(session.sock, msg)
    }
    res.json({ ok: true })
  })
}
