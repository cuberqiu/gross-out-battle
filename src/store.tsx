import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Mode, Phase, ServerMsg, Snapshot } from '../shared/types'
import { audio } from './audio'
import { send, startNet, subscribe } from './net'

export type Flyer = { id: number; itemId: string; x: number; y: number }

type Game = {
  connected: boolean
  toast: string | null
  snapshot: Snapshot | null
  phase: Phase | 'lobby'
  help: boolean
  openHelp: () => void
  closeHelp: () => void
  muted: boolean
  setMuted: (muted: boolean) => void
  selected: string
  setSelected: (id: string) => void
  now: number
  offset: number
  lastEffect: string
  shaking: boolean
  flippedUntil: number
  fartUntil: number
  accident: { name: string; until: number } | null
  flyers: Flyer[]
  createRoom: (name: string, mode: Mode) => void
  joinRoom: (name: string, code: string) => void
  startGame: () => void
  leave: () => void
  throwItem: (itemId: string, x: number, y: number) => void
  wipe: (id: string, health: number) => void
  answer: (optionId: string) => void
  rematch: () => void
  flash: (message: string) => void
}

const GameContext = createContext<Game | null>(null)

let suppress = false
let flyerSeq = 1

function rememberSession(snapshot: Snapshot) {
  sessionStorage.setItem('gross-pid', snapshot.you)
  sessionStorage.setItem('gross-room', snapshot.code)
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [help, setHelp] = useState(false)
  const [muted, setMutedState] = useState(() => localStorage.getItem('gross-muted') === '1')
  const [selected, setSelected] = useState('sock')
  const [now, setNow] = useState(() => Date.now())
  const [offset, setOffset] = useState(0)
  const [lastEffect, setLastEffect] = useState('')
  const [shaking, setShaking] = useState(false)
  const [flippedUntil, setFlippedUntil] = useState(0)
  const [fartUntil, setFartUntil] = useState(0)
  const [accident, setAccident] = useState<{ name: string; until: number } | null>(null)
  const [flyers, setFlyers] = useState<Flyer[]>([])
  const toastTimer = useRef<number | null>(null)
  const phaseRef = useRef<string | undefined>(undefined)
  const helpArmed = useRef(false)

  const flash = (message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }

  const setMuted = (next: boolean) => {
    setMutedState(next)
    localStorage.setItem('gross-muted', next ? '1' : '0')
    audio.setMuted(next)
  }

  useEffect(() => {
    audio.setMuted(muted)
    startNet()
    return subscribe((msg: ServerMsg | { t: 'net'; connected: boolean }) => {
      if (msg.t === 'net') {
        setConnected(msg.connected)
        return
      }
      if (msg.t === 'bye') {
        if (suppress) {
          sessionStorage.removeItem('gross-pid')
          sessionStorage.removeItem('gross-room')
          setSnapshot(null)
        }
        return
      }
      if (msg.t === 'error') {
        flash(msg.message)
        if ((msg.code === 'no_room' || msg.code === 'not_member') && sessionStorage.getItem('gross-room') === msg.room) {
          sessionStorage.removeItem('gross-pid')
          sessionStorage.removeItem('gross-room')
          setSnapshot(null)
        }
        return
      }
      if (msg.t === 'snapshot') {
        if (suppress) return
        setOffset(msg.serverNow - Date.now())
        setNow(Date.now())
        setSnapshot(msg)
        rememberSession(msg)
        const previous = phaseRef.current
        if (previous === undefined) {
          phaseRef.current = msg.phase
        } else if (previous !== msg.phase) {
          phaseRef.current = msg.phase
          if (msg.phase === 'countdown') audio.tick()
          if (msg.phase === 'battle' && previous === 'countdown') audio.horn()
          if (msg.phase === 'sync_result') {
            if (msg.reveal?.matched) audio.match()
            else audio.trombone()
          }
          if (msg.phase === 'result') audio.fanfare()
        }
        return
      }
      if (msg.t === 'event' && msg.kind === 'ack') {
        audio.whoosh()
        const flyer = { id: flyerSeq++, itemId: msg.itemId, x: msg.x, y: msg.y }
        setFlyers((current) => [...current.slice(-6), flyer])
        window.setTimeout(() => {
          setFlyers((current) => current.filter((item) => item.id !== flyer.id))
        }, 650)
      }
      if (msg.t === 'event' && msg.kind === 'hit') {
        setLastEffect(msg.effect)
        setNow(Date.now())
        if (msg.effect === 'shake') {
          setShaking(false)
          window.requestAnimationFrame(() => setShaking(true))
          window.setTimeout(() => setShaking(false), 480)
        }
        if (msg.effect === 'flip') {
          setFlippedUntil((prev) => {
            const base = Math.max(Date.now(), prev)
            return Math.min(Date.now() + 4000, base + 2000)
          })
        }
        if (msg.effect === 'fart') setFartUntil(Date.now() + 900)
        audio.effect(msg.effect)
        if (navigator.vibrate) navigator.vibrate(16)
      }
      if (msg.t === 'event' && msg.kind === 'accident') {
        const until = Date.now() + 2400
        setAccident({ name: msg.itemName, until })
        setNow(Date.now())
        audio.accident()
        window.setTimeout(() => {
          setAccident((current) => (current && current.until === until ? null : current))
        }, 2500)
      }
    })
  }, [])

  const phase: Phase | 'lobby' = snapshot?.phase ?? 'lobby'
  const timed = Boolean(snapshot?.endsAt && !snapshot.paused)

  useEffect(() => {
    if (!timed) return
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [timed])

  useEffect(() => {
    if (helpArmed.current || phase !== 'lobby') return
    helpArmed.current = true
    if (!localStorage.getItem('gross-howto-seen')) setHelp(true)
  }, [phase])

  useEffect(() => {
    document.title = snapshot ? `房间 ${snapshot.code} · 互相恶心大作战` : '互相恶心大作战'
  }, [snapshot])

  const api = useMemo<Game>(() => {
    return {
      connected,
      toast,
      snapshot,
      phase,
      help,
      openHelp: () => setHelp(true),
      closeHelp: () => {
        localStorage.setItem('gross-howto-seen', '1')
        setHelp(false)
      },
      muted,
      setMuted,
      selected,
      setSelected,
      now,
      offset,
      lastEffect,
      shaking,
      flippedUntil,
      fartUntil,
      accident,
      flyers,
      createRoom: (name, mode) => {
        const trimmed = name.trim()
        if (!trimmed) return flash('先起个外号')
        localStorage.setItem('gross-name', trimmed)
        suppress = false
        send({ t: 'create', name: trimmed, mode })
      },
      joinRoom: (name, code) => {
        const trimmed = name.trim()
        if (!trimmed) return flash('先起个外号')
        localStorage.setItem('gross-name', trimmed)
        suppress = false
        send({ t: 'join', name: trimmed, code })
      },
      startGame: () => send({ t: 'start' }),
      leave: () => {
        suppress = true
        sessionStorage.removeItem('gross-pid')
        sessionStorage.removeItem('gross-room')
        setSnapshot(null)
        phaseRef.current = undefined
        send({ t: 'leave' })
      },
      throwItem: (itemId, x, y) => send({ t: 'throw', itemId, x, y }),
      wipe: (id, health) => send({ t: 'wipe', id, health }),
      answer: (optionId) => send({ t: 'answer', optionId }),
      rematch: () => send({ t: 'rematch' }),
      flash,
    }
  }, [
    accident,
    connected,
    fartUntil,
    flippedUntil,
    flyers,
    help,
    lastEffect,
    muted,
    now,
    offset,
    phase,
    selected,
    shaking,
    snapshot,
    toast,
  ])

  return <GameContext.Provider value={api}>{children}</GameContext.Provider>
}

export function useGame() {
  const game = useContext(GameContext)
  if (!game) throw new Error('useGame outside provider')
  return game
}
