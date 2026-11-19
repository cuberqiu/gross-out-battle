import type { Snapshot } from '../shared/types'
import { useGame } from './store'

export function MuteButton() {
  const { muted, setMuted } = useGame()
  return (
    <button type="button" className="icon-btn" data-testid="mute" aria-pressed={muted} onClick={() => setMuted(!muted)}>
      {muted ? '静音' : '有声'}
    </button>
  )
}

export function remainingOf(snapshot: Snapshot, now: number, offset: number) {
  if (snapshot.paused) return snapshot.remainingMs
  if (!snapshot.endsAt) return 0
  return Math.max(0, snapshot.endsAt - (now + offset))
}

export function playersOf(snapshot: Snapshot) {
  const me = snapshot.players.find((player) => player.pid === snapshot.you) ?? null
  const opp = snapshot.players.find((player) => player.pid !== snapshot.you) ?? null
  return { me, opp }
}
