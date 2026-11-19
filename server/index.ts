import express from 'express'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMsg } from '../shared/types'
import { handleClose, handleMessage, roomCount, timings, type Sock } from './rooms'

const isProd = process.env.NODE_ENV === 'production'
const PORT = isProd ? Number(process.env.PORT) || 43123 : 43124
const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root, '..', 'dist')

const app = express()
const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: roomCount(), timings })
})

if (isProd) {
  app.use(express.static(dist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/ws')) return next()
    res.sendFile(path.join(dist, 'index.html'), (error) => {
      if (error) next(error)
    })
  })
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain; charset=utf-8').send('互相恶心大作战 game server. Open the web port.')
  })
}

type AliveSocket = WebSocket & { isAlive?: boolean }

wss.on('connection', (ws: AliveSocket) => {
  const sock: Sock = { ws, roomCode: null, pid: null }
  ws.isAlive = true
  ws.on('pong', () => {
    ws.isAlive = true
  })
  ws.on('error', () => {
    /* close handler finishes the cleanup */
  })
  ws.on('message', (data) => {
    const text = data.toString()
    if (text.length > 4000) return
    let msg: ClientMsg
    try {
      msg = JSON.parse(text) as ClientMsg
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return
    handleMessage(sock, msg)
  })
  ws.on('close', () => handleClose(sock))
})

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const socket = client as AliveSocket
    if (socket.isAlive === false) {
      socket.terminate()
      continue
    }
    socket.isAlive = false
    socket.ping()
  }
}, 15_000)
heartbeat.unref()

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`互相恶心大作战 ${isProd ? 'production' : 'dev'} on :${PORT}`)
})
