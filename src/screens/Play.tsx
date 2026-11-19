import { useEffect, useRef, useState } from 'react'
import { itemById, ITEMS } from '../../shared/items'
import type { Splat } from '../../shared/types'
import { ItemArt } from '../art'
import { MuteButton, playersOf, remainingOf } from '../bits'
import { crawlOffsets } from '../crawl'
import { Splats } from '../components/Splats'
import { audio } from '../audio'
import { useGame } from '../store'

type Track = { x: number; y: number; moved: number }
type Smear = { id: number; x: number; y: number }

let smearSeq = 1

export function Play() {
  const game = useGame()
  const snapshot = game.snapshot
  const pending = useRef(new Map<string, number>())
  const tracks = useRef(new Map<number, Track>())
  const wipeRef = useRef(game.wipe)
  wipeRef.current = game.wipe
  const hpRef = useRef<Record<string, number>>({})
  const selectedRef = useRef(game.selected)
  const [localHp, setLocalHp] = useState<Record<string, number>>({})
  const [smears, setSmears] = useState<Smear[]>([])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (pending.current.size === 0) return
      for (const [splatId, health] of pending.current) wipeRef.current(splatId, health)
      pending.current.clear()
    }, 80)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!snapshot) return
    const ids = new Set(snapshot.splats.map((splat) => splat.id))
    setLocalHp(() => {
      const next: Record<string, number> = {}
      for (const splat of snapshot.splats) {
        if (!ids.has(splat.id)) continue
        const local = hpRef.current[splat.id]
        if (local == null || local >= splat.health) continue
        next[splat.id] = local
      }
      hpRef.current = next
      return next
    })
  }, [snapshot])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const n = Number(event.key)
      const item = ITEMS[n - 1]
      if (n >= 1 && n <= ITEMS.length && item) {
        selectedRef.current = item.id
        game.setSelected(item.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game])

  if (!snapshot) return null
  const { me, opp } = playersOf(snapshot)
  const ms = remainingOf(snapshot, game.now, game.offset)
  const secs = Math.max(0, Math.ceil(ms / 1000))
  const ratio = snapshot.phaseDuration ? Math.max(0, Math.min(1, ms / snapshot.phaseDuration)) : 0
  const grossMe = me ? (snapshot.gross[me.pid] ?? 0) : 0
  const grossOpp = opp ? (snapshot.gross[opp.pid] ?? 0) : 0
  const flipped = snapshot.phase === 'battle' && game.now < game.flippedUntil
  const farting = game.now < game.fartUntil
  const shown: Splat[] = snapshot.splats.map((splat) => ({
    ...splat,
    health: localHp[splat.id] != null ? Math.min(localHp[splat.id] ?? splat.health, splat.health) : splat.health,
  }))
  const selected = itemById(game.selected) ?? ITEMS[0]

  function damageAt(clientX: number, clientY: number, moved: number, arena: HTMLElement) {
    const rect = arena.getBoundingClientRect()
    const hits: { id: string; health: number }[] = []
    for (const splat of shown) {
      const item = itemById(splat.itemId)
      if (!item) continue
      const extra = crawlOffsets.get(splat.id) ?? { x: 0, y: 0 }
      const cx = rect.left + splat.x * rect.width + extra.x
      const cy = rect.top + splat.y * rect.height + extra.y
      const rad = Math.max(42, item.radius * Math.min(rect.width, rect.height))
      if (Math.hypot(clientX - cx, clientY - cy) > rad) continue
      const known = hpRef.current[splat.id]
      const current = known != null ? Math.min(known, splat.health) : splat.health
      const health = Math.max(0, current - Math.max(8, moved * 1.3))
      hpRef.current[splat.id] = health
      hits.push({ id: splat.id, health })
    }
    if (hits.length === 0) return
    setLocalHp({ ...hpRef.current })
    for (const hit of hits) {
      if (hit.health <= 0) {
        pending.current.delete(hit.id)
        game.wipe(hit.id, 0)
        audio.squeak()
      } else {
        pending.current.set(hit.id, hit.health)
      }
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    audio.arm()
    if ((event.target as HTMLElement).closest('[data-interactive]')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    tracks.current.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: 0 })
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const track = tracks.current.get(event.pointerId)
    if (!track) return
    const moved = Math.hypot(event.clientX - track.x, event.clientY - track.y)
    track.x = event.clientX
    track.y = event.clientY
    track.moved += moved
    if (track.moved < 8 || moved < 1) return
    const rect = event.currentTarget.getBoundingClientRect()
    const smear = { id: smearSeq++, x: event.clientX - rect.left, y: event.clientY - rect.top }
    setSmears((current) => [...current.slice(-16), smear])
    damageAt(event.clientX, event.clientY, moved, event.currentTarget)
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const track = tracks.current.get(event.pointerId)
    tracks.current.delete(event.pointerId)
    if (!track || !snapshot) return
    const thrown = itemById(selectedRef.current)
    if (track.moved < 18 && snapshot.phase === 'battle' && !snapshot.paused && thrown) {
      const rect = event.currentTarget.getBoundingClientRect()
      const x = (event.clientX - rect.left) / rect.width
      const y = (event.clientY - rect.top) / rect.height
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) game.throwItem(thrown.id, x, y)
    }
    window.setTimeout(() => setSmears([]), 280)
  }

  const phaseHint =
    snapshot.phase === 'countdown'
      ? '深呼吸。马上开臭。'
      : snapshot.phase === 'sync_question'
        ? '先别扔，这题在考你们还有没有默契。'
        : snapshot.phase === 'sync_result'
          ? snapshot.reveal?.matched
            ? '心有灵犀的一小下。'
            : '叹息声已经具象化了。'
          : '点屏幕扔向对方，按住摩擦擦掉糊在你这边的。'

  return (
    <div className="play">
      <header className="hud">
        <div className="hud-names">
          {me?.name ?? '你'} 对 {opp?.name ?? '朋友'}
        </div>
        <div className="timer-wrap">
          <div className="timer-bar" aria-hidden="true">
            <span style={{ width: `${ratio * 100}%` }} />
          </div>
          <strong data-testid="timer">{secs}</strong>
          <small>秒</small>
        </div>
        <div className="hud-stats">
          <span>
            我糊住 <b data-testid="score-self">{grossMe}</b>
          </span>
          <span>
            糊住我 <b data-testid="score-opp">{grossOpp}</b>
          </span>
          <span>
            默契{' '}
            <b>
              <i data-testid="sync-index">{snapshot.sync.index}</i>%
            </b>
          </span>
        </div>
        <div className="hud-actions">
          <MuteButton />
          <button type="button" className="icon-btn" onClick={game.openHelp}>
            怎么玩
          </button>
        </div>
      </header>
      <div className="play-main">
        <aside className="side">
          <article className="score-card">
            <p>我糊住对方</p>
            <strong>{grossMe}</strong>
            <span>{me?.name}</span>
          </article>
          {selected && (
            <article className="score-card subtle">
              <p>手上的道具</p>
              <div className="holding">
                <ItemArt id={selected.id} size={54} />
                <div>
                  <strong>{selected.name}</strong>
                  <span>{selected.hint}</span>
                </div>
              </div>
            </article>
          )}
        </aside>
        <div
          className={`arena ${farting ? 'is-fart' : ''}`}
          data-testid="arena"
          data-phase={snapshot.phase}
          data-last-effect={game.lastEffect || 'none'}
          data-flipped={flipped ? 'true' : 'false'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className={`playfield ${game.shaking ? 'shake' : ''}`} style={flipped ? { transform: 'rotate(180deg)' } : undefined}>
            <Splats splats={shown} />
            {game.flyers.map((flyer) => (
              <span key={flyer.id} className="flyer" style={{ left: `${flyer.x * 100}%`, top: `${flyer.y * 100}%` }}>
                <ItemArt id={flyer.itemId} size={46} />
              </span>
            ))}
            {snapshot.phase === 'countdown' && (
              <div className="countdown" data-testid="countdown">
                <strong>{Math.max(1, secs)}</strong>
                <em>{ms / (snapshot.phaseDuration || 1) > 0.66 ? '捏鼻' : ms / (snapshot.phaseDuration || 1) > 0.33 ? '瞄准' : '开臭'}</em>
              </div>
            )}
            {snapshot.phase === 'sync_question' && snapshot.question && (
              <div className="q-card" data-testid="sync-question" data-interactive="true">
                <p className="eyebrow">
                  第 {snapshot.question.index} / {snapshot.question.total} 题 · 还剩 {secs} 秒
                </p>
                <h2 data-testid="sync-prompt">{snapshot.question.prompt}</h2>
                <div className="options">
                  {snapshot.question.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      data-testid={`sync-option-${option.id}`}
                      data-option={option.id}
                      data-picked={snapshot.question?.yourOption === option.id ? 'true' : 'false'}
                      disabled={snapshot.question?.yourOption != null}
                      onClick={() => game.answer(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="q-note">{snapshot.question.yourOption ? '选好了，等对方。' : '不要看对方的屏幕。心有灵犀就选同一个。'}</p>
              </div>
            )}
          </div>
          {snapshot.phase === 'sync_result' && snapshot.reveal && (
            <div className={`drama ${snapshot.reveal.matched ? 'good' : 'bad'}`} data-testid="sync-reveal" data-matched={snapshot.reveal.matched ? 'yes' : 'no'}>
              {!snapshot.reveal.matched && (
                <div className="rain" aria-hidden="true">
                  {Array.from({ length: 18 }, (_, index) => (
                    <span key={index} style={{ left: `${(index * 53) % 100}%`, animationDelay: `${(index % 6) * 0.12}s` }}>
                      {index % 3 === 0 ? '😭' : index % 3 === 1 ? '💔' : '😢'}
                    </span>
                  ))}
                </div>
              )}
              <div className="drama-card">
                <p>{snapshot.reveal.matched ? '心灵短暂接通' : '叹息声已同步'}</p>
                <h2>{snapshot.reveal.matched ? '默契+1' : '没有默契了！'}</h2>
                <p className="picks">
                  {snapshot.reveal.rows.map((row) => `${row.name}选了${row.label}`).join(' · ')}
                </p>
                <p>{snapshot.reveal.matched ? '有点臭，但很齐。' : '你们聊天时的那声叹息，现在糊在脸上了。'}</p>
              </div>
            </div>
          )}
          {game.accident && game.now < game.accident.until && (
            <div className="accident" data-testid="accident-banner">
              居然有默契！你们同时扔出了{game.accident.name}
            </div>
          )}
          {snapshot.paused && (
            <div className="pause" data-testid="disconnect-banner">
              {snapshot.pauseText || '对方信号不稳，先捏住鼻子等一等…'}
            </div>
          )}
          {flipped && <div className="flip-banner">芥末！整个世界倒过来了</div>}
          <div className="arena-tag">你的屏幕</div>
          {smears.map((smear) => (
            <i key={smear.id} className="smear" style={{ left: smear.x, top: smear.y }} />
          ))}
        </div>
        <aside className="side">
          <article className="score-card opp">
            <p>对方糊住我</p>
            <strong>{grossOpp}</strong>
            <span>{opp?.name ?? '还没来'}</span>
          </article>
          <article className="score-card subtle">
            <p>默契指数</p>
            <strong>{snapshot.sync.index}%</strong>
            <span>
              对上 {snapshot.sync.matches}/{snapshot.sync.total}
              {snapshot.sync.bonus > 0 ? ` · 偶然同步 ${snapshot.sync.bonus}` : ''}
            </span>
          </article>
        </aside>
      </div>
      {snapshot.phase === 'battle' ? (
        <footer className="dock">
          <div className="items">
            {ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`item-${item.id}`}
                data-selected={game.selected === item.id ? 'true' : 'false'}
                onClick={() => {
                  selectedRef.current = item.id
                  game.setSelected(item.id)
                }}
              >
                <ItemArt id={item.id} size={36} />
                <small>{item.short}</small>
              </button>
            ))}
          </div>
          <p className="dock-hint">{phaseHint}</p>
        </footer>
      ) : (
        <footer className="hint-bar">{phaseHint}</footer>
      )}
    </div>
  )
}
